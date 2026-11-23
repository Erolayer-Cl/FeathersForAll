# DAST: ZAP baseline (S10)

Prueba la aplicación corriendo, no el código. Decisión: [ADR 0011](../FeathersForAll/Documentos/adr/0011-supply-chain.md).

| Archivo | Qué es |
|---|---|
| `compose.staging.yaml` | Staging efímero: PostgreSQL con datos sintéticos, API, frontend y un gateway que rutea como el Ingress |
| `gateway.conf` | NGINX del gateway. Publica un `robots.txt` con las rutas que ZAP debe visitar |
| `zap-rules.tsv` | Qué hallazgos bloquean (FAIL), cuáles solo se reportan (WARN) y las excepciones (IGNORE) |

## Cómo corre en CI

Job `dast` de `ci.yml`, después de `build-and-push`:

- En un PR usa las imágenes recién construidas.
- En `main` usa las imágenes ya firmadas, por digest y después de `cosign verify`. Si el DAST falla, el job `promote` no corre: la imagen queda firmada en GHCR pero no llega a dev.

ZAP entra con la cuenta del estudiante demo (`camila@demo-a.cl`, datos sintéticos de `90_seed_demo.sql`) y hace un escaneo pasivo: recorre el sitio y revisa las respuestas, sin enviar ataques. El reporte queda como artefacto `zap-report` del run (90 días).

## Correrlo en local

```bash
docker build -t feathersforall-api:dast code/backend
docker build -t feathersforall-web:dast code/frontend
JWT_SECRET=$(openssl rand -hex 32) docker compose -f dast/compose.staging.yaml up -d --wait

mkdir -p zap && cp dast/zap-rules.tsv zap/ && chmod -R a+rwX zap
docker run --rm --network host -v "$PWD/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://localhost:8088 -c zap-rules.tsv -m 2 -I -r zap-report.html

docker compose -f dast/compose.staging.yaml down -v
```

En Windows con Docker Desktop, `--network host` no llega al PC: usa `-t http://host.docker.internal:8088` y quita esa opción.

## Si el job se pone rojo

1. Abre el artefacto `zap-report` y busca el hallazgo marcado FAIL.
2. Si es real, se corrige en la app. Las cabeceras del frontend están en `code/frontend/security-headers.conf`.
3. Si es un falso positivo, se cambia a `IGNORE` en `zap-rules.tsv` con el motivo en la tercera columna. Va por PR, igual que una excepción VEX.

## Límites conocidos

- Es un escaneo pasivo. No prueba inyecciones ni control de acceso entre colegios; eso lo cubren las pruebas de integración de RLS y la carpeta "5 · Privacidad y permisos" de Postman.
- El spider de ZAP no ejecuta JavaScript, así que del portal ve los HTML, los assets y las rutas del `robots.txt` del gateway. Un escaneo de la API con el contrato OpenAPI (`zap-api-scan.py`) queda pendiente.
- Sin Ollama, las rutas del tutor responden 503 y no se analizan.
