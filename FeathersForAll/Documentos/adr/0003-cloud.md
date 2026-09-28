# ADR 0003 · Decisión cloud: arquitectura híbrida Vercel + Render + AWS

## Estado

Aceptado — 2026-09-28. Decisión presentada por el equipo en la sesión S04 (deck del equipo); pendiente de ratificar en reunión y de confirmar los puntos abiertos al final.

## Contexto

Se toma la arquitectura definida en S03 (ADR 0002: modular monolith con Node.js + Express y PostgreSQL) y se adapta para funcionar de forma segura, escalable y mantenible en la nube. Fuerzas en juego: equipo de 6 personas sin DevOps dedicado, MVP en etapa inicial, arquitectura ya definida en S03 y Tutor IA que debe poder extraerse en el futuro. La auditoría 12-Factor ([checklist](../12-factor-checklist.md)) detectó 3 factores que cumplen y 9 parciales, con brechas en configuración, despliegue, disponibilidad, logs y ambientes.

## Decisión

Mantener el monolito modular y utilizar una **arquitectura cloud híbrida** para el piloto:

- **Vercel** para el frontend (HTML + CSS + JavaScript).
- **Render** para el backend (Node.js + Express), el worker y la base de datos PostgreSQL (con pgvector).
- **AWS SQS** para tareas asíncronas mediante cola.
- **AWS Secrets Manager** para gestión de secretos y credenciales.
- **Amazon CloudWatch** para logs, métricas y alarmas.

El detalle y la justificación por servicio están en [managed-services.md](../cloud/managed-services.md); el C4 L2 actualizado, en [c4/l2-container.puml](../c4/l2-container.puml).

## Beneficios

- Menor carga operacional: el equipo no opera servidores, colas ni BD.
- Escalabilidad (instancias adicionales en periodos de pruebas).
- Servicios administrados.
- Mantiene la arquitectura de S03.
- Equipo enfocado en el producto educativo.

## Consecuencias / trade-offs

- Dependencia de varios proveedores (Vercel, Render, AWS).
- Costos variables por consumo.
- Nueva curva de aprendizaje cloud.
- La decisión prioriza simplicidad operacional y aprovecha infraestructura ya definida.
- Consecuencia técnica que se desprende de separar frontend y backend: el frontend en Vercel llama a la API en Render desde otro origen, por lo que hay que configurar CORS y la estrategia de autenticación entre dominios.

## Alternativas descartadas

- **Microservicios:** mayor complejidad operacional para el equipo actual.
- **Serverless puro:** no es necesario para el MVP y no aporta una ventaja suficiente en esta etapa.

## Puntos abiertos

- Región de Render y AWS (datos de menores): definir y documentar antes del piloto.
- Hosting del Servicio Tutor IA: el deck lo dibuja como contenedor propio sin indicar plataforma; se asume Render junto al backend hasta confirmar.
- Cómo se envían los logs de Render a CloudWatch (agente o exportación) para cumplir el factor 11.

## Fecha

2026-09-28

## Autores

Equipo AulaViva (redacción: Tech Lead, a partir del deck de S04)
