# Ejemplos ejecutables del contrato (S05)

Cada `.json` describe una request real (método, path, headers, body) y el status esperado.
`run-examples.mjs` los ejecuta contra el mock o contra el backend.

```bash
# Terminal 1 (desde FeathersForAll/): mock server que responde según el contrato
npx @stoplight/prism-cli mock api/openapi.yaml

# Terminal 2 (desde FeathersForAll/)
node api/examples/run-examples.mjs
# Contra el backend local:  BASE_URL=http://localhost:3000/v1 node api/examples/run-examples.mjs
```

El mock valida cada request contra `openapi.yaml`: si un ejemplo no cumple el contrato, Prism responde 422
(así lo demuestra `05-error-sin-idempotency-key.json`).

| Archivo | Historia | Endpoint | Esperado |
|---|---|---|---|
| 01-crear-curso.json | H1 | POST /courses | 201 |
| 02-crear-evaluacion.json | H2 | POST /courses/{courseId}/assessments | 201 |
| 03-rendir-evaluacion.json | H4 | POST /assessments/{assessmentId}/submissions | 201 |
| 04-preguntar-tutor.json | H5 | POST /courses/{courseId}/tutor-questions | 202 |
| 05-error-sin-idempotency-key.json | — | POST /courses sin Idempotency-Key | 422 |

Los datos son sintéticos (el proyecto trata datos de menores).
