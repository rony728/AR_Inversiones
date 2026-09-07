BEGIN;

INSERT INTO socios (nombre) VALUES ('Rony'), ('Alex'), ('Brian');

INSERT INTO custodias (socio_id, actividad, saldo_actual)
SELECT id, actividad, 0
FROM socios
CROSS JOIN (VALUES ('PRODUCTOS'::actividad_custodia), ('PRESTAMOS'::actividad_custodia)) AS actividades(actividad)
WHERE nombre IN ('Rony', 'Alex', 'Brian');

COMMIT;
