# syntax=docker/dockerfile:1.7
# Frontend de FeathersForAll (React + Vite). Build con Node, se sirve como estáticos con NGINX sin root.
#
#   docker build -t feathersforall-web:dev code/frontend
#
# Runtime: nginxinc/nginx-unprivileged (uid 101, puerto 8080). No es distroless porque NGINX
# necesita su propia imagen; se usa la variante sin privilegios y solo con archivos estáticos (ADR 0006).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
# Vacío = misma URL que el sitio (el Ingress manda /v1 a la API). Para otro dominio: --build-arg VITE_API_URL=https://...
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
