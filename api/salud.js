const { Client } = require('pg');

const getClient = () => new Client({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  database: process.env.REDSHIFT_DATABASE,
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60000,
});

const PAIS = (a) => `CASE
    WHEN ${a}.pais_agrupado IN ('México','Mexico') THEN 'México'
    WHEN ${a}.pais_agrupado = 'Colombia' THEN 'Colombia'
    WHEN ${a}.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
    ELSE 'Otros' END`;

const TPAGO = (a) => `CASE WHEN ${a}.tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END`;

// Filtro base acordado para facturas >= 2 (retención, ticket, estados, flujo-activos, cohortes-pagos)
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

// Filtro base acordado para factura = 1 (cohortes primera_factura)
const W_INV1 = `(f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura = 1
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )`;

// Filtro para nuevos (oportunidades) — cruza con facturas para asegurar que pagaron
const W_NUEVOS = `o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND o.fecha_cierre IS NOT NULL
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const client = getClient();
  try {
    await client.connect();

    const [r1, r2, r3, r4, r5] = await Promise.all([

      // ── Q1: Retención con LEAD() ──────────────────────────────────────────
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
    CASE WHEN mes_sig = TO_CHAR(DATEADD('month',1,DATE_TRUNC('month',TO_DATE(mes,'YYYY-MM'))),'YYYY-MM')
         THEN 1 ELSE 0 END AS retenido
  FROM con_lead
),
mrr AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    ${PAIS('e')} AS pais_agrupado,
    ${TPAGO('o')} AS tipo_pago,
    ROUND(SUM(f.payment_amount_usd)::numeric, 0) AS mrr
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE ${W_INV2}
  GROUP BY 1,2,3
)
SELECT f.mes, f.pais_agrupado, f.tipo_pago,
  COUNT(DISTINCT f.student_id) AS clientes,
  COALESCE(m.mrr, 0) AS mrr,
  SUM(f.retenido) AS retenidos,
  COUNT(DISTINCT f.student_id) - SUM(f.retenido) AS perdidos,
  ROUND(SUM(f.retenido)*100.0/NULLIF(COUNT(DISTINCT f.student_id),0),1) AS tasa_retencion
FROM flags f
LEFT JOIN mrr m USING (mes, pais_agrupado, tipo_pago)
WHERE f.mes < TO_CHAR(DATEADD('month',-1,DATE_TRUNC('month',GETDATE())),'YYYY-MM')
GROUP BY f.mes, f.pais_agrupado, f.tipo_pago, m.mrr
ORDER BY 1,2,3;`),

      // ── Q2: Ticket ────────────────────────────────────────────────────────
      client.query(`
SELECT
  TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
  ${PAIS('e')} AS pais_agrupado,
  ${TPAGO('o')} AS tipo_pago,
  COUNT(DISTINCT f.student_id) AS clientes,
  ROUND(SUM(f.payment_amount_usd)::numeric/NULLIF(COUNT(DISTINCT f.student_id),0),2) AS ticket_promedio,
  ROUND(SUM(f.payment_amount_usd)::numeric,2) AS cobrado
FROM salesforce.tabla_core_invoices_facturas f
LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
WHERE ${W_INV2}
GROUP BY 1,2,3
ORDER BY 1, cobrado DESC;`),

      // ── Q3: Estados ───────────────────────────────────────────────────────
      client.query(`
SELECT
  TO_CHAR(DATE_TRUNC('month', f.due_date), 'YYYY-MM') AS mes,
  f.estado,
  ${PAIS('e')} AS pais_agrupado,
  ${TPAGO('o')} AS tipo_pago,
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
  AND (
    (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
    OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
    OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
  )
GROUP BY 1,2,3,4
ORDER BY 1, facturas DESC;`),

      // ── Q4: Flujo con LEAD() ──────────────────────────────────────────────
      // nuevos  = primera fecha_cierre de oportunidad ganada (sin filtro de fecha)
      // perdidos = clientes activos en recurrencia que no pagan el mes siguiente
      client.query(`
WITH nuevos_raw AS (
  -- Primera oportunidad ganada por cliente
  SELECT
    TO_CHAR(DATE_TRUNC('month', MIN(o.fecha_cierre)), 'YYYY-MM') AS mes,
    ${PAIS('est')} AS pais_agrupado,
    ${TPAGO('o')} AS tipo_pago,
    o.student_id
  FROM salesforce.tabla_core_oportunidades o
  LEFT JOIN salesforce.tabla_core_estudiantes est ON o.student_id = est.student_id
  WHERE o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND o.tipo_venta = 'Adquisicion'
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )
  GROUP BY o.student_id, 2, 3
),
nuevos_agg AS (
  SELECT mes, pais_agrupado, tipo_pago,
    COUNT(DISTINCT student_id) AS nuevos
  FROM nuevos_raw
  GROUP BY 1,2,3
),
activos AS (
  SELECT DISTINCT
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    f.student_id,
    ${PAIS('e')} AS pais_agrupado,
    ${TPAGO('o')} AS tipo_pago
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON f.student_id = e.student_id
  WHERE ${W_INV2}
),
con_lead AS (
  SELECT mes, student_id, pais_agrupado, tipo_pago,
    LEAD(mes) OVER (PARTITION BY student_id, pais_agrupado, tipo_pago ORDER BY mes) AS mes_sig
  FROM activos
),
perdidos_agg AS (
  SELECT mes, pais_agrupado, tipo_pago,
    COUNT(DISTINCT CASE
      WHEN mes_sig IS NULL
        OR mes_sig <> TO_CHAR(DATEADD('month',1,DATE_TRUNC('month',TO_DATE(mes,'YYYY-MM'))),'YYYY-MM')
      THEN student_id END) AS perdidos
  FROM con_lead
  GROUP BY 1,2,3
)
SELECT
  p.mes,
  p.pais_agrupado,
  p.tipo_pago,
  COALESCE(n.nuevos, 0) AS nuevos,
  p.perdidos
FROM perdidos_agg p
LEFT JOIN nuevos_agg n USING (mes, pais_agrupado, tipo_pago)
WHERE p.mes < TO_CHAR(DATEADD('month',-1,DATE_TRUNC('month',GETDATE())),'YYYY-MM')
ORDER BY 1,2,3;`),

    ]);

    res.status(200).json({
      retencion: r1.rows,
      ticket:    r2.rows,
      estados:   r3.rows,
      flujo:     r4.rows,
    });
  } catch (err) {
    console.error('Salud API error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};