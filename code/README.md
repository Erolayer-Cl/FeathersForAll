# FeathersForAll — código

| Carpeta | Qué es | Despliegue previsto (ADR 0003) |
|---|---|---|
| [`backend/`](backend/) | API Node.js + Express (monolito modular): tutor IA con RAG (Ollama + pgvector) y notas. Imagen: `Dockerfile` distroless. | Render · Kubernetes local (ADR 0006) |
| [`frontend/`](frontend/) | App React + Vite con dos entradas: `index.html` (chat del Tutor y Aula virtual) y `portal.html` (portal por rol: Estudiante, Docente y Administrador; ver `src/portal/README.md`). Imagen: `Dockerfile` con nginx-unprivileged. | Vercel · Kubernetes local (ADR 0006) |

## Levantar todo en local (3 terminales)

```bash
# 1. LLM local, solo cuando lo uses (Ctrl+C para apagarlo)
ollama serve

# 2. Backend → http://localhost:3000
cd code/backend && cp .env.example .env   # solo la primera vez
npm install && npm run dev

# 3. Frontend → http://localhost:5173 (chat) y http://localhost:5173/portal.html (portal); reenvía /v1 y /health al backend
cd code/frontend
npm install && npm run dev
```

## Calidad

```bash
cd code/backend  && npm test                 # node:test, LLM simulado (no requiere Ollama)
cd code/frontend && npm test && npm run lint && npm run build
```

## Contenedores (S07)

```bash
docker build -t feathersforall-api:dev code/backend          # imagen final distroless, usuario nonroot
docker build --target test code/backend                      # corre npm test dentro del build
docker build -t feathersforall-web:dev code/frontend
docker images | grep feathersforall                          # la API debe pesar < 200 MB
```

Despliegue en Kubernetes: [`../k8s/README.md`](../k8s/README.md).
