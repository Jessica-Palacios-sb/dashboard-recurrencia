const { Client } = require('pg');
const { Redis } = require('@upstash/redis');

const getClient = () => new Client({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  database: process.env.REDSHIFT_DATABASE,
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60000,
});

// CAC = spend real / clientes que pagaron factura #1 ese mes
// LTV viene del frontend (calculado desde cohortes)
const QUERY_CAC = `
WITH spend_mes AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', fecha), 'YYYY-MM') AS mes,
    CASE
      WHEN pais_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN pais_agrupado = 'Colombia'                          THEN 'Colombia'
      WHEN pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    SUM(spend) AS spend_total
  FROM salesforce.tabla_intermedia_marketing
  WHERE spend > 0
    AND fecha >= '2024-03-01'
  GROUP BY 1, 2
),
nuevos_reales AS (
  -- Clientes que pagaron factura #1 real (no solo oportunidad cerrada)
  SELECT
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    CASE
      WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
      WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    COUNT(DISTINCT f.student_id) AS clientes_pagaron
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes   e ON f.student_id = e.student_id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago >= '2024-03-01'
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND o.tipo_venta = 'Adquisicion'
    AND f.numero_invoice_factura = 1
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )
  GROUP BY 1, 2
),
ticket_mes AS (
  -- Ticket promedio de facturas >= 2 por mes y país
  SELECT
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    CASE
      WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
      WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    ROUND(SUM(f.payment_amount_usd)::numeric / NULLIF(COUNT(DISTINCT f.student_id), 0), 2) AS ticket_promedio
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes   e ON f.student_id = e.student_id
  WHERE (f.invoice_factura = 'invoice' OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago >= '2024-03-01'
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura >= 2
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
    )
  GROUP BY 1, 2
)
SELECT
  s.mes,
  s.pais_agrupado,
  ROUND(s.spend_total::numeric, 0)                                          AS spend,
  COALESCE(n.clientes_pagaron, 0)                                           AS nuevos,
  ROUND(s.spend_total / NULLIF(n.clientes_pagaron, 0), 2)                  AS cac,
  COALESCE(t.ticket_promedio, 0)                                            AS ticket_promedio
FROM spend_mes s
LEFT JOIN nuevos_reales n USING (mes, pais_agrupado)
LEFT JOIN ticket_mes    t USING (mes, pais_agrupado)
WHERE s.spend_total > 0
ORDER BY s.mes, s.pais_agrupado;
`;

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:marketing';
const CACHE_TTL = 18000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = getRedis();
  const isSyncReq = req.headers['x-sync-secret'] === process.env.CRON_SECRET;
  if (!isSyncReq) {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.status(200).json(typeof cached === 'string' ? JSON.parse(cached) : cached);
  }

  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(QUERY_CAC);
    const data = { cac: result.rows };
    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
    res.status(200).json(data);
  } catch (err) {
    console.error('Marketing API error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};