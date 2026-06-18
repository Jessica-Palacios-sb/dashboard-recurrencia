const { Client } = require('pg');
const { Redis } = require('@upstash/redis');
const { readCache } = require('./_cache');

const getClient = () => new Client({
  host: process.env.REDSHIFT_HOST,
  port: parseInt(process.env.REDSHIFT_PORT || '5439'),
  database: process.env.REDSHIFT_DATABASE,
  user: process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 120000,
});

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:salud-cohortes';
const CACHE_TTL = 18000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = getRedis();

  // Ruteo de Facturación (vía rewrite en vercel.json): solo lee el cache que puebla el sync.
  // Vive aquí para no superar el límite de 12 Serverless Functions del plan Hobby.
  if (req.query.fuente === 'facturacion') {
    const fc = await readCache(redis, 'cache:facturacion');
    return res.status(200).json(fc || { funnel: [], cohorte: [] });
  }

  const isSyncReq = req.headers['x-sync-secret'] === process.env.CRON_SECRET;
  if (!isSyncReq) {
    const cached = await readCache(redis, CACHE_KEY);
    if (cached) return res.status(200).json(cached);
  }

  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(`
WITH primera_adquisicion AS (
  SELECT student_id, DATE_TRUNC('month', fecha_cierre) AS cohorte, tipo_pago, pais_agrupado
  FROM (
    SELECT
      o.student_id, o.fecha_cierre,
      CASE WHEN o.tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
      CASE
        WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
        WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
        WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
        ELSE 'Otros'
      END AS pais_agrupado,
      ROW_NUMBER() OVER(PARTITION BY o.student_id ORDER BY o.fecha_cierre ASC) AS orden
    FROM salesforce.tabla_core_oportunidades o
    LEFT JOIN salesforce.tabla_core_estudiantes e ON o.student_id = e.student_id
    WHERE o.tipo_venta = 'Adquisicion'
      AND o.etapa IN ('Ganada Verificada', 'Closed Won')
      AND (
        (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
        OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
        OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
      )
  ) WHERE orden = 1
),
base_cohorte AS (
  SELECT TO_CHAR(cohorte, 'YYYY-MM') AS cohorte, tipo_pago, pais_agrupado,
    COUNT(DISTINCT student_id) AS base
  FROM primera_adquisicion
  GROUP BY 1, 2, 3
),
facturas_recurrencia AS (
  SELECT
    f.student_id,
    DATE_TRUNC('month', f.fecha_pago) AS mes_pago,
    CASE
      WHEN TRIM(COALESCE(o.tiempo_recurrencia,'1')) ~ '^[0-9]+$'
        THEN GREATEST(1, CAST(TRIM(o.tiempo_recurrencia) AS INT))
      ELSE 1
    END AS meses_cobertura
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  WHERE (f.invoice_factura = 'invoice'
      OR (o.fecha_cierre < '2024-03-06' AND f.invoice_factura = 'factura'))
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura >= 2
),
meses_offset AS (
  SELECT 0 AS offs UNION ALL SELECT 1 UNION ALL SELECT 2
  UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
  UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
  UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11
),
pagos_expandidos AS (
  SELECT DISTINCT
    f.student_id,
    DATEADD('month', mo.offs, f.mes_pago) AS mes_cubierto
  FROM facturas_recurrencia f
  JOIN meses_offset mo ON mo.offs < f.meses_cobertura
),
meses AS (
  SELECT 1 AS n UNION ALL SELECT 2  UNION ALL SELECT 3  UNION ALL SELECT 4
  UNION ALL SELECT 5  UNION ALL SELECT 6  UNION ALL SELECT 7  UNION ALL SELECT 8
  UNION ALL SELECT 9  UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
),
cohorte_mes AS (
  SELECT
    p.student_id, TO_CHAR(p.cohorte, 'YYYY-MM') AS cohorte,
    p.tipo_pago, p.pais_agrupado, m.n AS mes_n,
    DATEADD('month', m.n, p.cohorte) AS mes_objetivo
  FROM primera_adquisicion p
  CROSS JOIN meses m
  WHERE p.cohorte < DATEADD('month', -1, DATE_TRUNC('month', GETDATE()))
    AND DATEADD('month', m.n, p.cohorte) < DATE_TRUNC('month', GETDATE())
),
puntual_agg AS (
  SELECT cm.cohorte, cm.tipo_pago, cm.pais_agrupado, cm.mes_n,
    COUNT(DISTINCT CASE WHEN pe.student_id IS NOT NULL THEN cm.student_id END) AS activos_puntual
  FROM cohorte_mes cm
  LEFT JOIN pagos_expandidos pe
    ON pe.student_id   = cm.student_id
    AND pe.mes_cubierto = cm.mes_objetivo
  GROUP BY 1, 2, 3, 4
),
acumulada_agg AS (
  SELECT cm.cohorte, cm.tipo_pago, cm.pais_agrupado, cm.mes_n,
    COUNT(DISTINCT CASE WHEN pe.student_id IS NOT NULL THEN cm.student_id END) AS activos_acum
  FROM cohorte_mes cm
  LEFT JOIN pagos_expandidos pe
    ON pe.student_id    = cm.student_id
    AND pe.mes_cubierto >  DATE_TRUNC('month', TO_DATE(cm.cohorte, 'YYYY-MM'))
    AND pe.mes_cubierto <= cm.mes_objetivo
  GROUP BY 1, 2, 3, 4
)
SELECT b.cohorte, b.tipo_pago, b.pais_agrupado,
  0 AS mes_n, b.base AS activos_puntual, b.base AS activos_acum
FROM base_cohorte b
WHERE b.cohorte < TO_CHAR(DATEADD('month', -1, DATE_TRUNC('month', GETDATE())), 'YYYY-MM')
UNION ALL
SELECT p.cohorte, p.tipo_pago, p.pais_agrupado, p.mes_n,
  p.activos_puntual,
  COALESCE(a.activos_acum, 0) AS activos_acum
FROM puntual_agg p
LEFT JOIN acumulada_agg a USING (cohorte, tipo_pago, pais_agrupado, mes_n)
ORDER BY 1, 2, 3, 4;
    `);
    const data = { cohortes: result.rows };
    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
    res.status(200).json(data);
  } catch (err) {
    console.error('salud-cohortes error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};