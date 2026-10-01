# FeathersForAll — backend (paso 1: chat con IA local)

Monolito modular Node.js + Express (ADR 0002). Por ahora solo trae el módulo `tutor` con un chat de desarrollo contra un LLM local (Ollama), sin base de datos.

## Requisitos

- Node.js ≥ 22
- Ollama, levantado **a mano** (no como servicio de arranque):

```bash
sudo pacman -S ollama        # no hace falta systemctl enable
ollama serve                 # terminal aparte; Ctrl+C para apagarlo
ollama pull qwen2.5:3b       # solo la primera vez
```

## Uso

```bash
cp .env.example .env
npm install
npm run dev                  # http://localhost:3000
npm test                     # no necesita Ollama (LLM simulado)
```

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health` | `{ status, llm: "up" \| "down" }` |
| POST | `/v1/dev/chat` | `{ messages: [{ role: "user" \| "assistant", content }] }` → respuesta en streaming (`text/plain`). Ruta de desarrollo, fuera del contrato OpenAPI. |
| GET | `/` | UI provisoria del chat con burbujas |

Los errores usan RFC 7807 (`application/problem+json`, con `trace_id`). Si Ollama no responde, el chat devuelve `503` y el resto del servidor sigue funcionando.

## Estructura

```text
src/
  server.js                 # config por env, arranque y apagado graceful
  app.js                    # Express: middlewares, rutas, errores
  platform/                 # trace_id + logs JSON, errores RFC 7807
  modules/tutor/
    llm-client.js           # única pieza que conoce a Ollama
    tutor.routes.js         # POST /v1/dev/chat
    system-prompt.js
public/                     # HTML/CSS/JS del chat (se reemplaza con el diseño final)
test/
```

Para cambiar de modelo o de proveedor basta con cambiar `LLM_MODEL` / `LLM_ENDPOINT` en `.env` (o `llm-client.js` si es otro proveedor).
