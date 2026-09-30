# Política de versionado y compatibilidad de la API — AulaViva

> S05 · Aplica a `FeathersForAll/api/openapi.yaml` (contrato contract-first). Estado: propuesta del Tech Lead, por ratificar con el equipo.

## 1. Esquema de versiones

- **Versión mayor en la URL:** todas las rutas cuelgan de `/v1`. Solo un cambio incompatible crea `/v2`.
- **Versión del contrato en `info.version`** con SemVer (`MAJOR.MINOR.PATCH`):
  - `MAJOR`: cambio incompatible → nuevo prefijo de URL (`/v2`).
  - `MINOR`: cambio compatible que agrega capacidades (endpoint, campo opcional, valor de respuesta nuevo documentado).
  - `PATCH`: correcciones de documentación, ejemplos o descripciones sin efecto en el comportamiento.
- Cada cambio de `info.version` se registra en el PR que modifica el contrato.

## 2. Qué es compatible (MINOR, se puede hacer en `/v1`)

- Agregar un endpoint nuevo.
- Agregar un campo **opcional** a un request, o cualquier campo a una respuesta.
- Agregar un parámetro de query opcional.
- Agregar un código de error nuevo documentado, siempre en formato RFC 7807.

Regla para clientes (frontend y cliente TS): **ignorar campos desconocidos** en las respuestas.

## 3. Qué rompe (MAJOR, requiere `/v2`)

- Eliminar o renombrar un endpoint, campo o parámetro.
- Cambiar el tipo o el formato de un campo existente.
- Volver obligatorio un campo que era opcional.
- Cambiar el significado de un código de estado o de un valor de `enum` existente.
- Cambiar el mecanismo de autenticación o la forma de identificar el tenant.

**Nunca se elimina un campo dentro de `/v1`.** Se marca como deprecado.

## 4. Deprecación

1. Se marca en el contrato con `deprecated: true` y se explica la alternativa en `description`.
2. El backend responde con los headers `Deprecation: true` y `Sunset: <fecha>` en esa operación.
3. Plazo mínimo antes de retirar: **un semestre académico** (los colegios no deben ver cambios en periodo de pruebas).
4. Al lanzar `/v2`, `/v1` convive durante ese plazo y luego se retira.

## 5. Proceso de cambio del contrato

1. Todo cambio al comportamiento de la API empieza por un PR que modifica `api/openapi.yaml` (contract-first).
2. El PR debe pasar el lint: `npx @stoplight/spectral-cli lint api/openapi.yaml` (reglas en `.spectral.yaml`).
3. Se regenera el cliente: `cd packages/api-client && npm run generate`.
4. Se ejecutan los ejemplos contra el mock: `node api/examples/run-examples.mjs`.
5. Revisión de otro integrante (Charter) y, si hay cambio `MAJOR`, un ADR.

## 6. Convenciones fijas de la v1

- Recursos en plural y kebab-case, sin verbos (`/tutor-questions`, no `/askTutor`).
- Propiedades JSON en `snake_case`.
- Errores RFC 7807 (`application/problem+json`) con `trace_id`.
- `Idempotency-Key` (UUID) obligatoria en todo POST; respuesta cacheada 24 h.
- Paginación por cursor (`cursor`, `limit`, `next_cursor`).
- El tenant se toma del JWT, nunca de la URL.
