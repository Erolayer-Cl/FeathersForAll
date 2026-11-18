-- 07 · Índices del RAG (búsqueda por palabras).
--
-- La rama léxica de la búsqueda híbrida calculaba to_tsvector('spanish', chunk_texto) al vuelo por cada fila
-- del curso en cada pregunta. Con las Bases del Mineduc (miles de fragmentos) eso escala mal. Ahora el
-- tsvector se guarda en una columna generada y se indexa con GIN.
--
-- Ojo: agregar una columna generada STORED reescribe la tabla (bloquea apuntes_embeddings mientras dura).
-- En una base con muchos fragmentos conviene aplicarlo fuera de horario.

ALTER TABLE apuntes_embeddings
    ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', chunk_texto)) STORED;

CREATE INDEX IF NOT EXISTS idx_embeddings_tsv
    ON apuntes_embeddings USING gin (tsv);

-- Lo de HNSW + filtro por curso (hnsw.iterative_scan) no es del esquema: se aplica por sesión en
-- src/platform/db.js (opción iterativeScan de withSession), porque necesita pgvector 0.8 o superior.

-- Corrección: purgar_conversaciones_tutor() (05) es SECURITY DEFINER y fijaba search_path = public sin pg_temp.
-- Si pg_temp no aparece en la lista, PostgreSQL busca primero ahí: una tabla temporal llamada
-- conversaciones_tutor taparía la real. colegio_por_rbd() y credenciales_login() ya lo hacen bien.
ALTER FUNCTION purgar_conversaciones_tutor(timestamptz) SET search_path = public, pg_temp;
