import { SYSTEM_PROMPTS } from './system-prompt.js';
import { prepareTurn } from './rag/rag-prompt.js';
import { createOutputFilter, redactMessages } from './guardrails.js';

/**
 * Atiende un turno del tutor y responde en streaming (text/plain). Lo usan el chat de desarrollo
 * (POST /v1/dev/chat) y las conversaciones guardadas (POST .../tutor-conversations/{id}/messages).
 *
 * Cómo responde (ver prepareTurn en rag/rag-prompt.js):
 *  - charla (saludo, gracias, "¿quién eres?", "estoy nervioso"…) → conversa con el LLM, sin contenidos.
 *  - pregunta de materia con apuntes relevantes → LLM anclado SOLO a esos apuntes, con fuentes [n].
 *  - pregunta BÁSICA que los apuntes no cubren (un cálculo como "1+1" o un concepto como "¿qué es una fracción?") →
 *    el LLM la explica con la calculadora exacta o el glosario básico; sin fuentes y aclarando que es una idea general.
 *  - pregunta de materia sin apuntes relevantes (y no básica) → "No encuentro eso…" fijo, SIN llamar al LLM (no inventa).
 *  - curso sin apuntes (y pregunta no básica) → aviso fijo, SIN llamar al LLM.
 *
 * Cabeceras: X-Tutor-Turn (tipo de turno), X-Rag-Grounded y X-Rag-Sources (fuentes, JSON en URI).
 *
 * Al terminar registra UNA línea "tutor" con el tipo de turno y los tiempos de cada fase (preparar, primer
 * fragmento, total, guardar y las métricas de Ollama). Solo números: nunca la pregunta ni la respuesta.
 *
 * @param {object} p
 * @param {(answer: {text: string, kind: string, sources: {doc_id: string, score: number}[]}) => Promise<void>} [p.onAnswer]
 *   se espera ANTES de cerrar la respuesta, con el texto completo (para guardarlo). No se llama si el
 *   cliente se fue o el LLM se cortó: un turno a medias no se guarda.
 */
export async function streamTurn({ req, res, llm, rag, tenantId, courseId, mode, messages, onAnswer }) {
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  // Guardrail de entrada: RUT, correos y teléfonos no llegan al modelo (ni a la búsqueda). Se guarda lo que escribió.
  const { messages: safeMessages, redacted } = redactMessages(messages);
  const turn = await prepareTurn({ rag, tenantId, courseId, messages: safeMessages, systemPrompt: SYSTEM_PROMPTS[mode] });
  const sources = turn.kind === 'grounded' ? turn.sources : [];
  const metrics = { rag: turn.kind, best_score: turn.best ?? null, ...turn.timings, prepare_ms: elapsed(), ...(redacted && { pii_redacted: redacted }) };
  // Solo números y el tipo de turno: nunca el contenido de la pregunta ni de la respuesta (menores de edad).
  const logTurn = (extra) => req.log.info({ ...metrics, ...extra, total_ms: elapsed() }, 'tutor');

  if (turn.kind !== 'plain') {
    res.set('X-Tutor-Turn', turn.kind);
    res.set('X-Rag-Grounded', String(turn.kind === 'grounded'));
  }

  const save = async (text) => {
    if (!onAnswer) return;
    const t = performance.now();
    try {
      await onAnswer({ text, kind: turn.kind, sources });
    } catch (err) {
      // La respuesta ya se mostró: se avisa en el log (sin contenido) y no se corta al estudiante.
      req.log.warn({ err: err.message }, 'no se pudo guardar el turno del tutor');
    }
    metrics.save_ms = Math.round(performance.now() - t);
  };

  // Respuestas fijas: no se llama al LLM, así no hay nada que pueda inventar.
  if (turn.kind === 'no-info' || turn.kind === 'no-notes') {
    await save(turn.reply);
    res.status(200).type('text/plain; charset=utf-8').send(turn.reply);
    logTurn();
    return;
  }
  if (turn.kind === 'grounded') {
    res.set('X-Rag-Sources', encodeURIComponent(JSON.stringify(sources)));
  }

  const system = turn.kind === 'plain' ? SYSTEM_PROMPTS[mode] : turn.system;
  const history = turn.kind === 'plain' ? safeMessages : turn.messages;
  const prompt = [{ role: 'system', content: system }, ...history.map(({ role, content }) => ({ role, content }))];

  // Si el cliente cierra la conexión, se corta también la generación en el LLM.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  let llmStats = null;
  // Con apuntes delante, una temperatura baja mantiene al modelo pegado al texto (ver GROUNDED_TEMPERATURE).
  const stream = llm.chat(prompt, {
    signal: abort.signal,
    onStats: (s) => { llmStats = s; },
    ...(turn.temperature !== undefined && { temperature: turn.temperature }),
  });

  // Se espera el primer fragmento antes de enviar cabeceras: si el LLM está
  // caído, todavía se puede responder un 503 RFC 7807 en vez de un 200 vacío.
  let first;
  try {
    first = await stream.next();
  } catch (err) {
    // El cliente se fue antes del primer fragmento (p. ej. "nueva conversación"): no es un error del servidor.
    if (abort.signal.aborted) return;
    throw err;
  }
  metrics.first_token_ms = elapsed();

  res.status(200);
  res.type('text/plain; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Guardrail de salida: si el modelo repite una etiqueta interna del prompt, no llega al estudiante ni se guarda.
  const filter = createOutputFilter();
  let text = '';
  const emit = (piece) => {
    if (!piece) return;
    text += piece;
    res.write(piece);
  };
  try {
    if (!first.done) emit(filter.push(first.value));
    for await (const chunk of stream) emit(filter.push(chunk));
    emit(filter.flush());
    if (text) await save(text);
    res.end();
    logTurn({ llm: llmStats, ...(filter.removed && { tags_removed: filter.removed }) });
  } catch (err) {
    if (!abort.signal.aborted) req.log.warn({ err: err.message }, 'respuesta del LLM interrumpida');
    res.destroy();
  }
}
