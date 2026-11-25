// Guardrails del tutor (IA responsable): lo que entra al modelo y lo que sale hacia el estudiante.
//
// Entrada  · redactPii: quita datos personales (RUT, correo, teléfono) de los mensajes ANTES de mandarlos al LLM.
//            Los estudiantes son menores de edad y el proveedor del modelo puede cambiar (hoy Ollama local; mañana
//            uno externo): el modelo no necesita esos datos para explicar una materia.
// Salida   · createOutputFilter: quita del texto del modelo las etiquetas internas del prompt (<apuntes>, <nociones>…)
//            si las repite. Funciona en streaming: una etiqueta puede llegar partida entre dos fragmentos.
//
// Los otros guardrails viven donde se aplican: tope de preguntas (tutor-limit.js), revisión de apuntes al subir
// (rag/injection-scan.js), respuestas fijas sin LLM cuando no hay información (rag/rag-prompt.js) y las reglas del
// prompt (system-prompt.js). El inventario completo está en Documentos/ia/guardrails.md.

// RUT chileno: 12.345.678-9, 12345678-9, 1234567-K. Exige el guion para no confundirlo con un número cualquiera.
const RUT = /\b\d{1,2}(?:\.\d{3}){2}-[\dkK]\b|\b\d{7,8}-[\dkK]\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
// Teléfono chileno: +56 9 1234 5678, 56912345678, 9 1234 5678, 912345678 (móvil de 9 dígitos que empieza en 9).
const PHONE = /(?:\+?56[\s-]?)?\b9[\s-]?\d{4}[\s-]?\d{4}\b/g;

const PII = [
  { tipo: 'rut', re: RUT, reemplazo: '[RUT]' },
  { tipo: 'correo', re: EMAIL, reemplazo: '[correo]' },
  { tipo: 'telefono', re: PHONE, reemplazo: '[teléfono]' },
];

/**
 * Reemplaza RUT, correos y teléfonos por un marcador.
 * @param {string} text
 * @returns {{text: string, found: Record<string, number>}} found: cuántos de cada tipo (para el log; nunca el dato)
 */
export function redactPii(text) {
  const found = {};
  let out = text;
  for (const { tipo, re, reemplazo } of PII) {
    out = out.replace(re, () => {
      found[tipo] = (found[tipo] ?? 0) + 1;
      return reemplazo;
    });
  }
  return { text: out, found };
}

/**
 * Aplica redactPii a los mensajes del estudiante (las respuestas del asistente no se tocan).
 * @param {{role: string, content: string}[]} messages
 * @returns {{messages: {role: string, content: string}[], redacted: number}}
 */
export function redactMessages(messages) {
  let redacted = 0;
  const out = messages.map((m) => {
    if (m.role !== 'user') return m;
    const r = redactPii(m.content);
    redacted += Object.values(r.found).reduce((a, b) => a + b, 0);
    return r.text === m.content ? m : { ...m, content: r.text };
  });
  return { messages: out, redacted };
}

// Etiquetas que usa el prompt para delimitar material (rag-prompt.js). El estudiante nunca debería verlas.
const INTERNAL_TAG = /<\s*\/?\s*(?:apuntes|temas|nociones|calculo|cálculo|sistema|system)\s*>/gi;
// Un "<" sin cerrar al final de un fragmento puede ser el comienzo de una etiqueta: se guarda hasta el siguiente.
const MAX_TAG = 16;

/** Quita las etiquetas internas de un texto completo (también limpia los espacios que quedan). */
export function stripInternalTags(text) {
  return text.replace(INTERNAL_TAG, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:!?])/g, '$1');
}

/**
 * Filtro para streaming. push(chunk) devuelve lo que ya se puede enviar; flush() lo que quedó guardado al final.
 * Un `<` al final del fragmento se retiene (hasta MAX_TAG caracteres) por si es una etiqueta partida.
 */
export function createOutputFilter() {
  let pending = '';
  let removed = 0;
  const clean = (s) => s.replace(INTERNAL_TAG, () => {
    removed++;
    return '';
  });
  return {
    push(chunk) {
      const text = pending + chunk;
      const lt = text.lastIndexOf('<');
      if (lt !== -1 && !text.includes('>', lt) && text.length - lt <= MAX_TAG) {
        pending = text.slice(lt);
        return clean(text.slice(0, lt));
      }
      pending = '';
      return clean(text);
    },
    flush() {
      const rest = clean(pending);
      pending = '';
      return rest;
    },
    get removed() {
      return removed;
    },
  };
}
