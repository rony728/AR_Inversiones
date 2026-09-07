BEGIN;

DO $$
DECLARE total_socios integer; total_custodias integer;
BEGIN
  SELECT count(*) INTO total_socios FROM socios WHERE nombre IN ('Rony', 'Alex', 'Brian');
  SELECT count(*) INTO total_custodias FROM custodias;
  IF total_socios <> 3 OR total_custodias <> 6 THEN
    RAISE EXCEPTION 'Semilla inválida: se esperaban 3 socios y 6 custodias';
  END IF;
END $$;

-- Inserciones básicas y comprobación de referencias para compra, inventario y préstamo.
DO $$
DECLARE rony uuid; custodia_productos uuid; custodia_prestamos uuid;
        proveedor uuid; cliente uuid; categoria uuid; producto uuid; compra uuid;
BEGIN
  SELECT id INTO rony FROM socios WHERE nombre = 'Rony';
  SELECT id INTO custodia_productos FROM custodias WHERE socio_id = rony AND actividad = 'PRODUCTOS';
  SELECT id INTO custodia_prestamos FROM custodias WHERE socio_id = rony AND actividad = 'PRESTAMOS';
  INSERT INTO proveedores (nombre) VALUES ('Proveedor de prueba') RETURNING id INTO proveedor;
  INSERT INTO clientes (nombre, identificacion) VALUES ('Cliente de prueba', 'TEST-001') RETURNING id INTO cliente;
  INSERT INTO categorias (nombre) VALUES ('Categoría de prueba') RETURNING id INTO categoria;
  INSERT INTO productos (categoria_id, codigo, nombre) VALUES (categoria, 'TEST-PROD-001', 'Producto de prueba') RETURNING id INTO producto;
  INSERT INTO compras (proveedor_id, socio_id, custodia_id, fecha, total) VALUES (proveedor, rony, custodia_productos, CURRENT_DATE, 100) RETURNING id INTO compra;
  INSERT INTO detalle_compras (compra_id, producto_id, cantidad, costo_unitario, subtotal) VALUES (compra, producto, 1, 100, 100);
  INSERT INTO inventario_por_socio (producto_id, socio_id, existencia, costo_promedio_unitario) VALUES (producto, rony, 1, 100);
  INSERT INTO prestamos (cliente_id, socio_id, custodia_id, fecha_desembolso, fecha_proximo_pago, capital_original, capital_pendiente)
  VALUES (cliente, rony, custodia_prestamos, CURRENT_DATE, CURRENT_DATE + 30, 5000, 5000);
END $$;

-- La transacción diferida debe rechazar un socio sin sus dos custodias.
DO $$
BEGIN
  BEGIN
    INSERT INTO socios (nombre) VALUES ('Socio de prueba inválido');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'La restricción de dos custodias no se aplicó';
  EXCEPTION WHEN OTHERS THEN
    IF position('exactamente una custodia' in lower(SQLERRM)) = 0 THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
