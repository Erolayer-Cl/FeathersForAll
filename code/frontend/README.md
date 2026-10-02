# FeathersForAll — frontend

React 19 + Vite. Recrea el handoff de Claude Design "Chat IA con menú hamburguesa": chat con el tutor IA en modo **Tutor** (con sub-modo **Pruebas**), y **Aula virtual** con sus secciones (Inicio, Mis cursos, Notas) donde se mostrarán los cursos, sin chat.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173 — necesita el backend en :3000
npm test           # Vitest: reducer del chat, cliente API, utilidades
npm run lint       # ESLint (reglas de hooks de React)
npm run build      # build de producción en dist/
```

En desarrollo, Vite reenvía `/v1` y `/health` al backend (`BACKEND_URL`, por defecto `http://localhost:3000`), así que no hace falta CORS. En producción (Vercel) la API se configura con `VITE_API_URL`.

## Estructura

```text
src/
  main.jsx, App.jsx           # composición de la pantalla
  styles/tokens.css           # tokens del diseño (colores OKLCH, tipografía, espacios, radios)
  config/modes.js             # textos por modo (los prompts viven en el backend)
  api/chatApi.js              # POST /v1/dev/chat con streaming
  features/chat/
    chatReducer.js            # estado del chat (puro y testeado)
    useChat.js                # envío, streaming y cancelación
    ChatMenu.jsx              # contenido del menú según el modo
  features/aula/AulaView.jsx  # secciones del Aula virtual (sin chat)
  hooks/                      # useCopyToClipboard, useAutoScroll
  components/                 # piezas reutilizables, cada una con su .module.css
    Logo/ IconButton/ ModeSwitch/ Header/ Composer/ EmptyState/
    Messages/ (UserBubble, AiMessage, TypingIndicator, MessageList)
    Drawer/   (Drawer, DrawerItem, DrawerAction, DrawerNav, HistoryList)
  assets/pluma.svg            # pluma limpia y transparente (se usa como máscara CSS)
```

## Convenciones

- **Colores por modo:** la raíz tiene `data-mode="tutor|aula"` y los componentes usan `--accent-base`, `--accent-soft` y `--accent-text`. Nunca colores fijos en los componentes.
- **Un componente = una carpeta** con su `.jsx` y su `.module.css`.
- **Estado del chat en el reducer;** los efectos (fetch, timers) en hooks.
- **Accesibilidad:** el menú cierra con Escape, devuelve el foco y queda `inert` cuando está cerrado; el interruptor usa `role="switch"`; se respeta `prefers-reduced-motion`.

## Pendiente del diseño

- Pantallas de Inicio, Mis cursos, Notas y Configuración (en el menú son marcadores).
- El historial vive en memoria; se persistirá en el backend cuando esté la BD.
- Las respuestas se muestran como texto plano (sin renderizar Markdown).
