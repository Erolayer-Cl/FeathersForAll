# Servicios gestionados — AulaViva (FeathersForAll)

> S04 · Selección y justificación de servicios gestionados. Objetivo: reducir la carga operacional del equipo. Decisión completa en [ADR 0003](../adr/0003-cloud.md). Usamos servicios gestionados donde aportan valor y mantenemos el foco en el producto educativo.

Criterio de decisión (S04): construir solo lo que diferencia al producto; si existe un servicio gestionado maduro, usarlo; evaluar operar por cuenta propia solo si el costo gestionado se dispara y hay un SRE dedicado. El equipo no tiene SRE, así que todo lo que no sea el producto (lógica de cursos, evaluaciones y Tutor IA) va gestionado.

| # | Servicio | Rol | Qué hace | Justificación | Alternativa descartada |
|---|---|---|---|---|---|
| 1 | **Vercel** | Frontend | Aplicación web (HTML + CSS + JS) desplegada en Vercel | Despliegue automático desde Git, HTTPS y CDN sin operar servidores | Servir el frontend desde el propio Express (más carga y sin CDN) |
| 2 | **Render** | Backend y PostgreSQL | Backend Node.js + Express, worker, y PostgreSQL con pgvector; aislamiento por colegio con schema/RLS | Plataforma simple para un equipo pequeño; BD administrada con backups; escala por instancias | Operar VMs o infraestructura propia; una nube completa (más piezas que aprender y operar) |
| 3 | **AWS SQS** | Procesamiento | Tareas asíncronas mediante cola (worker) | Cola gestionada sin operar broker; desacopla notificaciones y consultas largas del request | Operar RabbitMQ o Kafka propios (sobredimensionado para el piloto) |
| 4 | **AWS Secrets Manager** | Seguridad | Gestión de secretos y credenciales (API keys, credenciales de BD y LLM) | Secretos fuera del código y del repo; rotación y control de acceso | Secretos en `.env` versionado o en el repo (prohibido) |
| 5 | **Amazon CloudWatch** | Observabilidad | Logs, métricas, alarmas y monitoreo | Centraliza registros y métricas (factor 11) sin montar una pila propia | Operar Grafana/ELK propios |

## Dónde se usa cada servicio (C4 L2)

| Contenedor del C4 L2 | Tecnología | Servicio |
|---|---|---|
| Aplicación Web (Frontend) | HTML + CSS + JavaScript | Vercel |
| Backend monolítico (API) | Node.js + Express | Render |
| Servicio Tutor IA | RAG + pgvector | Render (asumido, por confirmar) |
| Worker / cola | Node.js + worker | Render + AWS SQS |
| Base de datos | PostgreSQL + pgvector | Render |
| Secretos | — | AWS Secrets Manager |
| Logs y métricas | — | Amazon CloudWatch |

Sistemas externos (no gestionados por el equipo): Proveedor LLM (API externa), Email/SMTP y Auth institucional (SSO/OAuth2).

## Trazabilidad: historia → componentes → cloud

| Historia de usuario | Componentes involucrados | Cloud |
|---|---|---|
| H1 Crear cursos y matricular estudiantes | Aplicación Web → Backend → PostgreSQL | Vercel → Render → Render PostgreSQL |
| H2 Crear evaluación auto-corregida | Aplicación Web → Backend → PostgreSQL | Vercel → Render → Render PostgreSQL |
| H3 Ver dashboard de resultados | Aplicación Web → Backend → PostgreSQL | Vercel → Render → Render PostgreSQL |
| H4 Rendir evaluación y recibir feedback | Aplicación Web → Backend → PostgreSQL | Vercel → Render → Render PostgreSQL |
| H5 Consultar Tutor IA | Aplicación Web → Backend → Servicio Tutor IA → LLM | Tutor IA → Render → SQS → LLM |

## Riesgos a vigilar

- Dependencia de tres proveedores: mantener la configuración por variables de entorno (factor 4) para poder cambiar de proveedor.
- Costos variables por consumo: activar alarmas de gasto y medir el uso del LLM por tenant (FinOps).
- Datos de menores: confirmar regiones de Render y AWS y qué datos llegan a cada servicio.
