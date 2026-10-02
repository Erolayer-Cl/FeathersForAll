import { useCallback, useEffect, useRef, useState } from 'react';

const RESET_MS = 1600;

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

/** Copia texto y recuerda qué id se copió durante 1,6 s (para mostrar "Copiado"). */
export function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState(null);
  const timer = useRef();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
    setCopiedId(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedId(null), RESET_MS);
  }, []);

  return { copiedId, copy };
}
