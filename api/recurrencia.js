const { Client } = require('pg');
const { Redis } = require('@upstash/redis');

const getClient = () => new Client({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  database: process.env.REDSHIFT_DATABASE,
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  query_timeout: 270000,
});

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

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:recurrencia';
const CACHE_TTL = 18000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const redis = getRedis();
    const isSyncReq = req.headers['x-sync-secret'] === process.env.CRON_SECRET;
    if (!isSyncReq) {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return res.status(200).json(typeof cached === 'string' ? JSON.parse(cached) : cached);
    }

    const client = getClient();
    try {
      await client.connect();
      const [r1, r2] = await Promise.all([
        client.query(QUERY_MONTHLY),
        client.query(QUERY_CLIENTES),
      ]);
      const data = { data: r1.rows, clientes: r2.rows };
      await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
      res.status(200).json(data);
    } finally {
      await client.end();
    }
  } catch (err) {
    console.error('recurrencia error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
