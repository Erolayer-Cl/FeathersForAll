# Revisión de UX · Portal del estudiante (etapa 1)

- **Fecha:** 2026-10-16
- **Pantallas:** Login, Inicio, Mis cursos, Curso (y su 404), Mis notas, Configuración.
- **Referencia:** [`prototipo-portal.html`](prototipo-portal.html).
- **Cómo se hizo:**
  - El agente [`.claude/agents/revisor-ux.md`](../../../.claude/agents/revisor-ux.md) leyó el código.
  - Hubo capturas con login real en Brave headless, a 1280, 768 y 360 px.
  - Los contrastes se calcularon con la fórmula WCAG 2.2.
- **Resultado:** 31 hallazgos (2 altos, 15 medios, 14 bajos), todos corregidos en el portal. Queda abierta una propuesta de cambio en el propio prototipo (ver "Abierto").

## Resumen

Las pantallas siguen al prototipo en estructura, textos y tokens. Estas desviaciones son intencionales y están justificadas:

| Desviación | Por qué |
|---|---|
| Campo "Colegio (RBD)" en el login | El mismo correo puede existir en dos colegios ([ADR 0007](../adr/0007-autenticacion-y-privacidad.md)) |
| Sin columnas Examen, Examen Rep y Final en Mis notas | Esos datos no existen en la base |
| Asistencia "—" en Inicio | No existe en la base |
| Sin botón "Preguntar al Tutor IA" | El tutor dentro del portal llega en una próxima etapa. Se muestra "Muy pronto podrás preguntarle desde aquí" |
| Sin "Olvidé mi contraseña", "Editar perfil" ni "Cambiar contraseña" | No hay endpoints. En su lugar se explica que el colegio los gestiona |

## Hallazgos y correcciones

### Alta

| Pantalla | Problema | Corrección |
|---|---|---|
| Mis cursos, Curso | El chip neutral "Sin apuntes aún" tenía un contraste de 3,98:1 | `--fp-muted` pasa a `#5b6b80`: da 4,55:1 sobre `track`, 5,11:1 sobre `field` y 5,44:1 sobre `surface` (`styles/tokens.css`) |
| Login | El rol activo era blanco sobre `--fp-success` (2,54:1) | Fondo `--fp-success-ink` (5,48:1) |

### Media

| Pantalla | Problema | Corrección |
|---|---|---|
| Todas | El reset `.fp-root :is(h1,h2,h3,p)` anulaba los márgenes de las clases (el subtítulo y el error quedaban pegados a los campos) | `:where(.fp-root) :where(...)` en `base.css`, con especificidad cero |
| Todas | Marco blanco de 8 px por el margen del `<body>` | `body { margin: 0 }` en `portal.html` (no afecta la app del chat) |
| Login | `disabled` mientras envía hacía perder el foco | `aria-disabled` y el foco vuelve a la contraseña después de un error |
| Login | "Olvidé mi contraseña" no hacía nada | Texto de ayuda: "Pide a tu colegio que la restablezca" |
| Login, Mis cursos, Mis notas | Se usaba `outline: none` y solo quedaba un borde de 1 px | El campo del login muestra un contorno de 2 px. El buscador y el selector usan el `:focus-visible` global |
| Varias | Texto secundario a 4,47:1 sobre `field` | Se arregla con el nuevo `--fp-muted`. `--fp-placeholder` pasa a `#61708a` (4,71:1) |
| Menú | El ítem activo era blanco sobre `--fp-accent` (3,68:1) | Nuevo token `--fp-accent-solid` (acento al 78 % con negro). Los 8 acentos quedan entre 5,4:1 y 8,1:1 |
| Barra superior | Los botones de ícono bajaban a 40 y 38 px en celular | Se mantienen en 44 × 44 px |
| Todas | Al cambiar de pantalla, el lector no la anunciaba | El foco pasa a `<main>` y una región `aria-live` anuncia el título (`PortalFrame.jsx`) |
| Inicio | Si fallaba la API, los KPI mostraban "Aún no tienes notas" y no había "Reintentar" | Los KPI van dentro de `LoadState` con `onRetry` |
| Inicio, Curso | "Preguntar al Tutor IA" llevaba a una pantalla vacía | Se reemplazó por "Muy pronto podrás preguntarle desde aquí" |
| Curso | El 404 decía "No pudimos cargar esta información" y no ofrecía salida | Muestra "Curso no disponible" con la acción "Volver a Mis cursos". `LoadState` ahora tiene títulos propios para 403 y 404 |
| Mis notas | A 360 px la columna Promedio quedaba oculta y la tabla no se podía desplazar con el teclado | Se quitó `min-width`. La asignatura queda fija y el contenedor se puede enfocar (`tabIndex=0`, `role="region"`) |
| Mis notas | El nombre de cada nota solo estaba en el `title` | Además va en un texto oculto para el lector de pantalla |
| Configuración | "Editar perfil" y "Cambiar contraseña" no hacían nada | Se reemplazaron por una explicación |

### Baja

- "1 notas registradas" → plural según la cantidad.
- El KPI de promedio toma su tono de la nota: rojo bajo 4,0. Se agregó el tono `danger` al `Kpi`.
- Inicio usa el promedio del período más reciente, igual que Mis notas.
- El emoji 👋 lleva `aria-hidden`.
- Mis cursos:
  - la barra va en la escala 1,0–7,0, con `(nota − 1) / 6`;
  - los títulos pasan a `h2` (antes saltaban de `h1` a `h3`);
  - "Entrar al curso" mide 44 px de alto.
- "Profesor" → "Docente" (lenguaje neutro), con el mismo formato en todas las pantallas.
- Curso:
  - el acordeón siempre tiene su contenedor (`hidden`), así `aria-controls` es válido;
  - el chevron es un ícono del set (`ChevronDown`);
  - "pondera 1" → "Ponderación 1".
- RBD con `autoComplete="off"`.
- Alto contraste: tarjetas, KPI, chips y campos llevan contorno, como en el prototipo (`data-fp-surface`).
- Reducir animaciones: las tarjetas ya no se mueven al pasar el mouse (`data-fp-lift`).

### Abierto

- **Prototipo:** `.roles a.on` (l. 314) usa `--success` con texto blanco. Se propone usar el tono oscuro `#047857` en el diseño, igual que en el portal.

## Verificación

- Recorrido con login real (Camila en 1280 y 768 px, Javiera en 360 px): 18/18 comprobaciones.
  - guardia de rutas;
  - error de login;
  - sin scroll horizontal;
  - cierre de sesión;
  - consola sin errores.
- Frontend: 55 pruebas vitest, lint y build en verde.

## Lo que está bien (no perderlo)

- **Guardia de rutas:** no muestra ni un instante de datos mientras redirige.
- **404:** no revela si el curso existe.
- **Formato es-CL:** notas como "5,7", fechas en español y períodos como "2° semestre 2026".
- **Tabla de notas:** tiene `caption` oculto, `th scope` y se desplaza dentro de su contenedor.
- **Login:**
  - los labels envuelven los inputs;
  - el mensaje 401 es único;
  - la contraseña se borra después de un error.
- **Acordeón:** botón real con `aria-expanded`. Correcta o incorrecta se indica con texto, no solo con color.
- **Menú:** `inert` cuando está cerrado, Escape lo cierra y `aria-current` marca el ítem activo.

## Checklist para las pantallas del docente

- [ ] Cada texto llega a 4,5:1 (3:1 si es grande) en tema claro y oscuro, con los 5 acentos. Nada de texto blanco sobre `--fp-success` ni `--fp-accent` (usar `--fp-success-ink` o `--fp-accent-solid`).
- [ ] Sin `outline: none` salvo que haya un reemplazo de 2 px. Objetivos táctiles de al menos 44 px, también a 360 px.
- [ ] Toda pantalla con datos usa `LoadState`:
  - carga;
  - error con "Reintentar";
  - 403 y 404 con su propio título y una acción para volver (`notFound`);
  - vacío con texto que oriente.
  Nunca muestra "Aún no…" mientras carga o si hubo un error.
- [ ] Botones sin función todavía: se ocultan o dicen "Próximamente".
- [ ] Tablas (libro de notas):
  - contenedor con scroll que se puede enfocar;
  - primera columna fija;
  - `caption` y `scope`;
  - la información del `title` también accesible por otra vía.
- [ ] Formularios (subir apuntes, crear evaluación):
  - `label` visible;
  - errores por campo con `aria-describedby`;
  - foco al primer error;
  - el botón no pierde el foco mientras envía.
- [ ] Notas siempre con `formatNota` y `tonoNota`, plurales correctos y "Docente" en vez de "Profesor".
- [ ] Probar alto contraste, reducir animaciones, menú solo íconos y las tres densidades.
- [ ] Capturas a 360, 768 y 1280 px, en tema claro y oscuro, antes de abrir el PR.
