-- =============================================================================
-- Datos de DEMO para desarrollo local (NO ejecutar en producción)
-- =============================================================================
--
--     psql -d feathersforall -v ON_ERROR_STOP=1 -f 90_seed_demo.sql
--
-- Requiere 01 + 02 + 03. Se ejecuta con un superusuario o con
-- feathersforall_plataforma (BYPASSRLS). Los UUID son fijos para poder
-- generar tokens de prueba (ver `npm run dev:token`).
--
-- Colegio A (11111111-…):
--   docente  Ana Rojas     a0000000-0000-0000-0000-000000000001
--   docente  Luis Pérez    a0000000-0000-0000-0000-000000000002
--   admin    Marta Soto    a0000000-0000-0000-0000-000000000003
--   estudiantes            e0000000-0000-0000-0000-00000000000{1..4}
--   curso Matemáticas 7°A  c0000000-0000-0000-0000-000000000001 (Ana)
--   curso Historia 7°A     c0000000-0000-0000-0000-000000000002 (Luis)
-- Colegio B (22222222-…): un curso y un estudiante, para probar el aislamiento.
-- =============================================================================

BEGIN;

INSERT INTO colegios (id, nombre, rbd) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Colegio Demo A', '99901'),
    ('22222222-2222-2222-2222-222222222222', 'Colegio Demo B', '99902');

-- Sin login real todavía (SSO): el hash es un marcador que no valida ninguna contraseña.
INSERT INTO usuarios (id, colegio_id, nombre, email, password_hash, rol) VALUES
    ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ana Rojas',      'ana.rojas@demo-a.cl',   '!sso', 'docente'),
    ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Luis Pérez',     'luis.perez@demo-a.cl',  '!sso', 'docente'),
    ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Marta Soto',     'marta.soto@demo-a.cl',  '!sso', 'admin_colegio'),
    ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Camila Díaz',    'camila@demo-a.cl',      '!sso', 'estudiante'),
    ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Benjamín Muñoz', 'benjamin@demo-a.cl',    '!sso', 'estudiante'),
    ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sofía Herrera',  'sofia@demo-a.cl',       '!sso', 'estudiante'),
    ('e0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Tomás Fuentes',  'tomas@demo-a.cl',       '!sso', 'estudiante'),
    ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Pedro Lagos',    'pedro.lagos@demo-b.cl', '!sso', 'docente'),
    ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Javiera Núñez',  'javiera@demo-b.cl',     '!sso', 'estudiante');

-- ---------------------------------------------------------------- Colegio A
SET LOCAL app.colegio_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO cursos (id, docente_id, nombre, periodo, asignatura, nivel) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Matemáticas 7° Básico A', '2026-S2', 'Matemática', '7B'),
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Historia 7° Básico A',    '2026-S2', 'Historia',   '7B');

INSERT INTO matriculas (curso_id, estudiante_id)
SELECT c, e
FROM unnest(ARRAY['c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002']::uuid[]) c,
     unnest(ARRAY['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
                  'e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004']::uuid[]) e;

-- Evaluaciones de Matemáticas: una cerrada, una publicada (pondera doble) y un borrador.
INSERT INTO evaluaciones (id, curso_id, titulo, estado, fecha_publicacion, ponderacion) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Fracciones',         'cerrada',   now() - interval '20 days', 1),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Números decimales',  'publicada', now() - interval '5 days',  2),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Porcentajes',        'borrador',  NULL,                       1),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'Pueblos originarios', 'cerrada',  now() - interval '10 days', 1);

-- 4 preguntas por evaluación, cada una con 3 alternativas (la primera es la correcta).
INSERT INTO preguntas (evaluacion_id, enunciado, orden, retroalimentacion)
SELECT e.id, format('%s — pregunta %s', e.titulo, n), n, format('Repasa el apunte de %s.', lower(e.titulo))
FROM evaluaciones e, generate_series(1, 4) n;

INSERT INTO alternativas (pregunta_id, texto, es_correcta)
SELECT p.id, format('Alternativa %s', chr(64 + k)), k = 1
FROM preguntas p, generate_series(1, 3) k;

-- Intentos: (evaluación, estudiante, cuántas preguntas acierta, enviado?)
CREATE TEMP TABLE demo_intentos (evaluacion_id uuid, estudiante_id uuid, aciertos int, enviado bool) ON COMMIT DROP;
INSERT INTO demo_intentos VALUES
    ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 4, true),   -- 7.0
    ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 3, true),   -- 5.1
    ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', 1, true),   -- 2.3
    ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 2, true),   -- 3.5
    ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 3, true),
    ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 0, true),
    ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004', 1, false),  -- en curso
    ('d0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 2, true),
    ('d0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000002', 4, true);

INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id, fecha_inicio)
SELECT e.curso_id, d.evaluacion_id, d.estudiante_id, e.fecha_publicacion + interval '1 day'
FROM demo_intentos d JOIN evaluaciones e ON e.id = d.evaluacion_id;

-- Responde correcto las primeras `aciertos` preguntas y la alternativa B en el resto.
INSERT INTO respuestas_estudiante (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, es_correcta, retroalimentacion)
SELECT i.evaluacion_id, i.id, p.id, a.id, a.es_correcta, p.retroalimentacion
FROM demo_intentos d
JOIN intentos_evaluacion i ON i.evaluacion_id = d.evaluacion_id AND i.estudiante_id = d.estudiante_id
JOIN preguntas p ON p.evaluacion_id = i.evaluacion_id
JOIN alternativas a ON a.pregunta_id = p.id
                   AND a.texto = CASE WHEN p.orden <= d.aciertos THEN 'Alternativa A' ELSE 'Alternativa B' END;

-- Mismo cálculo que ENVIAR_INTENTO en queries.js.
UPDATE intentos_evaluacion i
SET fecha_envio = i.fecha_inicio + interval '30 minutes',
    puntaje = (SELECT round(100.0 * count(*) FILTER (WHERE r.es_correcta)
                            / (SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = i.evaluacion_id), 2)
               FROM respuestas_estudiante r WHERE r.intento_id = i.id)
FROM demo_intentos d
WHERE d.evaluacion_id = i.evaluacion_id AND d.estudiante_id = i.estudiante_id AND d.enviado;

-- ---------------------------------------------------------------- Colegio B
SET LOCAL app.colegio_id = '22222222-2222-2222-2222-222222222222';

INSERT INTO cursos (id, docente_id, nombre, periodo, asignatura, nivel) VALUES
    ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'Matemáticas 7° Básico B', '2026-S2', 'Matemática', '7B');
INSERT INTO matriculas (curso_id, estudiante_id) VALUES
    ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002');
INSERT INTO evaluaciones (id, curso_id, titulo, estado, fecha_publicacion) VALUES
    ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'Diagnóstico', 'cerrada', now() - interval '3 days');
INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id, fecha_inicio, fecha_envio, puntaje) VALUES
    ('c0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002',
     now() - interval '2 days', now() - interval '2 days' + interval '20 minutes', 80);

COMMIT;
