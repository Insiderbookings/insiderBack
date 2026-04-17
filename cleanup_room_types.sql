-- ---------------------------------------------------------------
-- Limpieza de room types acumulados por sync con soft-delete.
-- El sync usaba paranoid destroy (SET deleted_at) en vez de
-- hard DELETE, acumulando cientos de filas obsoletas por hotel.
--
-- Este script:
-- 1. Muestra cuántas filas hay (activas vs soft-deleted)
-- 2. Elimina PERMANENTEMENTE las filas soft-deleted (deleted_at IS NOT NULL)
-- 3. Muestra el resultado final
--
-- Correr desde pgAdmin o psql contra la DB "insider".
-- ---------------------------------------------------------------

-- Diagnóstico previo
SELECT
  'soft-deleted (deleted_at IS NOT NULL)' AS estado,
  COUNT(*) AS filas
FROM webbeds_hotel_room_type
WHERE deleted_at IS NOT NULL
UNION ALL
SELECT
  'activas (deleted_at IS NULL)' AS estado,
  COUNT(*) AS filas
FROM webbeds_hotel_room_type
WHERE deleted_at IS NULL;

-- Top 10 hoteles con más filas activas (los sospechosos)
SELECT hotel_id, COUNT(*) AS total_filas, COUNT(DISTINCT roomtype_code) AS codigos_unicos
FROM webbeds_hotel_room_type
WHERE deleted_at IS NULL
GROUP BY hotel_id
ORDER BY total_filas DESC
LIMIT 10;

-- ---------------------------------------------------------------
-- EJECUTAR ESTO para limpiar soft-deleted rows:
-- ---------------------------------------------------------------
DELETE FROM webbeds_hotel_room_type WHERE deleted_at IS NOT NULL;

-- Para hoteles con múltiples filas ACTIVAS del mismo código
-- (duplicados de distintas páginas del mismo sync), también limpiamos:
-- Mantiene solo la fila con más imágenes por (hotel_id, roomtype_code).
DELETE FROM webbeds_hotel_room_type
WHERE deleted_at IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (hotel_id, roomtype_code) id
    FROM webbeds_hotel_room_type
    WHERE deleted_at IS NULL
    ORDER BY hotel_id, roomtype_code,
      CASE WHEN jsonb_typeof(raw_payload->'roomImages') = 'array'
           THEN jsonb_array_length(raw_payload->'roomImages')
           ELSE 0 END DESC,
      id DESC
  );

-- Resultado final
SELECT
  COUNT(*) AS filas_restantes,
  COUNT(DISTINCT hotel_id) AS hoteles,
  COUNT(DISTINCT roomtype_code) AS codigos_unicos
FROM webbeds_hotel_room_type
WHERE deleted_at IS NULL;
