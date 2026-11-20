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

En desarrollo, Vite reenvía `/v1` y `/health` al backend (`BACKEND_URL`, por defecto `http://localhost:3000`), así que no hace falta CORS.

### Vercel (demo pública)

El proyecto de Vercel (`feathers-for-all`) tiene como raíz `code/frontend/` y despliega cada push a `main`. La configuración está en [`vercel.json`](vercel.json):

- `/` y `/portal` redirigen a `/portal.html`. El chat de desarrollo queda en `/index.html`.
- Usa las mismas cabeceras de seguridad que [`security-headers.conf`](security-headers.conf) (CSP con `connect-src 'self'`). Si cambias una, cambia la otra.
- **Falta la API.** Hoy el portal carga, pero el login responde 404 porque `/v1` no existe en Vercel. Cuando el backend esté desplegado (Render, según el informe de la demo pública), agrega este rewrite a `vercel.json`:

  ```json
  "rewrites": [{ "source": "/v1/:path*", "destination": "https://<backend>/v1/:path*" }]
  ```

  Con el proxy el navegador ve un solo origen, así que no hace falta CORS ni tocar la CSP. No uses `VITE_API_URL` con otro dominio: la CSP bloquearía las llamadas y el backend no tiene CORS.

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

## Portal del estudiante (etapa 1)

El portal (`portal.html`) ya usa la API real:

- **Login** con RBD del colegio, correo y contraseña: `POST /v1/auth/login`. El RBD no está en el prototipo, pero hace falta porque un mismo correo puede existir en dos colegios.
- **Guardia de rutas:** sin sesión, cualquier pantalla de un rol lleva a su login (`src/portal/router/access.js`).
- **Pantallas del estudiante con datos reales:** Inicio, Mis cursos, Curso (evaluaciones con retroalimentación) y Mis notas (N1…Nk, escala 1,0–7,0, solo lectura).
- **Sesión** en `sessionStorage`, o en `localStorage` con "Recordar sesión". Se cierra sola al vencer el token o con un 401.

```bash
# con la API corriendo en :3000 (code/backend: docker compose up -d && npm run dev)
npm run dev      # http://localhost:5173/portal.html  →  RBD 99901 · camila@demo-a.cl · demo1234
```
