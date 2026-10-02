# FeathersForAll — código

| Carpeta | Qué es | Despliegue previsto (ADR 0003) |
|---|---|---|
| [`backend/`](backend/) | API Node.js + Express (monolito modular). Hoy: chat con el tutor IA vía LLM local (Ollama). | Render |
| [`frontend/`](frontend/) | App React + Vite: chat del Tutor (y Pruebas) + secciones del Aula virtual (diseño de Claude Design). | Vercel |

## Levantar todo en local (3 terminales)

```bash
# 1. LLM local, solo cuando lo uses (Ctrl+C para apagarlo)
ollama serve

# 2. Backend → http://localhost:3000
cd code/backend && cp .env.example .env   # solo la primera vez
npm install && npm run dev

# 3. Frontend → http://localhost:5173 (reenvía /v1 y /health al backend)
cd code/frontend
npm install && npm run dev
```

## Calidad

```bash
cd code/backend  && npm test                 # node:test, LLM simulado (no requiere Ollama)
cd code/frontend && npm test && npm run lint && npm run build
```
