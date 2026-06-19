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

// Query 1: Cancelaciones por mes y tipo — query liviana sin joins pesados
const QUERY_CANCELACIONES = `
WITH subs_filtradas AS (
  SELECT
    id,
    zuora__account__c                             AS student_id,
    CAST(zuora__subscriptionstartdate__c AS date) AS subscription_start_date,
    zuora__cancelleddate__c                       AS fecha_cancelacion,
    subscriptionstatus__c                         AS subscription_status
  FROM (
    SELECT
      id,
      zuora__account__c,
      zuora__subscriptionstartdate__c,
      zuora__cancelleddate__c,
      subscriptionstatus__c,
      zuora__status__c,
      isdeleted,
      ROW_NUMBER() OVER(PARTITION BY id ORDER BY lastmodifieddate DESC) AS rn
    FROM "salesforce-database".subscriptions
  )
  WHERE isdeleted = false
    AND rn = 1
    AND zuora__cancelleddate__c >= '2024-03-06'
    AND zuora__cancelleddate__c <= GETDATE()
    AND zuora__status__c = 'Cancelled'
),
comebacks AS (
  SELECT student_id, fecha_cierre AS cb_date FROM salesforce.tabla_core_oportunidades
  WHERE tipo_venta = 'Comeback OPS' AND etapa IN ('Ganada Verificada','Closed Won') AND fecha_cierre IS NOT NULL
),
-- Una cancelación por cliente y por "ciclo de vida": un comeback abre un ciclo nuevo, así que cancelar antes y
-- después de un comeback cuenta 2; el resto cuenta 1. Se conserva la cancelación más temprana de cada ciclo.
cancel_unicas AS (
  SELECT id, student_id, subscription_start_date, fecha_cancelacion, subscription_status
  FROM (
    SELECT seg.*, ROW_NUMBER() OVER (PARTITION BY seg.student_id, seg.segmento ORDER BY seg.fecha_cancelacion ASC, seg.id) AS rn
    FROM (
      SELECT c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status,
        COUNT(k.cb_date) AS segmento
      FROM subs_filtradas c
      LEFT JOIN comebacks k ON k.student_id = c.student_id AND k.cb_date <= c.fecha_cancelacion
      GROUP BY c.id, c.student_id, c.subscription_start_date, c.fecha_cancelacion, c.subscription_status
    ) seg
  ) z WHERE rn = 1
),
primera_suscripcion AS (
  SELECT student_id, primera_fecha, tipo_pago_grp
  FROM (
    SELECT
      student_id,
      fecha_cierre AS primera_fecha,
      CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago_grp,
      ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY fecha_cierre ASC) AS rn
    FROM salesforce.tabla_core_oportunidades
    WHERE etapa = 'Ganada Verificada'
      AND (
        (sub_tipo_venta LIKE '%Bootcamp%' AND tipo_pago = 'Cuotas')
        OR sub_tipo_venta LIKE '%Suscripción smartBeemo%'
        OR (sub_tipo_venta = 'Mentoría' AND tipo_pago = 'Cuotas')
      )
  ) WHERE rn = 1
),
casos_cobranza AS (
  SELECT suscripcion, status,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS rn
  FROM salesforce.tabla_intermedia_casos_cobranza
),
casos_chargeback AS (
  SELECT suscripcion, numero_caso,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS rn
  FROM salesforce.tabla_core_casos
  WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM'
),
cancelaciones_clasificadas AS (
  -- Partimos de primera_suscripcion (todos los clientes con adquisición)
  -- y cruzamos con los que tienen cancelaciones
  SELECT
    p.student_id,
    p.tipo_pago_grp                            AS tipo_pago,
    DATE_TRUNC('month', s.fecha_cancelacion)  AS mes_cancel,
    DATE_TRUNC('month', p.primera_fecha)       AS mes_inicio,
    DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) AS meses_vida,
    CASE
      WHEN ch.numero_caso IS NOT NULL                          THEN 'Chargeback'
      WHEN cob.status = 'Cerrado - Cartera Irrecuperable'     THEN 'Por mora'
      WHEN LOWER(s.subscription_status) IN (
           'cancelada por no pago','suspendida por no pago',
           'cancelada por pago de saldo pendiente')            THEN 'Por mora'
      WHEN LOWER(s.subscription_status) IN (
           'chargeback','cancelación chargeback prevention',
           'cancelación por chargeback prevention')            THEN 'Chargeback'
      WHEN LOWER(s.subscription_status) IN (
           'cancelación programada','cancelacion programada',
           'cancelación con reembolso','suscripción cancelada') THEN 'Voluntaria'
      WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada'
                                                               THEN 'Desenrolada'
      ELSE 'Otro'
    END AS tipo_cancelacion,
    CASE
      WHEN e.pais_agrupado IN ('México','Mexico')              THEN 'México'
      WHEN e.pais_agrupado = 'Colombia'                        THEN 'Colombia'
      WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado
  FROM primera_suscripcion p
  -- Una cancelación por cliente por ciclo (cancel_unicas)
  INNER JOIN cancel_unicas s           ON p.student_id = s.student_id
  LEFT JOIN salesforce.tabla_core_estudiantes e ON p.student_id = e.student_id
  LEFT JOIN casos_cobranza cob         ON s.id = cob.suscripcion AND cob.rn = 1
  LEFT JOIN casos_chargeback ch        ON s.id = ch.suscripcion AND ch.rn = 1
)
SELECT
  TO_CHAR(mes_cancel, 'YYYY-MM') AS mes_cancelacion,
  TO_CHAR(mes_inicio, 'YYYY-MM') AS mes_inicio,
  tipo_cancelacion,
  tipo_pago,
  pais_agrupado,
  meses_vida                     AS meses_vida_real,
  COUNT(*)                       AS suscripciones,
  AVG(meses_vida)                AS avg_meses_activo
FROM cancelaciones_clasificadas
GROUP BY mes_cancel, mes_inicio, tipo_cancelacion, tipo_pago, pais_agrupado, meses_vida
ORDER BY mes_cancelacion, mes_inicio;
`;

// Query 2: Nuevos clientes — misma definición que pestaña Salud
// Primera oportunidad de adquisición por cliente, sin corte de fecha
const QUERY_NUEVOS = `
SELECT
  TO_CHAR(DATE_TRUNC('month', fecha_cierre), 'YYYY-MM') AS mes,
  CASE
    WHEN pais_agrupado IN ('México','Mexico')                THEN 'México'
    WHEN pais_agrupado = 'Colombia'                          THEN 'Colombia'
    WHEN pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
    ELSE 'Otros'
  END AS pais_agrupado,
  CASE WHEN tipo_pago = 'Cuotas' THEN 'Cuotas' ELSE 'Recurrencia' END AS tipo_pago,
  COUNT(DISTINCT student_id) AS nuevos_clientes
FROM (
  SELECT o.student_id, o.fecha_cierre, o.tipo_pago, e.pais_agrupado,
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
    AND o.fecha_cierre >= '2024-03-06'
)
WHERE orden = 1
GROUP BY DATE_TRUNC('month', fecha_cierre), pais_agrupado, 3
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