# @aulaviva/api-client

Cliente TypeScript generado desde `FeathersForAll/api/openapi.yaml` (contract-first, S05).

- `src/schema.d.ts`: tipos generados con openapi-typescript. No se edita a mano.
- `src/index.ts`: cliente con openapi-fetch; agrega el Bearer token y una `Idempotency-Key` automática en los POST.

Regenerar tras cambiar el contrato:

```bash
cd FeathersForAll/packages/api-client
npm install
npm run generate
npm run typecheck
```
