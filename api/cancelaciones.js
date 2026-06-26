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
  connectionTimeoutMillis: 60000,
});

// Cancelaciones (fuente lifecycle estado_clientes): inactivos, 3 tipos (chargeback/mora/voluntaria),
// con dimensiones mes_inicio (fecha_cierre) / país / tipo_pago / tipo_cliente / meses de vida.
const QUERY_CANCELACIONES = `
WITH e AS (
  SELECT c.student_id, CAST(c.fecha_cierre AS date) AS fecha_cierre, CAST(c.fecha_cancelacion AS date) AS fecha_cancelacion,
    c.tipo_cancelacion, c.canal_cancelacion,
    COALESCE(NULLIF(TRIM(c.tipo_cliente),''),'(sin)') AS tipo_cliente,
    CASE WHEN LOWER(COALESCE(c.tipo_cliente,'')) LIKE '%cuotas%' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
    CASE WHEN est.pais_agrupado IN ('México','Mexico') THEN 'México'
         WHEN est.pais_agrupado = 'Colombia' THEN 'Colombia'
         WHEN est.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
         ELSE 'Otros' END AS pais_agrupado
  FROM salesforce.tabla_intermedia_estado_clientes c
  LEFT JOIN salesforce.tabla_core_estudiantes est ON c.student_id = est.student_id
  WHERE c.tipo_oportunidad = 'Suscripciones' AND c.fecha_cierre >= '2023-08-01'
    AND c.estado_usuario = 'Inactivo' AND c.fecha_cancelacion IS NOT NULL AND c.fecha_cancelacion <= GETDATE()
)
SELECT
  TO_CHAR(DATE_TRUNC('month', fecha_cancelacion), 'YYYY-MM') AS mes_cancelacion,
  TO_CHAR(DATE_TRUNC('month', fecha_cierre), 'YYYY-MM')       AS mes_inicio,
  CASE WHEN COALESCE(canal_cancelacion,'') = 'Caso chargeback' THEN 'Chargeback'
       WHEN LOWER(COALESCE(tipo_cancelacion,'')) LIKE '%mora%' THEN 'Por mora'
       ELSE 'Voluntaria' END AS tipo_cancelacion,
  tipo_pago, tipo_cliente, pais_agrupado,
  DATEDIFF('month', fecha_cierre, fecha_cancelacion) AS meses_vida_real,
  COUNT(*)                                            AS suscripciones,
  AVG(DATEDIFF('month', fecha_cierre, fecha_cancelacion)) AS avg_meses_activo
FROM e
WHERE DATEDIFF('month', fecha_cierre, fecha_cancelacion) >= 0
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY mes_cancelacion, mes_inicio;
`;

// Nuevos clientes (fuente lifecycle): por mes de primer cierre, con país / tipo_pago / tipo_cliente
const QUERY_NUEVOS = `
SELECT
  TO_CHAR(DATE_TRUNC('month', c.fecha_cierre), 'YYYY-MM') AS mes,
  CASE WHEN est.pais_agrupado IN ('México','Mexico') THEN 'México'
       WHEN est.pais_agrupado = 'Colombia' THEN 'Colombia'
       WHEN est.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
       ELSE 'Otros' END AS pais_agrupado,
  CASE WHEN LOWER(COALESCE(c.tipo_cliente,'')) LIKE '%cuotas%' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
  COALESCE(NULLIF(TRIM(c.tipo_cliente),''),'(sin)') AS tipo_cliente,
  COUNT(*) AS nuevos_clientes
FROM salesforce.tabla_intermedia_estado_clientes c
LEFT JOIN salesforce.tabla_core_estudiantes est ON c.student_id = est.student_id
WHERE c.tipo_oportunidad = 'Suscripciones' AND c.fecha_cierre >= '2023-08-01'
GROUP BY 1, 2, 3, 4
ORDER BY mes;
`;

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:cancelaciones';
const CACHE_TTL = 604800;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = getRedis();
  const isSyncReq = req.headers['x-sync-secret'] === process.env.CRON_SECRET;
  if (!isSyncReq) {
    const cached = await readCache(redis, CACHE_KEY);
    if (cached) return res.status(200).json(cached);
  }

  const client = getClient();
  try {
    await client.connect();
    const [r1, r2] = await Promise.all([
      client.query(QUERY_CANCELACIONES),
      client.query(QUERY_NUEVOS),
    ]);
    const data = { data: r1.rows, nuevos: r2.rows };
    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
    res.status(200).json(data);
  } catch (err) {
    console.error('Cancelaciones API error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};
