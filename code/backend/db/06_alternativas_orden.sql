-- 06 · Orden de las alternativas (contrato v1.4: correct_option y selected_option son ÍNDICES).
--
-- Sin una columna de orden, "la alternativa 2" no significa nada estable: ordenar por id (UUID aleatorio)
-- mezcla las alternativas entre lo que escribió el docente y lo que ve el estudiante. `orden` parte en 0.
-- La API la fija al crear la pregunta; no hay UNIQUE (pregunta_id, orden) a propósito, para no romper los
-- scripts SQL de prueba que insertan alternativas sueltas. Quien lee ordena por (orden, id).

ALTER TABLE alternativas ADD COLUMN IF NOT EXISTS orden SMALLINT NOT NULL DEFAULT 0
    CONSTRAINT ck_alternativas_orden CHECK (orden BETWEEN 0 AND 5);

-- Alternativas que ya existían (datos demo): A, B, C… según su texto.
UPDATE alternativas a
SET orden = r.n
FROM (
    SELECT id, (row_number() OVER (PARTITION BY pregunta_id ORDER BY texto, id) - 1)::smallint AS n
    FROM alternativas
) r
WHERE r.id = a.id AND a.orden <> r.n;

-- La vista del estudiante también expone el orden (columna nueva al final: CREATE OR REPLACE lo permite).
CREATE OR REPLACE VIEW alternativas_publicas WITH (security_invoker = true) AS
    SELECT id, colegio_id, pregunta_id, texto, orden
    FROM alternativas;
