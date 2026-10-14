# Portal (Estudiante · Docente · Administrador)

Carpeta **nueva y aislada**: no modifica ningún archivo existente del frontend. Convive con la app del chat sin chocar.

## Cómo verlo
```bash
npm run dev
# abre http://localhost:5173/portal.html
```
`portal.html` (en la raíz de `code/frontend/`) es una entrada aparte; `index.html` y `src/main.jsx` no se tocan.

## Por qué no interfiere
- Todo el CSS está limitado a `.fp-root` y sus variables empiezan con `--fp-` (la app del chat usa `--color-*`).
- `portal.css` lo importa solo `PortalApp.jsx`; la app del chat nunca lo carga.
- No hay selectores globales (`body`, `button`…) ni dependencias nuevas (usa React y lucide-react, que ya están).
- Rutas propias por hash: `#/portal/est-inicio`. No usa el router de nadie más.
- Las preferencias se guardan con claves `fp:*` en localStorage.

## Mapa de carpetas
```text
portal.html                      entrada aparte para ver el portal
src/portal/
  main.jsx, index.js             arranque propio / API pública (PortalApp)
  PortalApp.jsx                  proveedor de preferencias + marco
  portal.css                     único CSS global (importa styles/)
  styles/                        tokens.css (claro y oscuro), preferences.css, base.css
  preferences/                   personalización completa
    preferences.js (+ .test.js)  valores válidos, guardado, acento, atributos CSS (lógica pura y probada)
    PreferencesProvider.jsx, usePreferences.js, PreferencesContext.js
    PreferencesPanel/            panel «Personalizar»
  dev/                           DevPageJumper (solo pruebas, detrás de SHOW_DEV_TOOLS)
  config/
    devFlags.js                  interruptores de pruebas (herramientas y datos de ejemplo)
    roles.js                     menú de cada rol (agregar una sección = una línea)
    routes.js (+ .test.js)       las 34 pantallas del Figma (solo datos)
  router/                        usePortalRoute, PortalLink, useMediaQuery
  layout/                        PortalFrame (aplica preferencias) y PortalShell (menú + barra superior)
  components/                    ui/ (Button, Card, Chip, Kpi, PageHead, Switch), PortalLogo, icons.jsx
  data/mock.js                   datos de ejemplo (se elimina cuando haya API)
  api/tutorApi.js (+ .test.js)   ÚNICO punto de contacto con la IA (streaming, /health, modo demo)
  tutor/                         estado del chat: tutorReducer (+ test), useTutorChat, useTutorStatus, textos
  pages/
    index.jsx                    registro: id de ruta → pantalla
    login/, estudiante/, shared/ pantallas hechas: Login ×3, Estudiante · Inicio, Estudiante · Tutor IA, Configuración ×3
```

## Herramientas solo para pruebas (no son del producto final)
`config/devFlags.js` tiene el interruptor `SHOW_DEV_TOOLS`: muestra el **selector de rol** de la barra superior y el botón flotante **«Pantallas»** para saltar a cualquier pantalla. Por defecto se ven con `npm run dev` y desaparecen en `npm run build`. Ahí mismo está `SHOW_DEMO_DATA` (datos de ejemplo).
En el producto, el rol se decide al iniciar sesión.

## Contenido que crece (cursos, evaluaciones, colegios…)
- **Pantallas = tipos, no elementos.** Hay una sola pantalla «Curso» y sirve para cualquier curso: la URL lleva el id (`#/portal/est-curso/12`) y el componente lo recibe como `param`. Se enlaza con `<PortalLink to="est-curso" param={curso.id}>`. Las rutas con `detail: true` en `config/routes.js` son de este tipo.
- **Las listas salen de los datos**, no del código: se dibujan con `.map()` sobre lo que entregue la API. Con 0, 3 o 300 elementos el código es el mismo.
- **Vacío:** toda lista debe mostrar `<EmptyState>` cuando no hay elementos (ya lo usa Estudiante · Inicio).
- **El menú no cambia** con los datos: sus secciones son fijas por rol. Lo que cambia es el contenido de cada sección.
- **Id que no existe:** cada pantalla de detalle debe mostrar un aviso «no encontrado» (pendiente de construir con la API).
- Cuando haya muchos elementos (cientos de usuarios, por ejemplo) hará falta paginación o búsqueda en el servidor; se agrega en cada lista.

## Personalización incluida
Tema claro/oscuro/automático, 5 colores de acento, tamaño del contenido, tipografía (original, alta legibilidad, del sistema), densidad, esquinas, menú solo íconos, reducir animaciones y alto contraste. Botón de paleta en la barra superior y en el login.

## Cómo agregar una pantalla nueva
1. Crea `src/portal/pages/<rol>/MiPantalla.jsx` (usa `components/ui`).
2. Regístrala en `pages/index.jsx`: `'est-cursos': EstudianteCursosPage,`.
3. Si es una sección nueva del menú, agrégala en `config/roles.js` y su ruta en `config/routes.js`.
Las pantallas sin registrar muestran un marcador con su nombre del Figma.

## Convenciones (iguales a las del proyecto)
Un componente = una carpeta con su `.jsx` y su `.module.css`; colores solo con tokens `--fp-*`; lógica pura en archivos aparte con tests; accesibilidad (foco, Escape, `inert`, `role="switch"`, reduce-motion).

## Usarlo dentro de la app principal (opcional, no aplicado)
```jsx
import { PortalApp } from './portal';
// …en el lugar donde quieras mostrarlo:
<PortalApp />
```
Para que `portal.html` también salga en `npm run build`, en `vite.config.js` agrega:
```js
build: { rollupOptions: { input: { main: 'index.html', portal: 'portal.html' } } },
```

## Pendiente
- Las otras 27 pantallas del Figma (hoy marcador).
- Conectar login y datos a la API (`TODO(auth)` en `LoginPage.jsx`; reemplazar `data/mock.js`). Cursos, evaluaciones y notas los crean admin y docentes: por eso las pantallas arrancan vacías (`SHOW_DEMO_DATA = false` en `config/devFlags.js`; ponlo en `true` solo para ver el diseño con ejemplos). El usuario del menú y el perfil (`DEMO_USER`, `PERFIL_DEMO`) también son de ejemplo hasta que haya sesión.

## Tutor IA (`est-tutor`) — cómo se conecta con la IA
La pantalla (`pages/estudiante/TutorPage.jsx`) ya funciona contra el backend actual. No importa nada de `features/chat`: el portal sigue aislado.
- **Contrato** (en `api/tutorApi.js`): `POST /v1/dev/chat` con `{ mode: 'tutor' | 'pruebas', messages: [{role: 'user'|'assistant', content}] }` → respuesta en streaming de texto. Errores RFC 7807 (`detail`). `GET /health` → `{ llm: 'up' | 'down' }` (alimenta el chip «IA disponible / sin conexión»).
- **Si el backend cambia** (otra ruta, autenticación, `POST /courses/{courseId}/tutor-questions`): se edita solo `api/tutorApi.js`; la pantalla y el estado no se tocan. Hay un `TODO(api)` ahí.
- **En desarrollo**, el proxy de Vite (`/v1`, `/health` → `localhost:3000`) ya existe en `vite.config.js`. En producción define `VITE_API_URL`.
- **Sin backend** (para trabajar el diseño): crea `.env.local` con `VITE_TUTOR_MOCK=1` y el tutor responde con un texto de ejemplo en streaming.
- Incluye: dos conversaciones independientes (Modo estudio / Pruebas), enviar con Enter (Shift+Enter = salto de línea), botón Detener, Copiar, Reintentar tras un error, «Nueva conversación», puntos de «escribiendo…» y seguimiento del final mientras llega la respuesta.
- Las conversaciones viven en memoria (se pierden al recargar), igual que en la app del chat. Guardarlas requiere endpoints de historial.
