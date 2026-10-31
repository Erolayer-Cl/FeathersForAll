import { useState } from 'react';
import { deleteTutorConversation, getMyGrades, getTutorConversations } from '../../../api/portalApi.js';
import { MAX_API_CONTENT } from '../../../features/chat/chatReducer.js';
import { useAutoScroll } from '../../../hooks/useAutoScroll.js';
import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { Button, Card, Chip, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useSession } from '../../session/useSession.js';
import { useTutorChat } from '../../hooks/useTutorChat.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { activeConversationId, chooseConversation, pickCourse, shortDate } from '../../utils/tutorChat.js';
import styles from './TutorPage.module.css';

// Modos del backend (src/modules/tutor/system-prompt.js): el prompt vive en el servidor, aquí solo se elige.
const MODOS = {
  tutor: {
    label: 'Estudiar',
    greeting: '¿En qué puedo ayudarte hoy?',
    intro: 'Te explico la materia paso a paso con los apuntes de tu curso y luego practicamos.',
    suggestions: (asignatura) => ['¿En qué me puedes ayudar?', `¿Qué es lo más importante de ${asignatura}?`, 'Tengo prueba pronto'],
  },
  pruebas: {
    label: 'Practicar una prueba',
    greeting: '¿Sobre qué tema quieres una prueba?',
    intro: 'Te hago 5 preguntas de alternativas, una a una, y al final te doy tu resultado.',
    suggestions: (asignatura) => [`Hazme una prueba de ${asignatura}`],
  },
};

const nombreRamo = (ramo) => ramo.subject ?? ramo.course;

/** Mis conversaciones guardadas del ramo: abrir, borrar y empezar una nueva. */
function Historial({ courseId, version, activeId, onOpen, onDeleted }) {
  const { token, expire } = useSession();
  const { data, loading, error, reload } = useApiData((t, o) => getTutorConversations(t, courseId, o), `${courseId}|${version}`);
  // Al refrescar tras cada respuesta se muestra la lista anterior, sin parpadeo de "cargando".
  const [last, setLast] = useState({ data: null, courseId: null });
  if (data && data !== last.data) setLast({ data, courseId });
  const list = last.courseId === courseId ? (last.data?.data ?? []) : [];
  const [deleteError, setDeleteError] = useState(null);

  async function borrar(conv) {
    if (!window.confirm(`¿Borrar la conversación «${conv.title}»? No se puede deshacer.`)) return;
    setDeleteError(null);
    try {
      await deleteTutorConversation(token, conv.id);
      onDeleted(conv.id);
    } catch (err) {
      if (err?.status === 401) expire();
      else if (err?.status === 404) onDeleted(conv.id);
      else setDeleteError('No pudimos borrar la conversación. Inténtalo de nuevo.');
    }
  }

  return (
    <Card as="section" className={styles.history} aria-labelledby="fp-tutor-historial">
      <h2 id="fp-tutor-historial">Mis conversaciones</h2>
      <p className={styles.sub}>Solo tú puedes verlas. Se guardan hasta fin de año.</p>
      {error && list.length === 0 ? (
        <p className={styles.sub} role="alert">
          No pudimos cargar tus conversaciones.{' '}
          <button type="button" className={styles.retry} onClick={reload}>
            Reintentar
          </button>
        </p>
      ) : loading && list.length === 0 ? (
        <p className={styles.sub}>Cargando…</p>
      ) : list.length === 0 ? (
        <p className={styles.sub}>Aún no tienes conversaciones en este curso: tu primera pregunta empieza una.</p>
      ) : (
        <ul className={styles.convs}>
          {list.map((c) => (
            <li key={c.id} className={c.id === activeId ? styles.convOn : ''}>
              <button
                type="button"
                className={styles.convOpen}
                onClick={() => onOpen(c)}
                aria-current={c.id === activeId ? 'true' : undefined}
              >
                <b>{c.title}</b>
                <span>
                  {MODOS[c.mode]?.label ?? c.mode} · {shortDate(c.updated_at)}
                </span>
              </button>
              <button type="button" className={styles.convDel} onClick={() => borrar(c)} aria-label={`Borrar la conversación «${c.title}»`}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleteError && (
        <p className={styles.sub} role="alert">
          {deleteError}
        </p>
      )}
    </Card>
  );
}

/** Conversación con el tutor; el ramo se elige con la flecha junto a donde se escribe (cambiarlo empieza otra conversación). */
function TutorChat({ ramo, ramos, mode, conversationId, onPickCourse, onSaved, onNew }) {
  const { messages, pendingId, busy, loading, typing, send, reset } = useTutorChat({
    courseId: ramo.course_id,
    mode,
    conversationId,
    onSaved,
  });
  const [draft, setDraft] = useState('');
  const threadRef = useAutoScroll(`${messages.length}|${messages.at(-1)?.text.length ?? 0}|${typing}`);
  const modo = MODOS[mode];
  const asignatura = nombreRamo(ramo);

  function submit(text) {
    if (busy || !text.trim()) return;
    send(text);
    setDraft('');
  }

  return (
    <Card as="section" className={styles.chat} aria-label={`Conversación con el tutor de ${asignatura}`}>
      <div className={styles.chatHead}>
        <div className={styles.who}>
          <PortalLogo size={46} />
          <div>
            <b>Pluma · Tutor IA</b>
            <span>Basado en los apuntes de {asignatura}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            onNew();
          }}
          disabled={messages.length === 0 && !conversationId}
        >
          + Nueva conversación
        </Button>
      </div>

      <div ref={threadRef} className={`${styles.thread} ${messages.length === 0 ? styles.threadEmpty : ''}`} role="log" aria-live="polite">
        {loading ? (
          <p className={styles.sub} role="status">
            Abriendo la conversación…
          </p>
        ) : messages.length === 0 ? (
          <div className={styles.welcome}>
            <PortalLogo size={88} />
            <span className={styles.tag}>{modo.label}</span>
            <h2>{modo.greeting}</h2>
            <p className={styles.sub}>{modo.intro}</p>
            <div className={styles.suggest}>
              {modo.suggestions(asignatura).map((s) => (
                <button key={s} type="button" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <p key={m.id} className={`${styles.msg} ${styles.me}`}>
                {m.text}
              </p>
            ) : (
              <div key={m.id} className={styles.aiRow}>
                <PortalLogo size={34} className={styles.avatar} />
                <div className={`${styles.msg} ${m.role === 'error' ? styles.error : ''}`} role={m.role === 'error' ? 'alert' : undefined}>
                  {m.text}
                  {m.id !== pendingId && m.sources?.length > 0 && (
                    <small className={styles.src}>Fuente · {m.sources.map((s) => s.doc_id).join(', ')}</small>
                  )}
                </div>
              </div>
            ),
          )
        )}
        {typing && (
          <div className={styles.typing} role="status" aria-label="El tutor está escribiendo">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <label className={styles.pick} title="Elige la asignatura">
          <span className="fp-sr-only">Asignatura</span>
          <select value={ramo.course_id} onChange={(e) => onPickCourse(e.target.value)}>
            {ramos.map((r) => (
              <option key={r.course_id} value={r.course_id}>
                {nombreRamo(r)}
                {r.tutor_available ? '' : ' (sin apuntes aún)'}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={16} />
        </label>
        <label className="fp-sr-only" htmlFor="fp-tutor-input">
          Escribe tu pregunta
        </label>
        <input
          id="fp-tutor-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={mode === 'pruebas' ? 'Escribe el tema o tu respuesta…' : 'Escribe tu pregunta…'}
          maxLength={MAX_API_CONTENT}
          autoComplete="off"
        />
        <button type="submit" className={styles.send} aria-label="Enviar" disabled={busy || !draft.trim()}>
          <Icon name="send" size={19} />
        </button>
      </form>
      <p className={styles.note}>
        Pluma responde solo con los apuntes que subió tu docente. Tus conversaciones se guardan hasta fin de año y solo tú puedes verlas.
      </p>
    </Card>
  );
}

/** Estudiante · Tutor IA: chat con Pluma sobre los apuntes de una asignatura (est-tutor o est-tutor/<curso>). */
export function TutorPage({ param }) {
  const { data, loading, error, reload } = useApiData(getMyGrades);
  const { navigate } = usePortalRoute();
  const [mode, setMode] = useState('tutor');
  // Conversación abierta, atada al ramo y al modo en que se abrió: si cambian, se empieza una nueva.
  const [selected, setSelected] = useState(null);
  const [version, setVersion] = useState(0);
  const ramos = data?.courses ?? [];
  const { ramo, unknown } = pickCourse(ramos, param);
  const courseId = ramo?.course_id ?? null;
  const conversationId = activeConversationId(selected, courseId, mode);

  function onSaved(id) {
    setSelected(chooseConversation(id, courseId, mode));
    setVersion((v) => v + 1);
  }

  return (
    <>
      <PageHead title="Tutor IA" subtitle="Tu asistente de aprendizaje, con los apuntes de tus cursos.">
        <div className={styles.seg} role="group" aria-label="Modo del tutor">
          {Object.entries(MODOS).map(([id, m]) => (
            <button key={id} type="button" className={mode === id ? styles.on : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>
              {m.label}
            </button>
          ))}
        </div>
      </PageHead>

      <LoadState loading={loading} error={error} onRetry={reload}>
        {ramos.length === 0 ? (
          <EmptyState title="Aún no tienes cursos">
            Cuando tu colegio te matricule en una asignatura, podrás preguntarle al tutor.
          </EmptyState>
        ) : (
          <>
            {unknown && (
              <p className={styles.notice} role="status">
                No encontramos ese curso entre los tuyos: te mostramos {nombreRamo(ramo)}.
              </p>
            )}
            <div className={styles.grid}>
              <TutorChat
                ramo={ramo}
                ramos={ramos}
                mode={mode}
                conversationId={conversationId}
                onPickCourse={(id) => navigate('est-tutor', id)}
                onSaved={onSaved}
                onNew={() => setSelected(null)}
              />

              <div className={styles.side}>
                <Historial
                  courseId={ramo.course_id}
                  version={version}
                  activeId={conversationId}
                  onOpen={(c) => {
                    setMode(c.mode);
                    setSelected(chooseConversation(c.id, ramo.course_id, c.mode));
                  }}
                  onDeleted={(id) => {
                    if (id === conversationId) setSelected(null);
                    setVersion((v) => v + 1);
                  }}
                />

                <Card as="aside" className={styles.aside}>
                  <h2>{nombreRamo(ramo)}</h2>
                  <p className={styles.sub}>
                    Docente: {ramo.teacher_name}
                    {ramo.course && ramo.course !== nombreRamo(ramo) ? ` · ${ramo.course}` : ''}
                  </p>
                  <div className={styles.status}>
                    <Chip tone={ramo.tutor_available ? 'success' : 'neutral'}>
                      {ramo.tutor_available ? 'Con apuntes del docente' : 'Sin apuntes aún'}
                    </Chip>
                  </div>
                  {!ramo.tutor_available && (
                    <p className={styles.sub}>
                      Tu docente todavía no sube apuntes de este curso: el tutor puede conversar, pero aún no responde preguntas de materia.
                    </p>
                  )}
                  <h3>Para preguntar mejor</h3>
                  <ul className={styles.tips}>
                    <li>Pregunta por un tema concreto, por ejemplo «¿qué indica el denominador?».</li>
                    <li>Si traes un ejercicio, Pluma te da pistas para que llegues tú a la respuesta.</li>
                    <li>No escribas datos personales tuyos ni de otras personas.</li>
                  </ul>
                  <PortalLink to="est-curso" param={ramo.course_id} className={styles.link}>
                    Ver el curso y mis notas →
                  </PortalLink>
                </Card>
              </div>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}
