# syntax=docker/dockerfile:1.7
# API de FeathersForAll (Node 22 + Express). Imagen final distroless, sin shell ni npm, usuario nonroot.
#
#   docker build -t feathersforall-api:dev code/backend
#   docker build --target test code/backend          # corre npm test dentro del build (lo usará CI en S08)
#
# Base de runtime: gcr.io/distroless/nodejs22-debian12:nonroot (ver ADR 0006).
#   - sin shell, apt ni npm  → menos CVE y nada con qué "entrar" al contenedor
#   - usuario nonroot (uid 65532) ya definido en la imagen
#   - misma versión mayor de Node que en desarrollo (package.json → engines >= 22)

ARG NODE_VERSION=22

# --- 1. deps: solo dependencias de producción (capa cacheada mientras no cambie el lockfile) ---
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# --- 2. test: dependencias completas + pruebas (no llega a la imagen final) ---
FROM node:${NODE_VERSION}-bookworm-slim AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY . .
RUN npm test

# --- 3. runtime: distroless ---
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
# Archivos de root y solo lectura para el proceso: nonroot no puede modificar el código.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER nonroot
EXPOSE 8080
# La imagen distroless ya usa "node" como ENTRYPOINT. Sin --env-file: la config llega por env (ConfigMap/Secret).
# Sin HEALTHCHECK: no hay shell ni curl; la salud la revisa Kubernetes con /livez y /readyz.
CMD ["src/server.js"]
