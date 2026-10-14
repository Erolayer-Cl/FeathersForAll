import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Chip, PageHead } from '../../components/ui/index.js';
import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { renderInline } from '../../tutor/renderInline.jsx';
import { TUTOR_MODES, TUTOR_TEXTS } from '../../tutor/tutorTexts.js';
import { useTutorChat } from '../../tutor/useTutorChat.js';
import { useTutorStatus } from '../../tutor/useTutorStatus.js';
import styles from './TutorPage.module.css';

const STATUS_CHIP = {
  up: { tone: 'success', label: 'IA disponible' },
  down: { tone: 'warning', label: 'IA sin conexión' },
  checking: { tone: 'neutral', label: 'Comprobando…' },
};

/** Estudiante · Tutor IA (Figma: «Estudiante / Tutor IA (chat y aprendizaje guiado)»). */
export function EstudianteTutorPage() {
  const { mode, messages, isLoading, streamingId, showTyping, actions } = useTutorChat();
  const { status, recheck } = useTutorStatus();
  const [input, setInput] = useState('');
  const copy = TUTOR_MODES[mode];
  const chip = STATUS_CHIP[status];
  const isEmpty = messages.length === 0 && !showTyping;
  const hasError = messages.some((m) => m.role === 'error');

  // Si una respuesta falla, se vuelve a consultar el estado de la IA para que el aviso sea fiel.
  useEffect(() => {
    if (hasError) recheck();
  }, [hasError, recheck]);

  const send = (text) => {
    setInput('');
    actions.send(text);
  };

  return (
    <>
      <PageHead title="Tutor IA" subtitle="Pregunta sobre tus cursos y aprende paso a paso con tu asistente inteligente">
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </PageHead>

      <Card as="section" className={styles.chat} aria-label="Conversación con el Tutor IA">
        <div className={styles.bar}>
          <div className={styles.tabs} role="tablist" aria-label="Tipo de conversación">
            {Object.entries(TUTOR_MODES).map(([key, m]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === mode}
                className={`${styles.tab} ${key === mode ? styles.tabOn : ''}`}
                onClick={() => actions.setMode(key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Button variant="soft" size="sm" onClick={actions.clear} disabled={isEmpty} className={styles.newChat}>
            <Icon name="plus" size={15} /> Nueva conversación
          </Button>
        </div>

        {isEmpty ? (
          <div className={styles.empty}>
            <PortalLogo size={64} />
            <h2>{copy.greeting}</h2>
            <p>{copy.intro}</p>
            <div className={styles.suggestions}>
              {copy.suggestions.map((s) => (
                <button key={s} type="button" className={styles.suggestion} onClick={() => send(s)} disabled={isLoading}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            streamingId={streamingId}
            showTyping={showTyping}
            onRetry={actions.retry}
            retryDisabled={isLoading}
          />
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={send}
          onStop={actions.stop}
          isLoading={isLoading}
          placeholder={copy.placeholder}
        />
      </Card>
    </>
  );
}

function MessageList({ messages, streamingId, showTyping, onRetry, retryDisabled }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const [copiedId, setCopiedId] = useState(null);
  const last = messages.at(-1);

  // Sigue el final de la conversación mientras llega la respuesta, salvo que la persona haya subido a leer.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.text.length, showTyping]);

  const onScroll = () => {
    const el = ref.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const copy = async (m) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1800);
    } catch {
      /* sin permiso del portapapeles */
    }
  };

  return (
    <div ref={ref} className={styles.list} onScroll={onScroll} role="log" aria-live="polite" aria-busy={streamingId !== null || showTyping}>
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className={styles.userRow}>
              <p className={styles.userBubble}>{m.text}</p>
            </div>
          );
        }
        const isError = m.role === 'error';
        return (
          <div key={m.id} className={styles.aiRow}>
            <PortalLogo size={36} className={styles.avatar} />
            <div className={styles.aiCol}>
              <div className={`${styles.aiBubble} ${isError ? styles.errorBubble : ''}`} role={isError ? 'alert' : undefined}>
                {isError ? m.text : renderInline(m.text)}
              </div>
              {isError && (
                <button type="button" className={styles.action} onClick={onRetry} disabled={retryDisabled}>
                  <Icon name="retry" size={14} /> Reintentar
                </button>
              )}
              {!isError && m.id !== streamingId && (
                <button type="button" className={styles.action} onClick={() => copy(m)} aria-label="Copiar respuesta">
                  <Icon name={copiedId === m.id ? 'tick' : 'copy'} size={14} /> {copiedId === m.id ? 'Copiado' : 'Copiar'}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {showTyping && (
        <div className={styles.aiRow}>
          <PortalLogo size={36} className={styles.avatar} />
          <div className={`${styles.aiBubble} ${styles.typing}`} role="status" aria-label="El tutor está escribiendo">
            <span /><span /><span />
          </div>
        </div>
      )}
    </div>
  );
}

function Composer({ value, onChange, onSubmit, onStop, isLoading, placeholder }) {
  const areaRef = useRef(null);
  const canSend = !isLoading && value.trim().length > 0;

  // El campo crece con el texto (hasta unas 5 líneas).
  useLayoutEffect(() => {
    const el = areaRef.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [value]);

  const submit = (e) => {
    e.preventDefault();
    if (canSend) onSubmit(value);
  };

  return (
    <form className={styles.composer} onSubmit={submit}>
      <label className={styles.srOnly} htmlFor="tutor-input">Mensaje para el tutor</label>
      <textarea
        id="tutor-input"
        ref={areaRef}
        className={styles.input}
        rows={1}
        value={value}
        placeholder={placeholder}
        maxLength={TUTOR_TEXTS.maxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter envía; Shift+Enter hace un salto de línea. No se envía mientras se compone con IME.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
        }}
      />
      {isLoading ? (
        <button type="button" className={`${styles.send} ${styles.stop}`} onClick={onStop} aria-label="Detener respuesta">
          <Icon name="stop" size={16} />
        </button>
      ) : (
        <button type="submit" className={styles.send} disabled={!canSend} aria-label="Enviar">
          <Icon name="send" size={20} />
        </button>
      )}
    </form>
  );
}
