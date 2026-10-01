// Chat provisorio con el tutor IA. El historial vive solo en el navegador;
// el backend es stateless y recibe la conversación completa en cada envío.

const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');

/** @type {{role: 'user' | 'assistant', content: string}[]} */
const history = [];

function addBubble(kind, text = '') {
  const li = document.createElement('li');
  li.className = `bubble bubble--${kind}`;
  li.textContent = text; // textContent, nunca innerHTML: evita inyección de HTML
  messagesEl.append(li);
  scrollToEnd();
  return li;
}

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy) {
  input.disabled = busy;
  sendBtn.disabled = busy;
  if (!busy) input.focus();
}

async function problemDetail(res) {
  try {
    const problem = await res.json();
    return problem.detail ?? problem.title ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

async function send(text) {
  history.push({ role: 'user', content: text });
  addBubble('user', text);
  const reply = addBubble('assistant bubble--typing');
  setBusy(true);

  try {
    const res = await fetch('/v1/dev/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok) throw new Error(await problemDetail(res));

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let answer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += value;
      reply.textContent = answer;
      scrollToEnd();
    }
    reply.classList.remove('bubble--typing');
    if (!answer) throw new Error('El tutor no entregó respuesta');
    history.push({ role: 'assistant', content: answer });
  } catch (err) {
    // Se saca la pregunta del historial para no enviar una conversación a medias;
    // la burbuja queda visible junto al error.
    history.pop();
    if (!reply.textContent) reply.remove();
    else reply.classList.remove('bubble--typing');
    const detail = err instanceof TypeError ? 'Se perdió la conexión con el servidor' : err.message;
    addBubble('error', `No se pudo obtener respuesta: ${detail}`);
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = '';
  autoResize();
  send(text);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function autoResize() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}
input.addEventListener('input', autoResize);

async function checkHealth() {
  try {
    const res = await fetch('/health');
    const { llm } = await res.json();
    statusEl.textContent = llm === 'up' ? 'modelo conectado' : 'modelo desconectado (¿ollama serve?)';
    statusEl.classList.toggle('chat__status--down', llm !== 'up');
  } catch {
    statusEl.textContent = 'servidor no disponible';
    statusEl.classList.add('chat__status--down');
  }
}
checkHealth();
input.focus();
