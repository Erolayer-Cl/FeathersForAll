import { useCopyToClipboard } from '../../hooks/useCopyToClipboard.js';
import { AiMessage } from './AiMessage.jsx';
import { TypingIndicator } from './TypingIndicator.jsx';
import { UserBubble } from './UserBubble.jsx';

/**
 * @param {{
 *   messages: {id: string, role: 'user' | 'ai' | 'error', text: string}[],
 *   streamingId?: string | null, showTyping?: boolean,
 * }} props
 */
export function MessageList({ messages, streamingId = null, showTyping = false }) {
  const { copiedId, copy } = useCopyToClipboard();

  return (
    <>
      {messages.map((m) =>
        m.role === 'user' ? (
          <UserBubble key={m.id} text={m.text} />
        ) : (
          <AiMessage
            key={m.id}
            text={m.text}
            isError={m.role === 'error'}
            streaming={m.id === streamingId}
            copied={copiedId === m.id}
            onCopy={() => copy(m.text, m.id)}
          />
        ),
      )}
      {showTyping && <TypingIndicator />}
    </>
  );
}
