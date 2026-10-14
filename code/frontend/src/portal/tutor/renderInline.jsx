import { Fragment } from 'react';

/** Respuestas del tutor: respeta saltos de línea (por CSS) y muestra **negrita** sin usar innerHTML. */
export function renderInline(text) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
