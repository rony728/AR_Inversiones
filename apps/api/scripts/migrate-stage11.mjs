import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '../../..');
const migrationDir = path.join(projectRoot, 'database', 'migration');
const args = process.argv.slice(2);
const applying = args.includes('--apply');
const sourceArg = args.find((value, index) => !value.startsWith('--') && !['--config', '--report', '--rules'].includes(args[index - 1]));
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const sourcePath = path.resolve(sourceArg ?? path.join(projectRoot, 'AR_Inversiones_Migracion_V2.xlsx'));
const rulesPath = path.resolve(option('--rules') ?? path.join(migrationDir, 'stage11-rules.json'));
const configPath = option('--config') ? path.resolve(option('--config')) : null;
const reportPath = path.resolve(option('--report') ?? path.join(migrationDir, 'reports', applying ? 'stage11-apply.json' : 'stage11-dry-run.json'));
const requiredSheets = ['Productos', 'Ventas históricas', 'Clientes', 'Préstamos activos', 'Pagos históricos', 'Movimientos legacy', 'Distribuciones históricas', 'Pendientes revisión'];
const partners = ['Rony', 'Alex', 'Brian'];
const custodyKeys = partners.flatMap((partner) => [`${partner}.PRODUCTOS`, `${partner}.PRESTAMOS`]);

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const excelSerialToIso = (serial) => new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000).toISOString().slice(0, 10);
function valueOf(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object' && 'result' in value) return valueOf(value.result);
  if (value && typeof value === 'object' && 'text' in value) return value.text;
  return value ?? null;
}
function dateOf(value) {
  const raw = valueOf(value);
  if (typeof raw === 'number') return excelSerialToIso(raw);
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}
const numberOf = (value) => Number(valueOf(value) ?? 0);
const booleanOf = (value) => normalize(value) === 'si';
const sum = (rows, field) => Number(rows.reduce((total, row) => total + numberOf(row[field]), 0).toFixed(2));
const countBy = (rows, field) => Object.fromEntries([...rows.reduce((map, row) => map.set(String(row[field] ?? 'VACÍO'), (map.get(String(row[field] ?? 'VACÍO')) ?? 0) + 1), new Map()).entries()].sort());
function duplicateIds(rows, field) {
  const seen = new Set(); const duplicates = [];
  for (const row of rows) { const id = String(row[field] ?? ''); if (id && seen.has(id)) duplicates.push({ id, row: row.__row }); seen.add(id); }
  return duplicates;
}

async function readWorkbook() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const missingSheets = requiredSheets.filter((name) => !workbook.getWorksheet(name));
  if (missingSheets.length) throw new Error(`Faltan hojas obligatorias: ${missingSheets.join(', ')}`);
  const data = {};
  for (const sheetName of requiredSheets) {
    const sheet = workbook.getWorksheet(sheetName);
    const headers = [];
    sheet.getRow(4).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(valueOf(cell.value) ?? '').trim(); });
    data[sheetName] = [];
    for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber); const record = { __row: rowNumber };
      let populated = false;
      for (let column = 1; column < headers.length; column += 1) {
        if (!headers[column]) continue;
        const value = valueOf(row.getCell(column).value); record[headers[column]] = value;
        if (value !== null && value !== '') populated = true;
      }
      if (populated) data[sheetName].push(record);
    }
  }
  return { workbook, data };
}

function buildPlan(data, rules, config) {
  const products = data.Productos;
  const sales = data['Ventas históricas'];
  const clients = data.Clientes;
  const loans = data['Préstamos activos'];
  const payments = data['Pagos históricos'];
  const legacy = data['Movimientos legacy'];
  const distributions = data['Distribuciones históricas'];
  const checklist = data['Pendientes revisión'];
  const productIds = new Set(products.map((row) => row.producto_id));
  const clientIds = new Set(clients.map((row) => row.cliente_id));
  const excluded = new Set(rules.excludedProducts.map(normalize));
  const ignoredPrices = new Set(rules.ignoredSuggestedPrices.map(normalize));
  const stockOverrides = new Map(Object.entries(rules.stockOverrides).map(([name, stock]) => [normalize(name), Number(stock)]));
  const rateOverrides = new Map(Object.entries(rules.loanRateOverrides).map(([name, rate]) => [normalize(name), Number(rate)]));
  const transformedProducts = products.map((row) => {
    const key = normalize(row.Nombre); const isExcluded = excluded.has(key); const stockSource = numberOf(row['Existencia inicial']);
    return { ...row, excluded: isExcluded, stockSource, stockApplied: stockOverrides.get(key) ?? stockSource, priceSuggestedApplied: ignoredPrices.has(key) ? null : row['Precio sugerido'], transformation: isExcluded ? 'EXCLUIDO_POR_DECISION_APROBADA' : stockOverrides.has(key) ? `EXISTENCIA_CORREGIDA_${stockSource}_A_${stockOverrides.get(key)}` : ignoredPrices.has(key) ? 'PRECIO_SUGERIDO_IGNORADO' : 'SIN_CAMBIO' };
  });
  const transformedLoans = loans.map((row) => ({ ...row, rateApplied: rateOverrides.get(normalize(row.Cliente)) ?? numberOf(row['Tasa aprobada %']), nextPaymentDate: dateOf(row['Próxima fecha']) }));
  const transformedPayments = payments.map((row) => ({ ...row, paymentDate: rules.paymentDateOverridesBySourceRow[String(row['Fila origen'])] ?? dateOf(row['Fecha de pago']), partnerApplied: rules.paymentPartnerOverridesBySourceRow[String(row['Fila origen'])] ?? (partners.includes(String(row['Socio responsable'])) ? row['Socio responsable'] : null) }));
  const transformedDistributions = distributions.map((row) => ({ ...row, paymentDate: rules.distributionDateOverridesBySourceRow[String(row['Fila origen'])] ?? dateOf(row['Fecha de pago']), partnerApplied: partners.includes(String(row.Socio)) ? row.Socio : null }));
  const includedProducts = transformedProducts.filter((row) => !row.excluded);
  const positiveInventory = includedProducts.filter((row) => row.stockApplied > 0);
  const missingCustodies = custodyKeys.filter((key) => !Number.isFinite(config?.custodyBalances?.[key]) || config.custodyBalances[key] < 0);
  const blockers = [];
  if (checklist.some((row) => normalize(row['Estado revisión']) !== 'aprobado')) blockers.push('Hay decisiones pendientes sin aprobación.');
  for (const [rows, field, label] of [[products, 'producto_id', 'productos'], [sales, 'venta_historica_id', 'ventas'], [clients, 'cliente_id', 'clientes'], [loans, 'prestamo_id', 'préstamos'], [payments, 'pago_historico_id', 'pagos'], [legacy, 'movimiento_legacy_id', 'movimientos legacy'], [distributions, 'distribucion_historica_id', 'distribuciones']]) {
    if (duplicateIds(rows, field).length) blockers.push(`Hay identificadores duplicados en ${label}.`);
  }
  if (sales.some((row) => !productIds.has(row.producto_id))) blockers.push('Existen ventas históricas sin producto de origen.');
  if (loans.some((row) => !clientIds.has(row.cliente_id))) blockers.push('Existen préstamos sin cliente.');
  if (payments.some((row) => !clientIds.has(row.cliente_id))) blockers.push('Existen pagos históricos sin cliente.');
  if (transformedLoans.some((row) => ![5, 10, 15].includes(row.rateApplied) || !row.nextPaymentDate || numberOf(row['Capital pendiente']) <= 0)) blockers.push('Hay préstamos activos sin tasa, fecha próxima o capital válido después de aplicar las decisiones.');
  if (transformedProducts.some((row) => !row.excluded && (!row.producto_id || !String(row.Nombre ?? '').trim() || !Number.isInteger(row.stockApplied) || row.stockApplied < 0))) blockers.push('Hay productos operativos con datos requeridos inválidos.');
  if (sales.some((row) => Math.abs(numberOf(row['Total venta']) - numberOf(row.Cantidad) * numberOf(row['Precio venta'])) > 0.005 || Math.abs(numberOf(row['Ganancia calculada']) - numberOf(row.Cantidad) * (numberOf(row['Precio venta']) - numberOf(row['Costo unitario']))) > 0.005)) blockers.push('Hay ventas históricas que no concilian matemáticamente.');
  const originalStock = sum(products, 'Existencia inicial');
  const appliedStock = Number(includedProducts.reduce((total, row) => total + row.stockApplied, 0).toFixed(0));
  const appliedStockValue = Number(includedProducts.reduce((total, row) => total + row.stockApplied * numberOf(row['Costo total unitario']), 0).toFixed(2));
  return {
    transformedProducts, includedProducts, transformedLoans, transformedPayments, transformedDistributions, missingCustodies, blockers,
    report: {
      source: { file: path.basename(sourcePath) },
      sheets: requiredSheets.map((name) => ({ name, records: data[name].length })),
      counts: { productsSource: products.length, productsToImport: includedProducts.length, productsExcluded: products.length - includedProducts.length, initialInventoryRows: positiveInventory.length, clients: clients.length, activeLoans: loans.length, historicalPayments: payments.length, historicalSales: sales.length, purchases: 0, legacyMovements: legacy.length, historicalDistributions: distributions.length, checklistDecisions: checklist.length },
      reviewStatus: { products: countBy(products, 'Estado revisión'), clients: countBy(clients, 'Estado revisión'), loans: countBy(loans, 'Estado revisión'), payments: countBy(payments, 'Estado revisión'), distributions: countBy(distributions, 'Estado revisión'), checklist: countBy(checklist, 'Estado revisión') },
      reconciliations: { stockUnitsSource: originalStock, stockUnitsAfterApprovedCorrections: appliedStock, stockCostAfterApprovedCorrections: appliedStockValue, historicalSalesAmount: sum(sales, 'Total venta'), historicalSalesProfit: sum(sales, 'Ganancia calculada'), activeLoanCapital: sum(loans, 'Capital pendiente'), activeLoanInitialInterest: sum(loans, 'Interés inicial'), historicalInterestPaid: sum(payments, 'Interés pagado'), legacyMovementAmount: sum(legacy, 'Monto'), historicalDistributions: sum(distributions, 'Monto'), custodyBalances: config?.custodyBalances ?? Object.fromEntries(custodyKeys.map((key) => [key, null])) },
      duplicates: { products: duplicateIds(products, 'producto_id'), sales: duplicateIds(sales, 'venta_historica_id'), clients: duplicateIds(clients, 'cliente_id'), loans: duplicateIds(loans, 'prestamo_id'), payments: duplicateIds(payments, 'pago_historico_id'), legacyMovements: duplicateIds(legacy, 'movimiento_legacy_id'), distributions: duplicateIds(distributions, 'distribucion_historica_id') },
      inconsistencies: {
        productRowsStillMarkedReview: products.filter((row) => row['Estado revisión'] === 'REVISAR').map((row) => row.__row),
        clientRowsStillMarkedReview: clients.filter((row) => row['Estado revisión'] === 'REVISAR').map((row) => row.__row),
        loanRowsStillMarkedReview: loans.filter((row) => row['Estado revisión'] === 'REVISAR').map((row) => row.__row),
        paymentRowsStillMarkedReview: payments.filter((row) => row['Estado revisión'] === 'REVISAR').map((row) => row.__row),
        distributionRowsStillMarkedReview: distributions.filter((row) => row['Estado revisión'] === 'REVISAR').map((row) => row.__row),
        salesWithoutDate: sales.filter((row) => !dateOf(row.Fecha)).map((row) => row.__row),
        salesWithoutFinancingPartner: sales.filter((row) => !partners.includes(String(row.Vendedor))).map((row) => row.__row),
        loansWithoutDisbursementDate: loans.map((row) => row.__row),
        paymentsWithoutDateAfterApprovedCorrections: transformedPayments.filter((row) => !row.paymentDate).map((row) => row.__row),
        paymentsWithoutPartnerAfterApprovedCorrections: transformedPayments.filter((row) => !row.partnerApplied).map((row) => row.__row),
        distributionsWithoutPartnerAfterApprovedCorrections: transformedDistributions.filter((row) => !row.partnerApplied).map((row) => row.__row),
        custodyBalancesRequiringInput: missingCustodies,
        purchasesSheetMissing: true
      },
      transformations: { excludedProducts: rules.excludedProducts, stockOverrides: rules.stockOverrides, ignoredSuggestedPrices: rules.ignoredSuggestedPrices, loanRateOverrides: rules.loanRateOverrides, paymentDateOverridesBySourceRow: rules.paymentDateOverridesBySourceRow, paymentPartnerOverridesBySourceRow: rules.paymentPartnerOverridesBySourceRow, distributionDateOverridesBySourceRow: rules.distributionDateOverridesBySourceRow, similarClients: 'Se conservan separados según las 13 decisiones aprobadas.' },
      legacyHandling: { sales: 'Se conservan en ventas_historicas porque las 82 filas no tienen fecha ni socio financiador.', payments: 'Se conservan por cliente en pagos_intereses_historicos; no se enlazan artificialmente a un préstamo.', financialMovements: 'Se conservan como referencia y no afectan saldos iniciales.', distributions: 'Se conservan individualmente y no descuentan las custodias iniciales.', purchases: 'El archivo no contiene una hoja de compras; se valida como cero.', activeLoans: 'Se importan con fecha de desembolso nula, fecha próxima original preservada y sin cálculo retroactivo anterior a la migración.' },
      requiredStartupInputs: { missingCustodyBalances: missingCustodies },
      blockers,
      status: blockers.length ? 'BLOCKED_BY_SOURCE' : missingCustodies.length ? 'READY_AFTER_STARTUP_INPUTS' : 'READY_TO_APPLY'
    }
  };
}

const quoteIdentifier = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
async function backupDatabase(client, destination) {
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map((row) => row.tablename);
  const backup = { createdAt: new Date().toISOString(), database: process.env.DATABASE_URL?.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@') ?? null, tables: {} };
  for (const table of tables) backup.tables[table] = (await client.query(`SELECT * FROM ${quoteIdentifier(table)}`)).rows;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(backup, null, 2), 'utf8');
}

async function applyMigration(data, plan, sourceHash, sourceSize, config) {
  if (plan.blockers.length) throw new Error(plan.blockers.join(' '));
  if (plan.missingCustodies.length) throw new Error('Faltan los seis saldos de custodia. Completa stage11-input.json antes de usar --apply.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const backupPath = path.join(migrationDir, 'backups', `pre-stage11-${new Date().toISOString().replaceAll(':', '-')}.json`);
  try {
    const support = await client.query(`SELECT to_regclass('public.fuentes_migracion') AS migration_table`);
    if (!support.rows[0].migration_table) throw new Error('Ejecuta primero database/migrations/003_legacy_migration_support.sql.');
    const completed = await client.query(`SELECT e.id FROM fuentes_migracion f JOIN ejecuciones_migracion e ON e.fuente_id=f.id WHERE f.sha256=$1 AND e.estado='COMPLETADA'`, [sourceHash]);
    if (completed.rowCount) return { alreadyApplied: true, executionId: completed.rows[0].id, backupPath: null };
    await backupDatabase(client, backupPath);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const occupied = await client.query(`SELECT (SELECT count(*) FROM clientes)+(SELECT count(*) FROM productos)+(SELECT count(*) FROM prestamos)+(SELECT count(*) FROM compras)+(SELECT count(*) FROM ventas) AS total`);
    if (Number(occupied.rows[0].total) !== 0) throw new Error('La migración definitiva requiere tablas operativas vacías. Se generó el respaldo antes de detenerse.');
    const source = await client.query(`INSERT INTO fuentes_migracion (nombre_archivo,sha256,tamano_bytes) VALUES ($1,$2,$3) RETURNING id`, [path.basename(sourcePath), sourceHash, sourceSize]);
    const sourceId = source.rows[0].id;
    const execution = await client.query(`INSERT INTO ejecuciones_migracion (fuente_id,modo,estado,ruta_respaldo,reporte) VALUES ($1,'DEFINITIVA','INICIADA',$2,$3) RETURNING id`, [sourceId, backupPath, plan.report]);
    const partnerRows = await client.query(`SELECT s.id,s.nombre,c.id AS custodia_id,c.actividad,c.saldo_actual FROM socios s JOIN custodias c ON c.socio_id=s.id WHERE s.nombre=ANY($1::text[]) FOR UPDATE`, [partners]);
    const partnerIds = new Map(); const custodies = new Map();
    for (const row of partnerRows.rows) { partnerIds.set(row.nombre, row.id); custodies.set(`${row.nombre}.${row.actividad}`, row); }
    if (partnerIds.size !== 3 || custodies.size !== 6) throw new Error('Deben existir Rony, Alex y Brian con sus dos custodias antes de migrar.');
    const primaryKeys = { Productos: 'producto_id', 'Ventas históricas': 'venta_historica_id', Clientes: 'cliente_id', 'Préstamos activos': 'prestamo_id', 'Pagos históricos': 'pago_historico_id', 'Movimientos legacy': 'movimiento_legacy_id', 'Distribuciones históricas': 'distribucion_historica_id', 'Pendientes revisión': 'Referencia' };
    for (const sheet of requiredSheets) for (const row of data[sheet]) {
      const productPlan = sheet === 'Productos' ? plan.transformedProducts.find((item) => item.__row === row.__row) : null;
      await client.query(`INSERT INTO filas_migracion (fuente_id,hoja,fila_excel,clave_fuente,datos_fuente,transformacion,estado) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sourceId, sheet, row.__row, row[primaryKeys[sheet]] ?? null, row, productPlan ? { action: productPlan.transformation, stockApplied: productPlan.stockApplied } : null, productPlan?.excluded ? 'EXCLUIDA' : 'CONSERVADA']);
    }
    for (const row of data.Clientes) await client.query(`INSERT INTO clientes (id,nombre,identificacion,telefono,direccion,notas) VALUES ($1,$2,$3,$4,$5,$6)`, [row.cliente_id, row.Nombre, row.Identidad || null, row.Teléfono || null, row.Dirección || null, [row.Referencias, row.Observaciones, `Fuentes: ${row.Fuentes ?? ''}`].filter(Boolean).join('\n') || null]);
    for (const row of plan.transformedProducts) {
      let productId = null;
      if (!row.excluded) {
        productId = row.producto_id;
        await client.query(`INSERT INTO productos (id,codigo,nombre,descripcion,activo,marca,modelo,sku,codigo_barras,control_serie,garantia_dias,precio_sugerido,precio_minimo,existencia_minima,fuente_migracion_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [row.producto_id, `MIG-${String(row.producto_id).slice(0, 8).toUpperCase()}`, row.Nombre, row['Observaciones de revisión'] || null, booleanOf(row.Activo), row.Marca || null, row.Modelo || null, row['SKU opcional'] || null, row['Código de barras'] || null, booleanOf(row['Control serie']), numberOf(row['Garantía días']), row.priceSuggestedApplied, row['Precio mínimo'], numberOf(row['Existencia mínima']), sourceId]);
      }
      const inventoryState = row.excluded ? 'EXCLUIDO' : row.stockApplied > 0 ? 'APLICADO' : 'APLICADO';
      await client.query(`INSERT INTO inventario_inicial_migracion (fuente_id,producto_legacy_id,producto_id,existencia_fuente,existencia_aplicada,costo_unitario,estado,observaciones) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [sourceId, row.producto_id, productId, row.stockSource, row.excluded ? 0 : row.stockApplied, numberOf(row['Costo total unitario']), inventoryState, row.transformation]);
      if (!row.excluded && row.stockApplied > 0) {
        await client.query(`INSERT INTO inventario (producto_id,existencia,costo_promedio_unitario) VALUES ($1,$2,$3)`, [row.producto_id, row.stockApplied, numberOf(row['Costo total unitario'])]);
        await client.query(`INSERT INTO movimientos_inventario (producto_id,tipo,cantidad,existencia_anterior,existencia_posterior,costo_unitario,referencia_tipo,referencia_id) VALUES ($1,'MIGRACION_INICIAL',$2,0,$2,$3,'FUENTE_MIGRACION',$4)`, [row.producto_id, row.stockApplied, numberOf(row['Costo total unitario']), sourceId]);
      }
    }
    for (const row of plan.transformedLoans) {
      const partnerId = partnerIds.get(row['Socio responsable']); const custody = custodies.get(`${row['Socio responsable']}.PRESTAMOS`);
      await client.query(`INSERT INTO prestamos (id,cliente_id,socio_id,custodia_id,fecha_desembolso,fecha_proximo_pago,tasa_mensual,capital_original,capital_pendiente,estado,observaciones,es_heredado,fecha_proximo_pago_heredada,interes_inicial_heredado,calcular_interes_desde,fuente_migracion_id) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$7,'ACTIVO',$8,true,$5,$9,CURRENT_DATE,$10)`, [row.prestamo_id, row.cliente_id, partnerId, custody.custodia_id, row.nextPaymentDate, row.rateApplied, numberOf(row['Capital pendiente']), [row['Observaciones de revisión'], `Origen: ${row['Hoja origen']}:${row['Fila origen']}`].filter(Boolean).join('; '), numberOf(row['Interés inicial']), sourceId]);
      if (numberOf(row['Interés inicial']) > 0) await client.query(`INSERT INTO intereses_prestamo (prestamo_id,fecha_vencimiento,capital_base,tasa_mensual,monto_interes,saldo_pendiente) VALUES ($1,$2,$3,$4,$5,$5)`, [row.prestamo_id, row.nextPaymentDate, numberOf(row['Capital pendiente']), row.rateApplied, numberOf(row['Interés inicial'])]);
    }
    for (const row of data['Ventas históricas']) await client.query(`INSERT INTO ventas_historicas (id,fuente_id,producto_legacy_id,producto_nombre,cantidad,costo_unitario,precio_unitario,total,ganancia,vendedor_original,fecha,observaciones,hoja_origen,fila_origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [row.venta_historica_id, sourceId, row.producto_id, row.Producto, numberOf(row.Cantidad), numberOf(row['Costo unitario']), numberOf(row['Precio venta']), numberOf(row['Total venta']), numberOf(row['Ganancia calculada']), row.Vendedor || null, dateOf(row.Fecha), row.Observaciones || null, row['Hoja origen'], row['Fila origen']]);
    for (const row of plan.transformedPayments) await client.query(`INSERT INTO pagos_intereses_historicos (id,fuente_id,cliente_id,cliente_nombre,capital_referencia,interes_pagado,tasa_catalogo,tasa_inferida,fecha_pago,socio_id,responsable_original,observaciones,hoja_origen,fila_origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [row.pago_historico_id, sourceId, row.cliente_id, row.Cliente, numberOf(row['Capital de referencia']), numberOf(row['Interés pagado']), row['Tasa catálogo %'], row['Tasa inferida %'], row.paymentDate, row.partnerApplied ? partnerIds.get(row.partnerApplied) : null, row['Responsable original'] || null, row['Observaciones de revisión'] || null, row['Hoja origen'], row['Fila origen']]);
    for (const row of data['Movimientos legacy']) await client.query(`INSERT INTO movimientos_financieros_legacy (id,fuente_id,tipo,monto,fecha,socio_id,afecta_saldo_inicial,observaciones,hoja_origen,fila_origen,columna_origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [row.movimiento_legacy_id, sourceId, row.Tipo, numberOf(row.Monto), dateOf(row.Fecha), partners.includes(String(row.Socio)) ? partnerIds.get(row.Socio) : null, booleanOf(row['Afecta saldo inicial']), row.Observaciones || null, row['Hoja origen'], row['Fila origen'], row['Columna origen']]);
    for (const row of plan.transformedDistributions) await client.query(`INSERT INTO distribuciones_utilidades_historicas (id,fuente_id,socio_id,socio_original,monto,fecha_pago,tipo,observaciones,hoja_origen,fila_origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [row.distribucion_historica_id, sourceId, row.partnerApplied ? partnerIds.get(row.partnerApplied) : null, row.Socio || (row['Fila origen'] === 96 ? 'Prestado a AR' : null), numberOf(row.Monto), row.paymentDate, row.Tipo, row['Observaciones de revisión'] || null, row['Hoja origen'], row['Fila origen']]);
    for (const key of custodyKeys) {
      const custody = custodies.get(key); const balance = Number(config.custodyBalances[key]); const before = Number(custody.saldo_actual);
      await client.query(`UPDATE custodias SET saldo_actual=$1 WHERE id=$2`, [balance, custody.custodia_id]);
      if (balance !== before) await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id) VALUES ($1,'MIGRACION_INICIAL',$2,$3,$4,'FUENTE_MIGRACION',$5)`, [custody.custodia_id, balance - before, before, balance, sourceId]);
    }
    const validation = (await client.query(`SELECT
      (SELECT count(*) FROM productos WHERE fuente_migracion_id=$1)::int AS productos,
      (SELECT coalesce(sum(existencia),0) FROM inventario)::int AS stock,
      (SELECT coalesce(sum(existencia*costo_promedio_unitario),0) FROM inventario) AS stock_cost,
      (SELECT count(*) FROM clientes)::int AS clientes,
      (SELECT count(*) FROM prestamos WHERE fuente_migracion_id=$1)::int AS prestamos,
      (SELECT coalesce(sum(capital_pendiente),0) FROM prestamos WHERE fuente_migracion_id=$1) AS capital,
      (SELECT coalesce(sum(interes_inicial_heredado),0) FROM prestamos WHERE fuente_migracion_id=$1) AS interes_inicial,
      (SELECT count(*) FROM pagos_intereses_historicos WHERE fuente_id=$1)::int AS pagos,
      (SELECT coalesce(sum(interes_pagado),0) FROM pagos_intereses_historicos WHERE fuente_id=$1) AS intereses,
      (SELECT count(*) FROM ventas_historicas WHERE fuente_id=$1)::int AS ventas,
      (SELECT coalesce(sum(total),0) FROM ventas_historicas WHERE fuente_id=$1) AS ventas_total,
      (SELECT coalesce(sum(ganancia),0) FROM ventas_historicas WHERE fuente_id=$1) AS ventas_ganancia,
      (SELECT count(*) FROM movimientos_financieros_legacy WHERE fuente_id=$1)::int AS movimientos_legacy,
      (SELECT coalesce(sum(monto),0) FROM movimientos_financieros_legacy WHERE fuente_id=$1) AS movimientos_legacy_total,
      (SELECT count(*) FROM distribuciones_utilidades_historicas WHERE fuente_id=$1)::int AS distribuciones,
      (SELECT coalesce(sum(monto),0) FROM distribuciones_utilidades_historicas WHERE fuente_id=$1) AS distribuciones_total,
      (SELECT count(*) FROM compras)::int AS compras,
      (SELECT count(*) FROM custodias)::int AS custodias`, [sourceId])).rows[0];
    const expected = { productos: plan.report.counts.productsToImport, stock: plan.report.reconciliations.stockUnitsAfterApprovedCorrections, stock_cost: plan.report.reconciliations.stockCostAfterApprovedCorrections, clientes: plan.report.counts.clients, prestamos: plan.report.counts.activeLoans, capital: plan.report.reconciliations.activeLoanCapital, interes_inicial: plan.report.reconciliations.activeLoanInitialInterest, pagos: plan.report.counts.historicalPayments, intereses: plan.report.reconciliations.historicalInterestPaid, ventas: plan.report.counts.historicalSales, ventas_total: plan.report.reconciliations.historicalSalesAmount, ventas_ganancia: plan.report.reconciliations.historicalSalesProfit, movimientos_legacy: plan.report.counts.legacyMovements, movimientos_legacy_total: plan.report.reconciliations.legacyMovementAmount, distribuciones: plan.report.counts.historicalDistributions, distribuciones_total: plan.report.reconciliations.historicalDistributions, compras: 0, custodias: 6 };
    for (const [key, expectedValue] of Object.entries(expected)) if (Number(validation[key]) !== Number(expectedValue)) throw new Error(`No concilia ${key}: esperado ${expectedValue}, obtenido ${validation[key]}.`);
    const custodyValidation = Object.fromEntries((await client.query(`SELECT s.nombre,c.actividad,c.saldo_actual FROM custodias c JOIN socios s ON s.id=c.socio_id ORDER BY s.nombre,c.actividad`)).rows.map((row) => [`${row.nombre}.${row.actividad}`, Number(row.saldo_actual)]));
    for (const key of custodyKeys) if (custodyValidation[key] !== Number(config.custodyBalances[key])) throw new Error(`No concilia la custodia ${key}.`);
    const finalReport = { ...plan.report, source: { ...plan.report.source, sha256: sourceHash, bytes: sourceSize }, databaseValidation: { ...validation, custodyBalances: custodyValidation }, status: 'APPLIED_AND_RECONCILED' };
    await client.query(`UPDATE ejecuciones_migracion SET estado='COMPLETADA',reporte=$2,finalizado_at=now() WHERE id=$1`, [execution.rows[0].id, finalReport]);
    await client.query(`INSERT INTO auditoria_sistema (entidad_tipo,entidad_id,accion,datos_nuevos) VALUES ('fuente_migracion',$1,'MIGRACION_DEFINITIVA',$2)`, [sourceId, finalReport]);
    await client.query('COMMIT');
    return { executionId: execution.rows[0].id, sourceId, backupPath, databaseValidation: validation, report: finalReport };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); await pool.end(); }
}

const sourceBytes = await fs.readFile(sourcePath);
const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
const config = configPath ? JSON.parse(await fs.readFile(configPath, 'utf8')) : null;
const { data } = await readWorkbook();
const plan = buildPlan(data, rules, config);
plan.report.source.sha256 = sourceHash; plan.report.source.bytes = sourceBytes.length;
let result = { mode: 'DRY_RUN', ...plan.report };
if (applying) result = { mode: 'APPLY', ...(await applyMigration(data, plan, sourceHash, sourceBytes.length, config)) };
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ report: reportPath, mode: result.mode, status: result.status ?? result.report?.status ?? (result.alreadyApplied ? 'ALREADY_APPLIED' : null), counts: plan.report.counts, reconciliations: plan.report.reconciliations, missingCustodyBalances: plan.missingCustodies.length, blockers: plan.blockers }, null, 2));
