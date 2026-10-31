#!/bin/sh
# Primer arranque del contenedor de PostgreSQL (lo ejecuta /docker-entrypoint-initdb.d):
# crea el esquema (01–04), el usuario de la API feathersforall_app con sus permisos y los
# datos demo, todo con crear_bdd.sql. Solo corre con el volumen vacío; para repetirlo:
#     docker compose down -v && docker compose up -d
set -e

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v app_password="$APP_DB_PASSWORD" -v demo=1 \
     -f /schema/crear_bdd.sql
