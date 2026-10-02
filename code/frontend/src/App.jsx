import { useRef, useState } from 'react';
import { Composer } from './components/Composer/Composer.jsx';
import { EmptyState } from './components/EmptyState/EmptyState.jsx';
import { Header } from './components/Header/Header.jsx';
import { MessageList } from './components/Messages/MessageList.jsx';
import { AULA, MODES } from './config/modes.js';
import { AulaView } from './features/aula/AulaView.jsx';
import { ChatMenu } from './features/chat/ChatMenu.jsx';
import { useChat } from './features/chat/useChat.js';
import { useAutoScroll } from './hooks/useAutoScroll.js';
import styles from './App.module.css';

export function App() {
  const { state, chatKey, messages, history, isLoading, showTyping, actions } = useChat();
  const [input, setInput] = useState('');
  const menuButtonRef = useRef(null);
  const isAula = state.mode === 'aula';
  const copy = MODES[chatKey];
  const modeLabel = isAula ? AULA.label : copy.label;
  const isEmpty = messages.length === 0 && !showTyping;
  // Se desplaza al final con cada mensaje nuevo, cada fragmento del streaming y al cambiar de chat.
  const scrollRef = useAutoScroll(`${chatKey}:${messages.length}:${messages.at(-1)?.text.length ?? 0}:${showTyping}`);

  function send(text) {
    setInput('');
    actions.send(text);
  }

  const composer = (
    <Composer value={input} onChange={setInput} onSubmit={send} placeholder={copy.placeholder} disabled={isLoading} />
  );

  function renderTutor() {
    if (!isEmpty) {
      return <MessageList messages={messages} streamingId={state.pending?.aiId} showTyping={showTyping} />;
    }
    return (
      <EmptyState
        label={copy.label}
        greeting={copy.greeting}
        intro={copy.intro}
        suggestions={copy.suggestions}
        onPickSuggestion={send}
        disabled={isLoading}
      >
        {composer}
      </EmptyState>
    );
  }

  return (
    <div className={styles.app} data-mode={state.mode}>
      <Header
        mode={state.mode}
        modeLabel={modeLabel}
        menuOpen={state.menuOpen}
        menuButtonRef={menuButtonRef}
        onOpenMenu={actions.openMenu}
        onSelectMode={actions.setMode}
        onToggleMode={actions.toggleMode}
      />

      <main ref={scrollRef} className={styles.main}>
        <div className={styles.column}>{isAula ? <AulaView section={state.aulaNav} /> : renderTutor()}</div>
      </main>

      {!isAula && !isEmpty && <div className={styles.bottomComposer}>{composer}</div>}

      <ChatMenu
        state={state}
        chatKey={chatKey}
        history={history}
        title={modeLabel}
        returnFocusRef={menuButtonRef}
        actions={actions}
      />
    </div>
  );
}
