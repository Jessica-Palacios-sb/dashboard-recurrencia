#!/usr/bin/env node
// Populates Redis cache directly from Redshift — no Vercel 10s timeout constraint.
// Usage (local):  node scripts/sync-redis.js
// Usage (CI):     env vars injected by GitHub Actions secrets
try { require('dotenv').config({ path: '.env.local' }); } catch {}

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const { Client } = require('pg');
const { Redis } = require('@upstash/redis');

const CACHE_TTL = 604800; // 5 hours

function getClient() {
  return new Client({
    host: process.env.REDSHIFT_HOST,
    port: parseInt(process.env.REDSHIFT_PORT || '5439'),
    database: process.env.REDSHIFT_DATABASE,
    user: process.env.REDSHIFT_USER,
    password: process.env.REDSHIFT_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000,
    query_timeout: 540000,
  });
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

async function syncOne(name, cacheKey, queryFn) {
  const client = getClient();
  const t0 = Date.now();
  try {
    process.stdout.write(`  ${name}...`);
    await client.connect();
    const data = await queryFn(client);
    const serialized = JSON.stringify(data);
    const compressed = await gzip(serialized);
    const value = 'gz:' + compressed.toString('base64');
    await redis.set(cacheKey, value, { ex: CACHE_TTL });
    process.stdout.write(` [${(serialized.length/1024/1024).toFixed(2)}MB→${(value.length/1024/1024).toFixed(2)}MB]`);
    console.log(` OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return { status: 'ok', ms: Date.now() - t0 };
  } catch (err) {
    console.log(` ERROR: ${err.message}`);
    return { status: 'error', error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

// ── Helpers de salud.js ───────────────────────────────────────────────────────
const PAIS = (a) => `CASE
    WHEN ${a}.pais_agrupado IN ('México','Mexico') THEN 'México'
    WHEN ${a}.pais_agrupado = 'Colombia' THEN 'Colombia'
    WHEN ${a}.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
    ELSE 'Otros' END`;
const TPAGO = (a) => `CASE WHEN ${a}.tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END`;
const W_INV2 = `(f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura >= 2
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )`;

// Suscripciones de Zuora deduplicadas (último registro por lastmodifieddate, solo canceladas).
// Misma base que la pestaña Cancelaciones, para que Churn y Cancelaciones hablen el mismo idioma.
const SUBS_ZUORA = `(
  SELECT id, zuora__account__c AS student_id,
    CAST(zuora__subscriptionstartdate__c AS date) AS subscription_start_date,
    zuora__cancelleddate__c AS fecha_cancelacion,
    subscriptionstatus__c AS subscription_status
  FROM (
    SELECT id, zuora__account__c, zuora__subscriptionstartdate__c, zuora__cancelleddate__c,
      subscriptionstatus__c, zuora__status__c, isdeleted,
      ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS rn
    FROM "salesforce-database".subscriptions
  )
  WHERE isdeleted = false AND rn = 1 AND zuora__status__c = 'Cancelled'
    AND zuora__cancelleddate__c >= '2024-03-06' AND zuora__cancelleddate__c <= GETDATE()
)`;

// Cancelaciones únicas por cliente y por ciclo de comeback (una por (cliente, segmento), la más temprana).
const CANCEL_UNICAS = `(
  SELECT id, student_id, subscription_start_date, fecha_cancelacion, subscription_status
  FROM (
    SELECT seg.*, ROW_NUMBER() OVER (PARTITION BY seg.student_id, seg.segmento ORDER BY seg.fecha_cancelacion ASC, seg.id) AS rn
    FROM (
      SELECT c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status,
        COUNT(k.cb_date) AS segmento
      FROM ${SUBS_ZUORA} c
      LEFT JOIN (
        SELECT student_id, fecha_cierre AS cb_date FROM salesforce.tabla_core_oportunidades
        WHERE tipo_venta = 'Comeback OPS' AND etapa IN ('Ganada Verificada','Closed Won') AND fecha_cierre IS NOT NULL
      ) k ON k.student_id = c.student_id AND k.cb_date <= c.fecha_cancelacion
      GROUP BY c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status
    ) seg
  ) z
  WHERE rn = 1
)`;

// ── Endpoints ─────────────────────────────────────────────────────────────────
const ENDPOINTS = [

  {
    name: 'recurrencia',
    cacheKey: 'cache:recurrencia',
    async run(client) {
      const BASE_COLS = `
    f.student_id, f.fecha_pago, f.total_amount_usd, f.payment_amount_usd, f.open_balance,
    f.estado, o.tipo_pago, o.tipo_venta,
    CASE
      WHEN o.pais_lead_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN o.pais_lead_agrupado IN ('Colombia')                       THEN 'Colombia'
      WHEN o.pais_lead_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado`;
      const ES_UPGRADE = `CASE WHEN o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling') THEN 1 ELSE 0 END`;
      const JOINS = `
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_intermedia_casos_cobranza cob ON cob.id_invoice_factura = f.id
  LEFT JOIN salesforce.tabla_core_casos ca ON f.id = ca.id_invoice_factura AND ca.id_registro_caso = '012UH000009AltJYAS'`;
      const FILT_COMMON = `o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas') OR o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling'))
    AND f.fecha_pago >= '2024-01-01' AND f.fecha_pago <= GETDATE()`;

      const PROC_INV = `CASE
      WHEN o.tipo_venta = 'Comeback OPS' AND f.numero_invoice_factura = 1 THEN 'Comeback'
      WHEN o.tipo_venta = 'Upgrade OPS' AND f.numero_invoice_factura IN (1,21) AND o.grupo IN ('Collection','Retention') THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2 AND cob.tipo_cobro = 'Cobro asesor' THEN 'Cobranza'
      WHEN ca.id_invoice_factura IS NOT NULL THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2 AND cob.id_invoice_factura IS NULL THEN 'Recurrencia'
      WHEN f.numero_invoice_factura >= 2 AND cob.tipo_cobro = 'Cobro automático con caso' THEN 'Recurrencia'
      WHEN o.tipo_venta = 'Up-Selling' AND f.numero_invoice_factura = 1 THEN 'Up-Selling'
      WHEN o.tipo_venta IN ('Cross-Selling','Freemium Cross-Selling') AND f.numero_invoice_factura = 1 THEN 'Bootcamp & Cross'
      WHEN o.sub_tipo_venta = 'Mentoría' AND f.numero_invoice_factura >= 2 THEN 'Cuotas Mentorías'
      WHEN f.numero_invoice_factura = 1 AND o.tipo_venta = 'Adquisicion' THEN 'Adquisicion'
      ELSE 'Otro' END`;
      const PROC_FAC = `CASE
      WHEN f.adelanto = true THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2 AND cob.tipo_cobro = 'Cobro asesor' THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2 AND cob.id_invoice_factura IS NULL THEN 'Recurrencia'
      WHEN f.numero_invoice_factura >= 2 AND cob.tipo_cobro = 'Cobro automático con caso' THEN 'Recurrencia'
      WHEN o.tipo_venta = 'Up-Selling' AND f.numero_invoice_factura = 1 THEN 'Up-Selling'
      WHEN o.tipo_venta IN ('Cross-Selling','Freemium Cross-Selling') AND f.numero_invoice_factura = 1 THEN 'Bootcamp & Cross'
      WHEN o.sub_tipo_venta = 'Mentoría' AND f.numero_invoice_factura >= 2 THEN 'Cuotas Mentorías'
      WHEN f.numero_invoice_factura = 1 AND o.tipo_venta = 'Adquisicion' THEN 'Adquisicion'
      ELSE 'Otro' END`;

      const QUERY_MONTHLY = `
SELECT
  TO_CHAR(DATE_TRUNC('month', TO_DATE(dm.mes, 'YYYY-MM-DD')), 'YYYY-MM-DD') AS mes,
  dm.pais_agrupado, dm.proceso_clasificado, dm.tipo_pago, dm.tipo_venta, dm.tipo_ingreso, dm.estado,
  MAX(dm.es_upgrade) AS es_upgrade,
  SUM(dm.payment_amount_usd) AS payment_amount_usd,
  SUM(dm.total_amount_usd)   AS total_amount_usd,
  SUM(dm.open_balance)       AS open_balance,
  SUM(dm.clientes)           AS clientes,
  SUM(dm.facturas)           AS facturas
FROM (
  SELECT
    TO_CHAR(b.fecha_pago, 'YYYY-MM-DD') AS mes,
    b.pais_agrupado, b.proceso_clasificado, b.tipo_pago, b.tipo_venta, b.tipo_ingreso, b.estado,
    MAX(b.es_upgrade) AS es_upgrade,
    ROUND(SUM(b.payment_amount_usd)::numeric, 2) AS payment_amount_usd,
    ROUND(SUM(b.total_amount_usd)::numeric, 2)   AS total_amount_usd,
    SUM(CASE WHEN b.open_balance = true THEN 1 ELSE 0 END) AS open_balance,
    COUNT(DISTINCT b.student_id)                  AS clientes,
    COUNT(*)                                      AS facturas
  FROM (
    SELECT ${BASE_COLS}, ${PROC_INV} AS proceso_clasificado,
      ${ES_UPGRADE} AS es_upgrade, 'Invoice' AS tipo_ingreso
    ${JOINS}
    WHERE f.invoice_factura = 'invoice' AND ${FILT_COMMON}
    UNION ALL
    SELECT ${BASE_COLS}, ${PROC_FAC} AS proceso_clasificado,
      ${ES_UPGRADE} AS es_upgrade, 'Factura' AS tipo_ingreso
    ${JOINS}
    WHERE f.invoice_factura = 'factura' AND o.fecha_cierre < '2024-03-06' AND ${FILT_COMMON}
  ) b
  GROUP BY 1,2,3,4,5,6,7
) dm
GROUP BY 1,2,3,4,5,6,7
ORDER BY 1,2,3,4,5,6,7`;

      const QUERY_CLIENTES = `
SELECT
  b.student_id,
  b.pais_agrupado,
  e.tipo_suscripcion,
  b.tipo_pago,
  ROUND(SUM(b.payment_amount_usd)::numeric, 2) AS cobrado,
  COUNT(*)                                      AS facturas,
  MIN(o2.fecha_cierre_str)                      AS fecha_cierre_min,
  MAX(b.es_upgrade)                             AS tiene_upgrade,
  MAX(upg.fecha_primer_upgrade_str)             AS fecha_primer_upgrade
FROM (
  SELECT f.student_id, f.payment_amount_usd,
    CASE WHEN o.pais_lead_agrupado IN ('México','Mexico') THEN 'México' WHEN o.pais_lead_agrupado IN ('Colombia') THEN 'Colombia' WHEN o.pais_lead_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    o.tipo_pago,
    ${ES_UPGRADE} AS es_upgrade
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.fecha_pago >= '2024-01-01' AND f.fecha_pago <= GETDATE()
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas') OR o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling'))
) b
LEFT JOIN salesforce.tabla_core_estudiantes e ON b.student_id = e.student_id
LEFT JOIN (
  SELECT student_id, TO_CHAR(MIN(fecha_cierre), 'YYYY-MM-DD') AS fecha_cierre_str
  FROM salesforce.tabla_core_oportunidades
  WHERE etapa IN ('Ganada Verificada', 'Closed Won')
  GROUP BY student_id
) o2 ON b.student_id = o2.student_id
LEFT JOIN (
  SELECT f2.student_id, TO_CHAR(MIN(f2.fecha_pago), 'YYYY-MM-DD') AS fecha_primer_upgrade_str
  FROM salesforce.tabla_core_invoices_facturas f2
  LEFT JOIN salesforce.tabla_core_oportunidades o3 ON f2.id_oportunidad = o3.id
  WHERE o3.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling')
    AND f2.numero_invoice_factura = 1
    AND f2.fecha_pago IS NOT NULL
  GROUP BY f2.student_id
) upg ON b.student_id = upg.student_id
GROUP BY b.student_id, b.pais_agrupado, e.tipo_suscripcion, b.tipo_pago
ORDER BY cobrado DESC
LIMIT 500`;

      // Adquisiciones (factura 1): mismo subquery base que el MRR, filtrado a proceso 'Adquisicion',
      // pago efectivo (payment_amount_usd > 0) y sin saldo abierto (open_balance = false). Disjunto del MRR base.
      const QUERY_ADQUISICIONES = `
SELECT
  TO_CHAR(DATE_TRUNC('month', b.fecha_pago), 'YYYY-MM') AS mes,
  COUNT(DISTINCT b.student_id)                 AS nuevos_clientes,
  ROUND(SUM(b.payment_amount_usd)::numeric, 2) AS nuevo_mrr
FROM (
  SELECT ${BASE_COLS}, ${PROC_INV} AS proceso_clasificado
  ${JOINS}
  WHERE f.invoice_factura = 'invoice' AND ${FILT_COMMON}
  UNION ALL
  SELECT ${BASE_COLS}, ${PROC_FAC} AS proceso_clasificado
  ${JOINS}
  WHERE f.invoice_factura = 'factura' AND o.fecha_cierre < '2024-03-06' AND ${FILT_COMMON}
) b
WHERE b.proceso_clasificado = 'Adquisicion' AND b.payment_amount_usd > 0 AND b.open_balance = false
GROUP BY 1 ORDER BY 1`;

      // Puente de MRR normalizado (pago/tiempo_recurrencia repartido en los meses cubiertos); base-delta que reconcilia.
      const QUERY_MRR_NORM = `
WITH mo AS (SELECT 0 AS offs UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11),
rec AS (
  SELECT f.student_id, DATE_TRUNC('month', f.fecha_pago) AS mes_pago, f.payment_amount_usd AS pay,
    GREATEST(1, CASE WHEN TRIM(COALESCE(o.tiempo_recurrencia,'1')) ~ '^[0-9]+$' THEN CAST(TRIM(o.tiempo_recurrencia) AS INT) ELSE 1 END) AS t
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL AND f.fecha_pago <= GETDATE() AND f.payment_amount_usd > 0
    AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND f.numero_invoice_factura >= 2
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
),
ex AS (SELECT student_id, TO_CHAR(DATEADD('month', mo.offs, mes_pago), 'YYYY-MM') AS mes, pay / rec.t AS m FROM rec JOIN mo ON mo.offs < rec.t),
cli AS (SELECT student_id, mes, SUM(m) AS mrr FROM ex GROUP BY 1, 2),
w AS (SELECT student_id, mes, mrr, LAG(mrr) OVER (PARTITION BY student_id ORDER BY mes) AS pmrr, LAG(mes) OVER (PARTITION BY student_id ORDER BY mes) AS pmes, LEAD(mes) OVER (PARTITION BY student_id ORDER BY mes) AS nmes FROM cli),
base AS (SELECT mes, SUM(mrr) AS base_norm FROM cli GROUP BY mes),
mov AS (
  SELECT mes,
    SUM(CASE WHEN pmes IS NULL OR pmes <> TO_CHAR(DATEADD('month',-1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM') THEN mrr ELSE 0 END) AS nuevos,
    SUM(CASE WHEN pmes = TO_CHAR(DATEADD('month',-1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM') AND mrr > pmrr THEN mrr - pmrr ELSE 0 END) AS expansion,
    SUM(CASE WHEN pmes = TO_CHAR(DATEADD('month',-1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM') AND mrr < pmrr THEN pmrr - mrr ELSE 0 END) AS contraccion
  FROM w GROUP BY mes
),
churn AS (
  SELECT TO_CHAR(DATEADD('month',1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM') AS mes, SUM(mrr) AS churn
  FROM w WHERE (nmes IS NULL OR nmes <> TO_CHAR(DATEADD('month',1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM'))
    AND TO_CHAR(DATEADD('month',1,TO_DATE(mes||'-01','YYYY-MM-DD')),'YYYY-MM') < TO_CHAR(DATE_TRUNC('month',GETDATE()),'YYYY-MM')
  GROUP BY 1
)
SELECT b.mes, ROUND(b.base_norm::numeric,0) AS base_norm, ROUND(COALESCE(m.nuevos,0)::numeric,0) AS nuevos,
  ROUND(COALESCE(m.expansion,0)::numeric,0) AS expansion, ROUND(COALESCE(m.contraccion,0)::numeric,0) AS contraccion, ROUND(COALESCE(c.churn,0)::numeric,0) AS churn
FROM base b LEFT JOIN mov m ON m.mes = b.mes LEFT JOIN churn c ON c.mes = b.mes ORDER BY b.mes`;

      const [r1, r2, r3, r4] = await Promise.all([
        client.query(QUERY_MONTHLY),
        client.query(QUERY_CLIENTES),
        client.query(QUERY_ADQUISICIONES),
        client.query(QUERY_MRR_NORM),
      ]);
      return { data: r1.rows, clientes: r2.rows, adquisiciones: r3.rows, mrrNorm: r4.rows };
    },
  },

  {
    name: 'salud',
    cacheKey: 'cache:salud',
    async run(client) {
      const [r1, r2, r3, r4] = await Promise.all([
        client.query(`
WITH base AS (
  SELECT DISTINCT f.student_id,
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    ${PAIS('e')} AS pais_agrupado,
    ${TPAGO('o')} AS tipo_pago
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE ${W_INV2}
),
con_lead AS (
  SELECT student_id, mes, pais_agrupado, tipo_pago,
    LEAD(mes) OVER (PARTITION BY student_id, pais_agrupado, tipo_pago ORDER BY mes) AS mes_sig
  FROM base
),
flags AS (
  SELECT mes, pais_agrupado, tipo_pago, student_id,
    CASE WHEN mes_sig = TO_CHAR(DATEADD('month',1,DATE_TRUNC('month',TO_DATE(mes,'YYYY-MM'))),'YYYY-MM') THEN 1 ELSE 0 END AS retenido
  FROM con_lead
),
mrr AS (
  SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    ${PAIS('e')} AS pais_agrupado, ${TPAGO('o')} AS tipo_pago,
    ROUND(SUM(f.payment_amount_usd)::numeric, 0) AS mrr
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE ${W_INV2} GROUP BY 1,2,3
)
SELECT f.mes, f.pais_agrupado, f.tipo_pago,
  COUNT(DISTINCT f.student_id) AS clientes, COALESCE(m.mrr,0) AS mrr,
  SUM(f.retenido) AS retenidos,
  COUNT(DISTINCT f.student_id) - SUM(f.retenido) AS perdidos,
  ROUND(SUM(f.retenido)*100.0/NULLIF(COUNT(DISTINCT f.student_id),0),1) AS tasa_retencion
FROM flags f LEFT JOIN mrr m USING (mes, pais_agrupado, tipo_pago)
WHERE f.mes < TO_CHAR(DATEADD('month',-1,DATE_TRUNC('month',GETDATE())),'YYYY-MM')
GROUP BY f.mes, f.pais_agrupado, f.tipo_pago, m.mrr ORDER BY 1,2,3;`),
        client.query(`
SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
  ${PAIS('e')} AS pais_agrupado, ${TPAGO('o')} AS tipo_pago,
  COUNT(DISTINCT f.student_id) AS clientes,
  ROUND(SUM(f.payment_amount_usd)::numeric/NULLIF(COUNT(DISTINCT f.student_id),0),2) AS ticket_promedio,
  ROUND(SUM(f.payment_amount_usd)::numeric,2) AS cobrado
FROM salesforce.tabla_core_invoices_facturas f
LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
WHERE ${W_INV2} GROUP BY 1,2,3 ORDER BY 1, cobrado DESC;`),
        client.query(`
SELECT TO_CHAR(DATE_TRUNC('month', f.due_date), 'YYYY-MM') AS mes,
  f.estado, ${PAIS('e')} AS pais_agrupado, ${TPAGO('o')} AS tipo_pago,
  COUNT(*) AS facturas,
  ROUND(SUM(f.total_amount_usd)::numeric,2) AS total_facturado,
  ROUND(SUM(f.payment_amount_usd)::numeric,2) AS total_cobrado
FROM salesforce.tabla_core_invoices_facturas f
LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
  AND (f.fecha_pago <= GETDATE() OR f.fecha_pago IS NULL)
  AND o.etapa IN ('Ganada Verificada', 'Closed Won')
  AND f.numero_invoice_factura >= 2
  AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
GROUP BY 1,2,3,4 ORDER BY 1, facturas DESC;`),
        client.query(`
WITH nuevos_raw AS (
  SELECT TO_CHAR(DATE_TRUNC('month', MIN(o.fecha_cierre)), 'YYYY-MM') AS mes,
    ${PAIS('est')} AS pais_agrupado, ${TPAGO('o')} AS tipo_pago, o.student_id
  FROM salesforce.tabla_core_oportunidades o
  LEFT JOIN salesforce.tabla_core_estudiantes est ON o.student_id = est.student_id
  WHERE o.etapa IN ('Ganada Verificada', 'Closed Won') AND o.tipo_venta = 'Adquisicion'
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
  GROUP BY o.student_id, 2, 3
),
nuevos_agg AS (SELECT mes, pais_agrupado, tipo_pago, COUNT(DISTINCT student_id) AS nuevos FROM nuevos_raw GROUP BY 1,2,3),
activos AS (
  SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    f.student_id, ${PAIS('e')} AS pais_agrupado, ${TPAGO('o')} AS tipo_pago
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE ${W_INV2}
),
con_lead AS (SELECT mes, student_id, pais_agrupado, tipo_pago,
  LEAD(mes) OVER (PARTITION BY student_id, pais_agrupado, tipo_pago ORDER BY mes) AS mes_sig FROM activos),
perdidos_agg AS (SELECT mes, pais_agrupado, tipo_pago,
  COUNT(DISTINCT CASE WHEN mes_sig IS NULL OR mes_sig <> TO_CHAR(DATEADD('month',1,DATE_TRUNC('month',TO_DATE(mes,'YYYY-MM'))),'YYYY-MM') THEN student_id END) AS perdidos
  FROM con_lead GROUP BY 1,2,3)
SELECT p.mes, p.pais_agrupado, p.tipo_pago, COALESCE(n.nuevos,0) AS nuevos, p.perdidos
FROM perdidos_agg p LEFT JOIN nuevos_agg n USING (mes, pais_agrupado, tipo_pago)
WHERE p.mes < TO_CHAR(DATEADD('month',-1,DATE_TRUNC('month',GETDATE())),'YYYY-MM')
ORDER BY 1,2,3;`),
      ]);
      return { retencion: r1.rows, ticket: r2.rows, estados: r3.rows, flujo: r4.rows };
    },
  },

  {
    name: 'salud-cohortes',
    cacheKey: 'cache:salud-cohortes',
    async run(client) {
      const r = await client.query(`
WITH primera_adquisicion AS (
  SELECT student_id, DATE_TRUNC('month', fecha_cierre) AS cohorte, tipo_pago, pais_agrupado
  FROM (
    SELECT o.student_id, o.fecha_cierre,
      CASE WHEN o.tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
      CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
      ROW_NUMBER() OVER(PARTITION BY o.student_id ORDER BY o.fecha_cierre ASC) AS orden
    FROM salesforce.tabla_core_oportunidades o
    LEFT JOIN salesforce.tabla_core_estudiantes e ON o.student_id = e.student_id
    WHERE o.tipo_venta = 'Adquisicion' AND o.etapa IN ('Ganada Verificada', 'Closed Won')
      AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
  ) WHERE orden = 1
),
base_cohorte AS (SELECT TO_CHAR(cohorte,'YYYY-MM') AS cohorte, tipo_pago, pais_agrupado, COUNT(DISTINCT student_id) AS base FROM primera_adquisicion GROUP BY 1,2,3),
facturas_recurrencia AS (
  SELECT f.student_id, DATE_TRUNC('month', f.fecha_pago) AS mes_pago,
    CASE WHEN TRIM(COALESCE(o.tiempo_recurrencia,'1')) ~ '^[0-9]+$' THEN GREATEST(1, CAST(TRIM(o.tiempo_recurrencia) AS INT)) ELSE 1 END AS meses_cobertura
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND f.numero_invoice_factura >= 2
),
meses_offset AS (SELECT 0 AS offs UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11),
pagos_expandidos AS (SELECT DISTINCT f.student_id, DATEADD('month', mo.offs, f.mes_pago) AS mes_cubierto FROM facturas_recurrencia f JOIN meses_offset mo ON mo.offs < f.meses_cobertura),
meses AS (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12),
cohorte_mes AS (
  SELECT p.student_id, TO_CHAR(p.cohorte,'YYYY-MM') AS cohorte, p.tipo_pago, p.pais_agrupado, m.n AS mes_n, DATEADD('month', m.n, p.cohorte) AS mes_objetivo
  FROM primera_adquisicion p CROSS JOIN meses m
  WHERE p.cohorte < DATEADD('month',-1,DATE_TRUNC('month',GETDATE())) AND DATEADD('month',m.n,p.cohorte) < DATE_TRUNC('month',GETDATE())
),
puntual_agg AS (SELECT cm.cohorte, cm.tipo_pago, cm.pais_agrupado, cm.mes_n, COUNT(DISTINCT CASE WHEN pe.student_id IS NOT NULL THEN cm.student_id END) AS activos_puntual FROM cohorte_mes cm LEFT JOIN pagos_expandidos pe ON pe.student_id = cm.student_id AND pe.mes_cubierto = cm.mes_objetivo GROUP BY 1,2,3,4),
acumulada_agg AS (SELECT cm.cohorte, cm.tipo_pago, cm.pais_agrupado, cm.mes_n, COUNT(DISTINCT CASE WHEN pe.student_id IS NOT NULL THEN cm.student_id END) AS activos_acum FROM cohorte_mes cm LEFT JOIN pagos_expandidos pe ON pe.student_id = cm.student_id AND pe.mes_cubierto > DATE_TRUNC('month',TO_DATE(cm.cohorte,'YYYY-MM')) AND pe.mes_cubierto <= cm.mes_objetivo GROUP BY 1,2,3,4)
SELECT b.cohorte, b.tipo_pago, b.pais_agrupado, 0 AS mes_n, b.base AS activos_puntual, b.base AS activos_acum FROM base_cohorte b WHERE b.cohorte < TO_CHAR(DATEADD('month',-1,DATE_TRUNC('month',GETDATE())),'YYYY-MM')
UNION ALL
SELECT p.cohorte, p.tipo_pago, p.pais_agrupado, p.mes_n, p.activos_puntual, COALESCE(a.activos_acum,0) AS activos_acum FROM puntual_agg p LEFT JOIN acumulada_agg a USING (cohorte, tipo_pago, pais_agrupado, mes_n)
ORDER BY 1,2,3,4;`);
      return { cohortes: r.rows };
    },
  },

  {
    name: 'cancelaciones',
    cacheKey: 'cache:cancelaciones',
    async run(client) {
      const [r1, r2] = await Promise.all([
        client.query(`
WITH subs_filtradas AS (
  SELECT id, zuora__account__c AS student_id,
    CAST(zuora__subscriptionstartdate__c AS date) AS subscription_start_date,
    zuora__cancelleddate__c AS fecha_cancelacion,
    subscriptionstatus__c AS subscription_status
  FROM (SELECT id, zuora__account__c, zuora__subscriptionstartdate__c, zuora__cancelleddate__c, subscriptionstatus__c, zuora__status__c, isdeleted, ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS rn FROM "salesforce-database".subscriptions)
  WHERE isdeleted = false AND rn = 1 AND zuora__cancelleddate__c >= '2024-03-06' AND zuora__cancelleddate__c <= GETDATE() AND zuora__status__c = 'Cancelled'
),
comebacks AS (SELECT student_id, fecha_cierre AS cb_date FROM salesforce.tabla_core_oportunidades WHERE tipo_venta = 'Comeback OPS' AND etapa IN ('Ganada Verificada','Closed Won') AND fecha_cierre IS NOT NULL),
cancel_unicas AS (
  SELECT id, student_id, subscription_start_date, fecha_cancelacion, subscription_status FROM (
    SELECT seg.*, ROW_NUMBER() OVER (PARTITION BY seg.student_id, seg.segmento ORDER BY seg.fecha_cancelacion ASC, seg.id) AS rn FROM (
      SELECT c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status, COUNT(k.cb_date) AS segmento
      FROM subs_filtradas c LEFT JOIN comebacks k ON k.student_id = c.student_id AND k.cb_date <= c.fecha_cancelacion
      GROUP BY c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status
    ) seg
  ) z WHERE rn = 1
),
primera_suscripcion AS (
  SELECT student_id, primera_fecha, tipo_pago_grp FROM (
    SELECT student_id, fecha_cierre AS primera_fecha,
      CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago_grp,
      ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY fecha_cierre ASC) AS rn
    FROM salesforce.tabla_core_oportunidades
    WHERE etapa = 'Ganada Verificada' AND ((sub_tipo_venta LIKE '%Bootcamp%' AND tipo_pago = 'Cuotas') OR sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (sub_tipo_venta = 'Mentoría' AND tipo_pago = 'Cuotas'))
  ) WHERE rn = 1
),
casos_cobranza AS (SELECT suscripcion, status, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS rn FROM salesforce.tabla_intermedia_casos_cobranza),
casos_chargeback AS (SELECT suscripcion, numero_caso, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS rn FROM salesforce.tabla_core_casos WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM'),
cancelaciones_clasificadas AS (
  SELECT p.student_id, p.tipo_pago_grp AS tipo_pago, DATE_TRUNC('month', s.fecha_cancelacion) AS mes_cancel,
    DATE_TRUNC('month', p.primera_fecha) AS mes_inicio,
    DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) AS meses_vida,
    CASE WHEN ch.numero_caso IS NOT NULL THEN 'Chargeback' WHEN cob.status = 'Cerrado - Cartera Irrecuperable' THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('cancelada por no pago','suspendida por no pago','cancelada por pago de saldo pendiente') THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('chargeback','cancelación chargeback prevention','cancelación por chargeback prevention') THEN 'Chargeback' WHEN LOWER(s.subscription_status) IN ('cancelación programada','cancelacion programada','cancelación con reembolso','suscripción cancelada') THEN 'Voluntaria' WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada' THEN 'Desenrolada' ELSE 'Otro' END AS tipo_cancelacion,
    CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    1 AS rn_cliente_mes
  FROM primera_suscripcion p INNER JOIN cancel_unicas s ON p.student_id = s.student_id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON p.student_id = e.student_id
  LEFT JOIN casos_cobranza cob ON s.id = cob.suscripcion AND cob.rn = 1
  LEFT JOIN casos_chargeback ch ON s.id = ch.suscripcion AND ch.rn = 1
)
SELECT TO_CHAR(mes_cancel,'YYYY-MM') AS mes_cancelacion, TO_CHAR(mes_inicio,'YYYY-MM') AS mes_inicio,
  tipo_cancelacion, tipo_pago, pais_agrupado, meses_vida AS meses_vida_real,
  COUNT(*) AS suscripciones, AVG(meses_vida) AS avg_meses_activo
FROM cancelaciones_clasificadas WHERE rn_cliente_mes = 1
GROUP BY mes_cancel, mes_inicio, tipo_cancelacion, tipo_pago, pais_agrupado, meses_vida ORDER BY mes_cancelacion, mes_inicio;`),
        client.query(`
SELECT TO_CHAR(DATE_TRUNC('month', fecha_cierre), 'YYYY-MM') AS mes,
  CASE WHEN pais_agrupado IN ('México','Mexico') THEN 'México' WHEN pais_agrupado = 'Colombia' THEN 'Colombia' WHEN pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
  CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
  COUNT(DISTINCT student_id) AS nuevos_clientes
FROM (
  SELECT o.student_id, o.fecha_cierre, o.tipo_pago, e.pais_agrupado,
    ROW_NUMBER() OVER(PARTITION BY o.student_id ORDER BY o.fecha_cierre ASC) AS orden
  FROM salesforce.tabla_core_oportunidades o
  LEFT JOIN salesforce.tabla_core_estudiantes e ON o.student_id = e.student_id
  WHERE o.tipo_venta = 'Adquisicion' AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
    AND o.fecha_cierre >= '2024-03-06'
) WHERE orden = 1
GROUP BY DATE_TRUNC('month', fecha_cierre), pais_agrupado, 3 ORDER BY mes;`),
      ]);
      return { data: r1.rows, nuevos: r2.rows };
    },
  },

  {
    name: 'churn',
    cacheKey: 'cache:churn_v2',
    async run(client) {
      const [r1, r2, r3, r4, r5, r6] = await Promise.all([
        client.query(`
SELECT TO_CHAR(DATE_TRUNC('month', MIN(o.fecha_cierre)), 'YYYY-MM') AS mes, COUNT(DISTINCT o.student_id) AS nuevos_clientes
FROM salesforce.tabla_core_oportunidades o
WHERE o.etapa IN ('Ganada Verificada', 'Closed Won') AND o.tipo_venta = 'Adquisicion' AND o.fecha_cierre >= '2024-03-06'
  AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
GROUP BY DATE_TRUNC('month', o.fecha_cierre) ORDER BY mes;`),
        client.query(`
WITH subs_base AS ${CANCEL_UNICAS},
casos_cobranza AS (SELECT suscripcion, status, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ultimo_caso FROM salesforce.tabla_intermedia_casos_cobranza),
casos_chargeback AS (SELECT suscripcion, numero_caso, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ultimo_caso FROM salesforce.tabla_core_casos WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM')
SELECT TO_CHAR(DATE_TRUNC('month', s.fecha_cancelacion), 'YYYY-MM') AS mes,
  CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
  CASE WHEN ch.numero_caso IS NOT NULL THEN 'Chargeback' WHEN cob.status = 'Cerrado - Cartera Irrecuperable' THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('cancelada por no pago','suspendida por no pago','cancelada por pago de saldo pendiente') THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('chargeback','cancelación chargeback prevention','cancelación por chargeback prevention') THEN 'Chargeback' WHEN LOWER(s.subscription_status) IN ('cancelación programada','cancelacion programada','cancelación con reembolso','suscripción cancelada') THEN 'Voluntaria' WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada' THEN 'Desenrolada' ELSE 'Otro' END AS tipo_cancelacion,
  COUNT(*) AS cancelaciones
FROM subs_base s LEFT JOIN salesforce.tabla_core_estudiantes e ON s.student_id = e.student_id
LEFT JOIN casos_cobranza cob ON s.id = cob.suscripcion AND cob.ultimo_caso = 1
LEFT JOIN casos_chargeback ch ON s.id = ch.suscripcion AND ch.ultimo_caso = 1
WHERE s.fecha_cancelacion IS NOT NULL AND s.fecha_cancelacion >= '2024-03-06' AND s.fecha_cancelacion <= GETDATE()
  AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','') AND s.subscription_status IS NOT NULL
GROUP BY DATE_TRUNC('month', s.fecha_cancelacion), e.pais_agrupado, 3 ORDER BY mes;`),
        client.query(`
WITH base_activa AS (SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes, COUNT(DISTINCT f.student_id) AS clientes_activos FROM salesforce.tabla_core_invoices_facturas f LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id WHERE f.invoice_factura = 'invoice' AND f.fecha_pago IS NOT NULL AND f.fecha_pago >= '2024-03-06' AND f.fecha_pago <= GETDATE() AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND f.numero_invoice_factura >= 1 GROUP BY DATE_TRUNC('month', f.fecha_pago)),
cancelaciones_mes AS (SELECT TO_CHAR(DATE_TRUNC('month', fecha_cancelacion), 'YYYY-MM') AS mes, COUNT(*) AS cancelaciones FROM ${CANCEL_UNICAS} s WHERE fecha_cancelacion IS NOT NULL AND fecha_cancelacion >= '2024-03-06' AND fecha_cancelacion <= GETDATE() AND LOWER(COALESCE(subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','') AND subscription_status IS NOT NULL GROUP BY DATE_TRUNC('month', fecha_cancelacion))
SELECT b.mes, b.clientes_activos, COALESCE(c.cancelaciones,0) AS cancelaciones, ROUND(COALESCE(c.cancelaciones,0)*100.0/NULLIF(b.clientes_activos,0),2) AS tasa_churn FROM base_activa b LEFT JOIN cancelaciones_mes c ON b.mes = c.mes ORDER BY b.mes;`),
        client.query(`
SELECT TO_CHAR(DATE_TRUNC('month', c.fecha_cierre), 'YYYY-MM') AS mes, c.motivo_cancelacion, c.sub_motivo_cancelacion, c.tipo_cancelacion, COUNT(*) AS casos,
  CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado
FROM salesforce.tabla_intermedia_casos_cancelaciones c LEFT JOIN salesforce.tabla_core_estudiantes e ON c.student_id = e.student_id
WHERE c.fecha_cierre IS NOT NULL AND c.fecha_cierre >= '2024-03-06' AND c.motivo_cancelacion IS NOT NULL
GROUP BY DATE_TRUNC('month', c.fecha_cierre), c.motivo_cancelacion, c.sub_motivo_cancelacion, c.tipo_cancelacion, e.pais_agrupado ORDER BY mes, casos DESC;`),
        client.query(`
WITH activos_pais AS (
  SELECT CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado, COUNT(DISTINCT f.student_id) AS clientes_totales
  FROM salesforce.tabla_core_invoices_facturas f LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE f.invoice_factura = 'invoice' AND f.fecha_pago IS NOT NULL AND f.fecha_pago >= '2024-03-06' AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND f.numero_invoice_factura >= 1 GROUP BY 1
),
cancel_pais AS (
  SELECT CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    COUNT(*) AS cancelaciones,
    SUM(CASE WHEN ch.numero_caso IS NOT NULL OR cob.status = 'Cerrado - Cartera Irrecuperable' OR LOWER(s.subscription_status) IN ('cancelada por no pago','suspendida por no pago','cancelada por pago de saldo pendiente') THEN 1 ELSE 0 END) AS por_mora,
    SUM(CASE WHEN LOWER(s.subscription_status) IN ('cancelación programada','cancelacion programada','cancelación con reembolso','suscripción cancelada') THEN 1 ELSE 0 END) AS voluntaria
  FROM ${CANCEL_UNICAS} s LEFT JOIN salesforce.tabla_core_estudiantes e ON s.student_id = e.student_id
  LEFT JOIN (SELECT suscripcion, status, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ult FROM salesforce.tabla_intermedia_casos_cobranza) cob ON s.id = cob.suscripcion AND cob.ult = 1
  LEFT JOIN (SELECT suscripcion, numero_caso, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ult FROM salesforce.tabla_core_casos WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM') ch ON s.id = ch.suscripcion AND ch.ult = 1
  WHERE s.fecha_cancelacion IS NOT NULL AND s.fecha_cancelacion >= '2024-03-06' AND s.fecha_cancelacion <= GETDATE() AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','') AND s.subscription_status IS NOT NULL GROUP BY 1
)
SELECT a.pais_agrupado, a.clientes_totales, COALESCE(c.cancelaciones,0) AS cancelaciones, COALESCE(c.por_mora,0) AS por_mora, COALESCE(c.voluntaria,0) AS voluntaria, ROUND(COALESCE(c.cancelaciones,0)*100.0/NULLIF(a.clientes_totales,0),1) AS tasa_churn_pct
FROM activos_pais a LEFT JOIN cancel_pais c ON a.pais_agrupado = c.pais_agrupado WHERE a.pais_agrupado IS NOT NULL ORDER BY cancelaciones DESC;`),
        client.query(`
WITH primera_suscripcion AS (
  SELECT student_id, MIN(fecha_cierre) AS primera_fecha FROM salesforce.tabla_core_oportunidades
  WHERE etapa = 'Ganada Verificada' AND ((sub_tipo_venta LIKE '%Bootcamp%' AND tipo_pago = 'Cuotas') OR sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (sub_tipo_venta = 'Mentoría' AND tipo_pago = 'Cuotas'))
  GROUP BY student_id
),
casos_cobranza AS (SELECT suscripcion, status, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ultimo_caso FROM salesforce.tabla_intermedia_casos_cobranza),
casos_chargeback AS (SELECT suscripcion, numero_caso, ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ultimo_caso FROM salesforce.tabla_core_casos WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM'),
cancelaciones AS (
  SELECT s.student_id, s.fecha_cancelacion, s.subscription_status,
    CASE WHEN ch.numero_caso IS NOT NULL THEN 'Chargeback' WHEN cob.status = 'Cerrado - Cartera Irrecuperable' THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('cancelada por no pago','suspendida por no pago','cancelada por pago de saldo pendiente') THEN 'Por mora' WHEN LOWER(s.subscription_status) IN ('chargeback','cancelación chargeback prevention','cancelación por chargeback prevention') THEN 'Chargeback' WHEN LOWER(s.subscription_status) IN ('cancelación programada','cancelacion programada','cancelación con reembolso','suscripción cancelada') THEN 'Voluntaria' WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada' THEN 'Desenrolada' ELSE 'Otro' END AS tipo_cancelacion,
    DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) AS meses_vida_real
  FROM ${CANCEL_UNICAS} s JOIN primera_suscripcion p ON s.student_id = p.student_id
  LEFT JOIN casos_cobranza cob ON s.id = cob.suscripcion AND cob.ultimo_caso = 1
  LEFT JOIN casos_chargeback ch ON s.id = ch.suscripcion AND ch.ultimo_caso = 1
  WHERE s.fecha_cancelacion IS NOT NULL AND s.fecha_cancelacion >= '2024-03-06' AND s.fecha_cancelacion <= GETDATE()
    AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','') AND s.subscription_status IS NOT NULL
    AND DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) >= 0 AND DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) <= 60
),
agrupado AS (
  SELECT CASE WHEN meses_vida_real <= 1 THEN 'Mes 1' WHEN meses_vida_real <= 3 THEN 'Mes 2-3' WHEN meses_vida_real <= 6 THEN 'Mes 4-6' WHEN meses_vida_real <= 12 THEN 'Mes 7-12' ELSE '+12 meses' END AS rango_vida, tipo_cancelacion, COUNT(*) AS cantidad, ROUND(AVG(meses_vida_real)::numeric,1) AS avg_meses
  FROM cancelaciones GROUP BY 1, 2
),
sorted AS (SELECT rango_vida, tipo_cancelacion, cantidad, avg_meses, CASE rango_vida WHEN 'Mes 1' THEN 1 WHEN 'Mes 2-3' THEN 2 WHEN 'Mes 4-6' THEN 3 WHEN 'Mes 7-12' THEN 4 ELSE 5 END AS orden FROM agrupado)
SELECT rango_vida, tipo_cancelacion, cantidad, avg_meses FROM sorted ORDER BY orden, tipo_cancelacion;`),
      ]);
      return { nuevos: r1.rows, cancelaciones: r2.rows, tasaChurn: r3.rows, tiempoVida: r6.rows, motivos: r4.rows, churnPais: r5.rows };
    },
  },

  {
    name: 'marketing',
    cacheKey: 'cache:marketing',
    async run(client) {
      const r = await client.query(`
WITH spend_mes AS (
  SELECT TO_CHAR(DATE_TRUNC('month', fecha), 'YYYY-MM') AS mes,
    CASE WHEN pais_agrupado IN ('México','Mexico') THEN 'México' WHEN pais_agrupado = 'Colombia' THEN 'Colombia' WHEN pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    SUM(spend::decimal) AS spend_total
  FROM salesforce.tabla_intermedia_marketing WHERE spend::decimal > 0 AND fecha >= '2024-03-01' GROUP BY 1, 2
),
nuevos_reales AS (
  SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    COUNT(DISTINCT f.student_id) AS clientes_pagaron
  FROM salesforce.tabla_core_invoices_facturas f LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura')) AND f.fecha_pago IS NOT NULL AND f.fecha_pago >= '2024-03-01' AND f.fecha_pago <= GETDATE() AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND o.tipo_venta = 'Adquisicion' AND f.numero_invoice_factura = 1 AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
  GROUP BY 1, 2
),
ticket_mes AS (
  SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    CASE WHEN e.pais_agrupado IN ('México','Mexico') THEN 'México' WHEN e.pais_agrupado = 'Colombia' THEN 'Colombia' WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos' ELSE 'Otros' END AS pais_agrupado,
    ROUND(SUM(f.payment_amount_usd)::numeric / NULLIF(COUNT(DISTINCT f.student_id), 0), 2) AS ticket_promedio
  FROM salesforce.tabla_core_invoices_facturas f LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura')) AND f.fecha_pago IS NOT NULL AND f.fecha_pago >= '2024-03-01' AND f.fecha_pago <= GETDATE() AND o.etapa IN ('Ganada Verificada', 'Closed Won') AND f.numero_invoice_factura >= 2 AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas') OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
  GROUP BY 1, 2
)
SELECT s.mes, s.pais_agrupado, ROUND(s.spend_total::numeric,0) AS spend, COALESCE(n.clientes_pagaron,0) AS nuevos, ROUND(s.spend_total/NULLIF(n.clientes_pagaron,0),2) AS cac, COALESCE(t.ticket_promedio,0) AS ticket_promedio
FROM spend_mes s LEFT JOIN nuevos_reales n USING (mes, pais_agrupado) LEFT JOIN ticket_mes t USING (mes, pais_agrupado) WHERE s.spend_total > 0 ORDER BY s.mes, s.pais_agrupado;`);
      return { cac: r.rows };
    },
  },

  {
    name: 'facturacion',
    cacheKey: 'cache:facturacion',
    async run(client) {
      const DETALLE = `
WITH mentor AS (
  SELECT id AS id_mentor, sbeemo_fm_full_name__c AS nombre_mentor,
    ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS orden
  FROM "salesforce-database".mentor
),
numero_invoice AS (
  SELECT id_oportunidad, COUNT(id) AS invoices, SUM(payment_amount_usd) AS payment_usd,
    AVG(CASE WHEN payment_amount_usd > 0 THEN payment_amount_usd ELSE NULL END) AS cash_promedio
  FROM salesforce.tabla_core_invoices_facturas GROUP BY 1
),
oportunidades AS (
  SELECT o.id id_oportunidad, o.grupo, o.tipo_venta, o.sub_tipo_venta, o.pais_lead, o.student_id,
    o.fecha_hora_cierre, o.tiempo_meses_estudio, o.tipo_lobo, o.tiempo_recurrencia, o.fecha_hora_apertura,
    o.tipo_compra_mkt AS tipo_compra, o.tipo_compra AS tipo_compra_op, o.tipo_pago, o.num_cuotas,
    origen_mentor, creador_mentor, subscription, fecha_cierre, ssub_tipo_venta,
    i.invoices, i.payment_usd, i.cash_promedio,
    CAST(o.monto_recurrente AS double precision) AS monto_recurrente,
    CAST(o.pago_inicial_usd AS double precision) AS pago_inicial_usd,
    CAST(o.monto_inicial_usd AS double precision) AS monto_inicial_usd,
    CAST(o.importe AS double precision) AS importe,
    CASE WHEN o.tipo_compra = 'Self checkout' AND o.tiempo_recurrencia = '1' AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' THEN 'SC Mensual'
      WHEN o.tipo_compra = 'Self checkout' AND (o.tiempo_recurrencia != '1' OR o.tiempo_recurrencia IS NULL) AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' THEN 'SC No Mensual'
      WHEN (o.tipo_compra != 'Self checkout' OR o.tipo_compra IS NULL) AND o.tiempo_recurrencia = '1' AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' AND o.tipo_pago = 'Cuotas' THEN 'BAU Mensual a cuotas'
      WHEN (o.tipo_compra != 'Self checkout' OR o.tipo_compra IS NULL) AND i.invoices = 1 AND o.tiempo_meses_estudio > 1 AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' THEN 'BAU No Mensual'
      WHEN (o.tipo_compra != 'Self checkout' OR o.tipo_compra IS NULL) AND o.tiempo_recurrencia = '1' AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' THEN 'BAU Mensual'
      WHEN (o.tipo_compra != 'Self checkout' OR o.tipo_compra IS NULL) AND (o.tiempo_recurrencia != '1' OR o.tiempo_recurrencia IS NULL) AND o.sub_tipo_venta LIKE '%Suscripción smartBeemo%' THEN 'BAU No Mensual'
      WHEN o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas' THEN 'BC Cuotas'
      WHEN o.sub_tipo_venta IN ('Curso','Diplomado','Especialización') THEN 'Productos'
      WHEN o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas' THEN 'Mentorías' END AS tipo_cliente
  FROM salesforce.tabla_core_oportunidades AS o
  LEFT JOIN numero_invoice AS i ON o.id = i.id_oportunidad
  WHERE o.etapa IN ('Closed Won', 'Ganada Verificada')
),
invoice AS (
  SELECT CAST(date_trunc('month', o.fecha_cierre) AS date) AS fecha_mes, o.*,
    i.id id_invoice, i.invoice_fact_number, CAST(i.numero_invoice_factura AS int) AS numero_invoice_factura,
    ROW_NUMBER() OVER(PARTITION BY i.id_oportunidad ORDER BY i.due_date DESC) AS ultima_invoice_factura,
    i.fecha_pago, i.due_date, i.payment_amount_usd, i.estado, i.open_balance, i.tipo_cambio, i.total_amount_usd,
    CASE WHEN o.pais_lead IN ('Colombia','México','Estados Unidos') THEN o.pais_lead ELSE 'Otros' END pais,
    o.tiempo_meses_estudio - CAST(i.numero_invoice_factura AS int) AS diferencia
  FROM salesforce.tabla_core_invoices_facturas AS i
  INNER JOIN oportunidades AS o ON i.id_oportunidad = o.id_oportunidad
  WHERE i.invoice_factura = 'invoice'
    AND ((o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas'))
),
upselling AS (
  SELECT * FROM (
    SELECT o.student_id AS id_student, o.fecha_cierre AS fecha_up, o.tipo_venta, o.ssub_tipo_venta,
      i.payment_amount_usd, ROW_NUMBER() OVER(PARTITION BY o.student_id ORDER BY o.fecha_cierre ASC) AS orden
    FROM salesforce.tabla_core_invoices_facturas AS i
    INNER JOIN oportunidades AS o ON i.id_oportunidad = o.id_oportunidad
    WHERE o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS') AND i.numero_invoice_factura = 1
  ) WHERE orden = 1
),
cancelacion AS (
  SELECT * FROM (
    SELECT id, zuora__account__c AS student_id, SubscriptionStatus__c AS status_cancelacion,
      Zuora__CancelledDate__c AS fecha_cancelacion, SubscriptionStatusChangeReason__c AS sub_estado_cancelacion,
      Zuora__Status__c, CAST(date_trunc('month', Zuora__CancelledDate__c) AS date) AS fecha_mes_cancelacion,
      ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS ultimo_subs
    FROM "salesforce-database".subscriptions
  ) WHERE ultimo_subs = 1 AND Zuora__Status__c = 'Cancelled'
),
descuentos AS (
  SELECT id_invoice, COUNT(id) AS descuentos, SUM(cash_descontado) AS cash_descontado FROM (
    SELECT id, Zuora__Invoice__c AS id_invoice, Zuora__UnitPrice__c AS cash_descontado,
      ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS ultimo_item
    FROM "salesforce-database".invoice_item WHERE Zuora__ProcessingType__c = 'Discount'
  ) WHERE ultimo_item = 1 GROUP BY 1
),
credit_memo AS (
  SELECT id_invoice, COUNT(id) AS descuentos, SUM(cash_descontado) AS cash_descontado FROM (
    SELECT id, Zuora__Invoice__c AS id_invoice, Zuora__AppliedAmount__c AS cash_descontado,
      ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS ultimo_item
    FROM "salesforce-database".credit_memo WHERE Zuora__ReasonCode__c = 'Retention Discount'
  ) WHERE ultimo_item = 1 GROUP BY 1
),
casos_cancelacion AS (
  SELECT id_caso, numero_caso, status,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ultimo_caso,
    motivo_cancelacion, sub_motivo_cancelacion, suscripcion
  FROM salesforce.tabla_intermedia_casos_cancelaciones
  WHERE status IN ('Cancelado automático','Cancelado','Cancelado sin contactar') AND sub_tipo_caso = 'Cancelaciones 2.0'
),
casos_chargeback AS (
  SELECT id, numero_caso, status,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ultimo_caso, sub_estado, suscripcion
  FROM salesforce.tabla_core_casos WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM'
),
detalle AS (
  SELECT i.*,
    CASE WHEN i.tipo_pago = 'Contado' AND i.ultima_invoice_factura = 1 THEN round(i.monto_recurrente / i.tipo_cambio, 2)
      WHEN i.tipo_pago = 'Cuotas' AND i.ultima_invoice_factura = 1 THEN round(i.importe - i.payment_usd, 2)
      ELSE NULL END AS cash_sin_pagar,
    CASE WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL AND cob.status = 'Cerrado - Cartera Irrecuperable' THEN 'Cancelación por mora'
      WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL AND ch.numero_caso IS NOT NULL THEN 'Cancelación por chargeback'
      WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL THEN 'Cancelación voluntaria'
      ELSE NULL END tipo_cancelacion,
    CASE WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND c.status_cancelacion IN ('Cancelada por pago de saldo pendiente','Upgraded') AND c.fecha_cancelacion IS NOT NULL THEN 1
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND i.tipo_pago = 'Contado' AND c.fecha_cancelacion IS NOT NULL THEN 1
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND u.ssub_tipo_venta = 'Saldo pendiente suscripción' THEN 1
      ELSE 0 END Up,
    CASE WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND c.status_cancelacion IN ('Cancelada por pago de saldo pendiente','Upgraded') AND c.fecha_cancelacion IS NOT NULL THEN u.payment_amount_usd
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND i.tipo_pago = 'Contado' AND c.fecha_cancelacion IS NOT NULL THEN u.payment_amount_usd
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND u.ssub_tipo_venta = 'Saldo pendiente suscripción' THEN u.payment_amount_usd
      ELSE 0 END AS cash_up,
    CASE WHEN TRIM(COALESCE(i.num_cuotas::varchar,'')) ~ '^[0-9]+$' THEN CAST(i.num_cuotas AS INT) ELSE NULL END AS nc,
    CASE WHEN i.estado = 'Pagada' AND date_trunc('month', i.due_date) = date_trunc('month', i.fecha_pago) THEN 'Pago mismo mes'
      WHEN i.estado = 'Reembolsada' AND date_trunc('month', i.due_date) = date_trunc('month', i.fecha_pago) THEN 'Pago con devolución mismo mes'
      WHEN i.estado = 'Pagada' AND date_trunc('month', i.due_date) != date_trunc('month', i.fecha_pago) THEN 'Pago despues'
      WHEN i.estado = 'Reembolsada' AND date_trunc('month', i.due_date) != date_trunc('month', i.fecha_pago) THEN 'Pago con devolución despues'
      WHEN coalesce(d.id_invoice, cm.id_invoice) IS NOT NULL AND i.total_amount_usd = 0 THEN 'Meses de gracia'
      WHEN i.estado = 'Reembolsada' AND i.fecha_pago IS NULL THEN 'Pago con devolución sin fecha'
      WHEN i.open_balance IS true THEN 'No pago' END estado_pago
  FROM invoice AS i
  LEFT JOIN descuentos AS d ON i.id_invoice = d.id_invoice
  LEFT JOIN credit_memo AS cm ON i.id_invoice = cm.id_invoice
  LEFT JOIN cancelacion AS c ON i.subscription = c.id
  LEFT JOIN upselling AS u ON i.student_id = u.id_student AND i.fecha_cierre <= u.fecha_up AND i.tipo_venta != u.tipo_venta
  LEFT JOIN casos_cancelacion AS cc ON i.subscription = cc.suscripcion AND cc.ultimo_caso = 1
  LEFT JOIN casos_chargeback AS ch ON i.subscription = ch.suscripcion AND ch.ultimo_caso = 1
  LEFT JOIN salesforce.tabla_intermedia_casos_cobranza AS cob ON i.id_invoice = cob.id_invoice_factura
  WHERE i.tipo_cliente != 'Productos'
)`;
      const QUERY = `${DETALLE}
, funnel AS (
  SELECT 'funnel' AS tipo, pais, tipo_cliente, CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
    CASE WHEN Up = 1 THEN 'Upgrade' WHEN tipo_cancelacion = 'Cancelación por mora' THEN 'Por mora'
      WHEN tipo_cancelacion = 'Cancelación por chargeback' THEN 'Chargeback'
      WHEN tipo_cancelacion = 'Cancelación voluntaria' THEN 'Voluntaria'
      WHEN estado_pago = 'No pago' THEN 'En mora sin cancelar' ELSE NULL END AS k1,
    NULL AS k2, COUNT(*) AS n, ROUND(SUM(COALESCE(cash_sin_pagar, 0))::numeric, 0) AS cash
  FROM detalle WHERE ultima_invoice_factura = 1 GROUP BY 2,3,4,5
),
cohorte AS (
  SELECT 'cohorte' AS tipo, pais, tipo_cliente, CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
    TO_CHAR(fecha_cierre, 'YYYY-MM') AS k1, TO_CHAR(due_date, 'YYYY-MM') AS k2, COUNT(*) AS n, NULL AS cash
  FROM detalle WHERE fecha_cierre IS NOT NULL AND due_date IS NOT NULL GROUP BY 2,3,4,5,6
)
SELECT * FROM funnel WHERE k1 IS NOT NULL UNION ALL SELECT * FROM cohorte`;
      // Resumen por cohorte (mes de cierre): sales, facturas, importe, meta a hoy, total pagado.
      const QUERY_RESUMEN = `${DETALLE}
SELECT pais, tipo_cliente,
  CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
  TO_CHAR(fecha_cierre, 'YYYY-MM') AS cohorte,
  SUM(CASE WHEN numero_invoice_factura = 1 THEN 1 ELSE 0 END) AS sales,
  SUM(CASE WHEN ultima_invoice_factura = 1 AND tipo_pago = 'Cuotas' THEN nc
           WHEN ultima_invoice_factura = 1 THEN numero_invoice_factura ELSE 0 END) AS facturas,
  ROUND(SUM(CASE WHEN ultima_invoice_factura = 1 AND tipo_pago = 'Cuotas' THEN importe
           WHEN ultima_invoice_factura = 1 THEN COALESCE(payment_amount_usd,0) + COALESCE(cash_up,0) ELSE 0 END)::numeric, 2) AS importe,
  ROUND(SUM(CASE WHEN ultima_invoice_factura = 1 AND tipo_pago = 'Cuotas' AND nc > 0
           THEN (importe / nc) * LEAST(DATEDIFF('month', fecha_cierre, GETDATE()) + 1, nc) ELSE 0 END)::numeric, 2) AS meta_hoy,
  ROUND(SUM(COALESCE(payment_amount_usd,0) + COALESCE(cash_up,0))::numeric, 2) AS total_pagado
FROM detalle
WHERE fecha_cierre IS NOT NULL
GROUP BY 1,2,3,4`;
      const r = await client.query(QUERY);
      const rr = await client.query(QUERY_RESUMEN);
      const funnel = r.rows.filter(x => x.tipo === 'funnel').map(x => ({ pais: x.pais, tipo_cliente: x.tipo_cliente, tipo_pago: x.tipo_pago, razon: x.k1, oportunidades: +x.n, cash_en_riesgo: +x.cash || 0 }));
      const cohorte = r.rows.filter(x => x.tipo === 'cohorte').map(x => ({ pais: x.pais, tipo_cliente: x.tipo_cliente, tipo_pago: x.tipo_pago, cohorte: x.k1, mes_vencimiento: x.k2, invoices: +x.n }));
      const resumen = rr.rows.map(x => ({ pais: x.pais, tipo_cliente: x.tipo_cliente, tipo_pago: x.tipo_pago, cohorte: x.cohorte, sales: +x.sales, facturas: +x.facturas, importe: +x.importe, meta_hoy: +x.meta_hoy, total_pagado: +x.total_pagado }));
      return { funnel, cohorte, resumen };
    },
  },

];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const missing = ['REDSHIFT_HOST','REDSHIFT_DATABASE','REDSHIFT_USER','REDSHIFT_PASSWORD','UPSTASH_REDIS_KV_REST_API_URL','UPSTASH_REDIS_KV_REST_API_TOKEN']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  console.log(`Syncing ${ENDPOINTS.length} endpoints to Redis (TTL ${CACHE_TTL / 3600}h)...`);
  const t0 = Date.now();
  const results = {};

  // Run in parallel — each has its own pg connection
  await Promise.allSettled(
    ENDPOINTS.map(async (ep) => {
      results[ep.name] = await syncOne(ep.name, ep.cacheKey, ep.run.bind(ep));
    })
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = Object.values(results).filter(r => r.status === 'ok').length;
  const errors = Object.values(results).filter(r => r.status === 'error').length;
  console.log(`\nDone in ${elapsed}s — ${ok} OK, ${errors} errors`);

  // Write sync log to Redis
  await redis.set('sync:log', JSON.stringify({
    status: errors > 0 ? 'partial' : 'ok',
    startedAt: new Date(t0).toISOString(),
    completedAt: new Date().toISOString(),
    endpoints: results,
  }), { ex: 604800 });

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
