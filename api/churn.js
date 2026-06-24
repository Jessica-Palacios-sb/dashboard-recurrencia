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

// Suscripciones de Zuora deduplicadas: último registro por lastmodifieddate, solo canceladas.
// Misma base que usa la pestaña Cancelaciones, para que ambas hablen el mismo idioma.
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

// Cancelaciones únicas por cliente y por "ciclo de vida": una por (cliente, segmento), conservando la más
// temprana. Un comeback (oportunidad ganada 'Comeback OPS') abre un ciclo nuevo, así que un cliente que canceló
// antes y después de un comeback cuenta 2; el resto cuenta 1.
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

// ── Query 1: Nuevos clientes por mes ─────────────────────────────────────────
const QUERY_NUEVOS = `
SELECT
  TO_CHAR(DATE_TRUNC('month', MIN(o.fecha_cierre)), 'YYYY-MM') AS mes,
  COUNT(DISTINCT o.student_id) AS nuevos_clientes
FROM salesforce.tabla_core_oportunidades o
WHERE o.etapa IN ('Ganada Verificada', 'Closed Won')
  AND o.tipo_venta = 'Adquisicion'
  AND o.fecha_cierre >= '2024-03-06'
  AND (
    (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
    OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
    OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
  )
GROUP BY DATE_TRUNC('month', o.fecha_cierre)
ORDER BY mes;
`;

// ── Query 2: Cancelaciones por mes, país y tipo ───────────────────────────────
const QUERY_CANCELACIONES = `
WITH subs_base AS ${CANCEL_UNICAS},
casos_cobranza AS (
  SELECT suscripcion, status,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ultimo_caso
  FROM salesforce.tabla_intermedia_casos_cobranza
),
casos_chargeback AS (
  SELECT suscripcion, numero_caso,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ultimo_caso
  FROM salesforce.tabla_core_casos
  WHERE status = 'Cancelado'
    AND id_registro_caso = '012UH000001iGJpYAM'
)
SELECT
  TO_CHAR(DATE_TRUNC('month', s.fecha_cancelacion), 'YYYY-MM') AS mes,
  CASE
    WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
    WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
    WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
    ELSE 'Otros'
  END AS pais_agrupado,
  CASE
    WHEN ch.numero_caso IS NOT NULL                                       THEN 'Chargeback'
    WHEN cob.status = 'Cerrado - Cartera Irrecuperable'                   THEN 'Por mora'
    WHEN LOWER(s.subscription_status) IN (
         'cancelada por no pago','suspendida por no pago',
         'cancelada por pago de saldo pendiente')                         THEN 'Por mora'
    WHEN LOWER(s.subscription_status) IN (
         'chargeback','cancelación chargeback prevention',
         'cancelación por chargeback prevention')                         THEN 'Chargeback'
    WHEN LOWER(s.subscription_status) IN (
         'cancelación programada','cancelacion programada',
         'cancelación con reembolso','suscripción cancelada')             THEN 'Voluntaria'
    WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada' THEN 'Desenrolada'
    ELSE 'Otro'
  END AS tipo_cancelacion,
  COUNT(*) AS cancelaciones
FROM subs_base s
LEFT JOIN salesforce.tabla_core_estudiantes e ON s.student_id = e.student_id
LEFT JOIN casos_cobranza cob ON s.id = cob.suscripcion AND cob.ultimo_caso = 1
LEFT JOIN casos_chargeback ch  ON s.id = ch.suscripcion  AND ch.ultimo_caso = 1
WHERE s.fecha_cancelacion IS NOT NULL
  AND s.fecha_cancelacion >= '2024-03-06'
  AND s.fecha_cancelacion <= GETDATE()  
  AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','')
  AND s.subscription_status IS NOT NULL
GROUP BY DATE_TRUNC('month', s.fecha_cancelacion), e.pais_agrupado, 3
ORDER BY mes;
`;

// ── Query 3: Tasa de churn mensual ────────────────────────────────────────────
const QUERY_TASA_CHURN = `
WITH base_activa AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', f.fecha_pago), 'YYYY-MM') AS mes,
    COUNT(DISTINCT f.student_id) AS clientes_activos
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  WHERE f.invoice_factura = 'invoice'
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago >= '2024-03-06'
    AND f.fecha_pago <= GETDATE()
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura >= 1
  GROUP BY DATE_TRUNC('month', f.fecha_pago)
),
cancelaciones_mes AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', fecha_cancelacion), 'YYYY-MM') AS mes,
    COUNT(*) AS cancelaciones
  FROM ${CANCEL_UNICAS} s
  WHERE fecha_cancelacion IS NOT NULL
    AND fecha_cancelacion >= '2024-03-06'
    AND fecha_cancelacion <= GETDATE()
    AND LOWER(COALESCE(subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','')
    AND subscription_status IS NOT NULL
  GROUP BY DATE_TRUNC('month', fecha_cancelacion)
)
SELECT
  b.mes,
  b.clientes_activos,
  COALESCE(c.cancelaciones, 0) AS cancelaciones,
  ROUND(COALESCE(c.cancelaciones, 0) * 100.0 / NULLIF(b.clientes_activos, 0), 2) AS tasa_churn
FROM base_activa b
LEFT JOIN cancelaciones_mes c ON b.mes = c.mes
ORDER BY b.mes;
`;

// ── Query 4: Motivos de cancelación ───────────────────────────────────────────
const QUERY_MOTIVOS = `
SELECT
  TO_CHAR(DATE_TRUNC('month', c.fecha_cierre), 'YYYY-MM') AS mes,
  c.motivo_cancelacion,
  c.sub_motivo_cancelacion,
  c.tipo_cancelacion,
  COUNT(*) AS casos,
  CASE
    WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
    WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
    WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
    ELSE 'Otros'
  END AS pais_agrupado
FROM salesforce.tabla_intermedia_casos_cancelaciones c
LEFT JOIN salesforce.tabla_core_estudiantes e ON c.student_id = e.student_id
WHERE c.fecha_cierre IS NOT NULL
  AND c.fecha_cierre >= '2024-03-06'
  AND c.motivo_cancelacion IS NOT NULL
GROUP BY
  DATE_TRUNC('month', c.fecha_cierre),
  c.motivo_cancelacion, c.sub_motivo_cancelacion,
  c.tipo_cancelacion, e.pais_agrupado
ORDER BY mes, casos DESC;
`;

// ── Query 5: Tiempo de vida hasta cancelación ────────────────────────────────
const QUERY_TIEMPO_VIDA = `
WITH primera_suscripcion AS (
  SELECT student_id, MIN(fecha_cierre) AS primera_fecha
  FROM salesforce.tabla_core_oportunidades
  WHERE etapa = 'Ganada Verificada'
    AND (
      (sub_tipo_venta LIKE '%Bootcamp%' AND tipo_pago = 'Cuotas')
      OR sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (sub_tipo_venta = 'Mentoría' AND tipo_pago = 'Cuotas')
    )
  GROUP BY student_id
),
casos_cobranza AS (
  SELECT suscripcion, status,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ultimo_caso
  FROM salesforce.tabla_intermedia_casos_cobranza
),
casos_chargeback AS (
  SELECT suscripcion, numero_caso,
    ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ultimo_caso
  FROM salesforce.tabla_core_casos
  WHERE status = 'Cancelado'
    AND id_registro_caso = '012UH000001iGJpYAM'
),
cancelaciones AS (
  SELECT
    s.student_id,
    s.fecha_cancelacion,
    s.subscription_status,
    CASE
      WHEN ch.numero_caso IS NOT NULL                                         THEN 'Chargeback'
      WHEN cob.status = 'Cerrado - Cartera Irrecuperable'                     THEN 'Por mora'
      WHEN LOWER(s.subscription_status) IN (
           'cancelada por no pago','suspendida por no pago',
           'cancelada por pago de saldo pendiente')                           THEN 'Por mora'
      WHEN LOWER(s.subscription_status) IN (
           'chargeback','cancelación chargeback prevention',
           'cancelación por chargeback prevention')                           THEN 'Chargeback'
      WHEN LOWER(s.subscription_status) IN (
           'cancelación programada','cancelacion programada',
           'cancelación con reembolso','suscripción cancelada')               THEN 'Voluntaria'
      WHEN LOWER(s.subscription_status) = 'suscripción cancelada desenrolada' THEN 'Desenrolada'
      ELSE 'Otro'
    END AS tipo_cancelacion,
    DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) AS meses_vida_real
  FROM ${CANCEL_UNICAS} s
  JOIN primera_suscripcion p ON s.student_id = p.student_id
  LEFT JOIN casos_cobranza  cob ON s.id = cob.suscripcion AND cob.ultimo_caso = 1
  LEFT JOIN casos_chargeback ch  ON s.id = ch.suscripcion  AND ch.ultimo_caso = 1
  WHERE s.fecha_cancelacion IS NOT NULL
    AND s.fecha_cancelacion >= '2024-03-06'
    AND s.fecha_cancelacion <= GETDATE()
    AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','')
    AND s.subscription_status IS NOT NULL
    AND DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) >= 0
    AND DATEDIFF('month', p.primera_fecha, s.fecha_cancelacion) <= 60
),
agrupado AS (
  SELECT
    CASE
      WHEN meses_vida_real <= 1  THEN 'Mes 1'
      WHEN meses_vida_real <= 3  THEN 'Mes 2-3'
      WHEN meses_vida_real <= 6  THEN 'Mes 4-6'
      WHEN meses_vida_real <= 12 THEN 'Mes 7-12'
      ELSE '+12 meses'
    END AS rango_vida,
    tipo_cancelacion,
    COUNT(*) AS cantidad,
    ROUND(AVG(meses_vida_real)::numeric, 1) AS avg_meses
  FROM cancelaciones
  GROUP BY 1, 2
),
sorted AS (
  SELECT rango_vida, tipo_cancelacion, cantidad, avg_meses,
    CASE rango_vida
      WHEN 'Mes 1'    THEN 1
      WHEN 'Mes 2-3'  THEN 2
      WHEN 'Mes 4-6'  THEN 3
      WHEN 'Mes 7-12' THEN 4
      ELSE 5
    END AS orden
  FROM agrupado
)
SELECT rango_vida, tipo_cancelacion, cantidad, avg_meses
FROM sorted
ORDER BY orden, tipo_cancelacion;
`;

// ── Query 6: Churn por país ───────────────────────────────────────────────────
const QUERY_CHURN_PAIS = `
WITH activos_pais AS (
  SELECT
    CASE
      WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
      WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    COUNT(DISTINCT f.student_id) AS clientes_totales
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e   ON f.student_id = e.student_id
  WHERE f.invoice_factura = 'invoice'
    AND f.fecha_pago IS NOT NULL
    AND f.fecha_pago >= '2024-03-06'
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND f.numero_invoice_factura >= 1
  GROUP BY 1
),
cancel_pais AS (
  SELECT
    CASE
      WHEN e.pais_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN e.pais_agrupado = 'Colombia'                          THEN 'Colombia'
      WHEN e.pais_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    COUNT(*) AS cancelaciones,
    SUM(CASE
      WHEN ch.numero_caso IS NOT NULL
        OR cob.status = 'Cerrado - Cartera Irrecuperable'
        OR LOWER(s.subscription_status) IN (
           'cancelada por no pago','suspendida por no pago',
           'cancelada por pago de saldo pendiente')
      THEN 1 ELSE 0 END) AS por_mora,
    SUM(CASE
      WHEN LOWER(s.subscription_status) IN (
           'cancelación programada','cancelacion programada',
           'cancelación con reembolso','suscripción cancelada')
      THEN 1 ELSE 0 END) AS voluntaria
  FROM ${CANCEL_UNICAS} s
  LEFT JOIN salesforce.tabla_core_estudiantes e ON s.student_id = e.student_id
  LEFT JOIN (
    SELECT suscripcion, status,
      ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre DESC) AS ult
    FROM salesforce.tabla_intermedia_casos_cobranza
  ) cob ON s.id = cob.suscripcion AND cob.ult = 1
  LEFT JOIN (
    SELECT suscripcion, numero_caso,
      ROW_NUMBER() OVER(PARTITION BY suscripcion ORDER BY fecha_cierre_real DESC) AS ult
    FROM salesforce.tabla_core_casos
    WHERE status = 'Cancelado' AND id_registro_caso = '012UH000001iGJpYAM'
  ) ch ON s.id = ch.suscripcion AND ch.ult = 1
  WHERE s.fecha_cancelacion IS NOT NULL
    AND s.fecha_cancelacion >= '2024-03-06'
    AND s.fecha_cancelacion <= GETDATE()
    AND LOWER(COALESCE(s.subscription_status,'')) NOT IN ('cotización expirada','cotizacion expirada','upgraded','')
    AND s.subscription_status IS NOT NULL
  GROUP BY 1
)
SELECT
  a.pais_agrupado,
  a.clientes_totales,
  COALESCE(c.cancelaciones, 0) AS cancelaciones,
  COALESCE(c.por_mora, 0)      AS por_mora,
  COALESCE(c.voluntaria, 0)    AS voluntaria,
  ROUND(COALESCE(c.cancelaciones, 0) * 100.0 / NULLIF(a.clientes_totales, 0), 1) AS tasa_churn_pct
FROM activos_pais a
LEFT JOIN cancel_pais c ON a.pais_agrupado = c.pais_agrupado
WHERE a.pais_agrupado IS NOT NULL
ORDER BY cancelaciones DESC;
`;

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:churn_v2';
const CACHE_TTL = 604800;

// ── Fuente nueva (lifecycle): estado_clientes Suscripciones + suspendidos ──────
const ESTADO_SUS = `(
  SELECT student_id,
    CAST(fecha_cierre AS date) AS fecha_cierre,
    estado_usuario, sub_estado_usuario,
    CAST(fecha_cancelacion AS date) AS fecha_cancelacion,
    tipo_cancelacion
  FROM salesforce.tabla_intermedia_estado_clientes
  WHERE tipo_oportunidad = 'Suscripciones'
)`;
const SUSP_HIST = `(
  SELECT accountid AS student_id, MAX(CAST(createddate AS date)) AS fecha_susp
  FROM "salesforce-database".account_history
  WHERE newvalue = 'Suspendido' AND field = 'SBEEMO_LS_SUB_ESTADO_USUARIO__c'
  GROUP BY accountid
)`;

// Resumen mensual de flujo (nuevos/cancelados/activos/suspendidos/churn) — fuente lifecycle
const QUERY_FLUJO = `
WITH e AS ${ESTADO_SUS},
nuevos AS (
  SELECT TO_CHAR(DATE_TRUNC('month', fecha_cierre),'YYYY-MM') AS mes, COUNT(*) AS nuevos
  FROM e WHERE fecha_cierre IS NOT NULL GROUP BY 1
),
cancel AS (
  SELECT TO_CHAR(DATE_TRUNC('month', fecha_cancelacion),'YYYY-MM') AS mes,
    COUNT(*) AS cancelados,
    SUM(CASE WHEN LOWER(COALESCE(tipo_cancelacion,'')) LIKE '%mora%' THEN 1 ELSE 0 END) AS mora,
    SUM(CASE WHEN LOWER(COALESCE(tipo_cancelacion,'')) NOT LIKE '%mora%' THEN 1 ELSE 0 END) AS voluntarias
  FROM e WHERE estado_usuario = 'Inactivo' AND fecha_cancelacion IS NOT NULL GROUP BY 1
),
susp AS (
  SELECT TO_CHAR(DATE_TRUNC('month', h.fecha_susp),'YYYY-MM') AS mes, COUNT(*) AS suspendidos
  FROM e JOIN ${SUSP_HIST} h ON e.student_id = h.student_id
  WHERE e.sub_estado_usuario = 'Suspendido' AND e.estado_usuario = 'Activo' AND h.fecha_susp IS NOT NULL
  GROUP BY 1
),
meses AS (SELECT mes FROM nuevos UNION SELECT mes FROM cancel UNION SELECT mes FROM susp),
base AS (
  SELECT m.mes,
    COALESCE(n.nuevos,0) AS nuevos, COALESCE(c.cancelados,0) AS cancelados,
    COALESCE(c.voluntarias,0) AS voluntarias, COALESCE(c.mora,0) AS mora,
    COALESCE(s.suspendidos,0) AS suspendidos
  FROM meses m
  LEFT JOIN nuevos n ON m.mes = n.mes
  LEFT JOIN cancel c ON m.mes = c.mes
  LEFT JOIN susp s ON m.mes = s.mes
),
calc AS (
  SELECT mes, nuevos, cancelados, voluntarias, mora, suspendidos,
    SUM(nuevos) OVER (ORDER BY mes) AS cum_nuevos,
    COALESCE(SUM(cancelados) OVER (ORDER BY mes ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS cum_cancel_prev,
    SUM(suspendidos) OVER (ORDER BY mes) AS acum_susp
  FROM base
)
SELECT mes, nuevos, cancelados, voluntarias, mora, suspendidos, acum_susp AS acum_suspendidos,
  (cum_nuevos - cum_cancel_prev) AS activos,
  (cum_nuevos - cum_cancel_prev - acum_susp) AS activos_netos,
  ROUND(cancelados * 100.0 / NULLIF(cum_nuevos - cum_cancel_prev, 0), 2) AS churn,
  ROUND(cancelados * 100.0 / NULLIF(cum_nuevos - cum_cancel_prev - acum_susp, 0), 2) AS churn_neto
FROM calc
ORDER BY mes;
`;

// Sondeo: valores reales de tipo_cancelacion (para validar el mapeo mora/voluntaria)
const QUERY_TIPOS = `
SELECT COALESCE(tipo_cancelacion,'(null)') AS tipo, COUNT(*) AS n
FROM ${ESTADO_SUS} e WHERE estado_usuario = 'Inactivo'
GROUP BY 1 ORDER BY n DESC;
`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
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
    const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.all([
      client.query(QUERY_NUEVOS),
      client.query(QUERY_CANCELACIONES),
      client.query(QUERY_TASA_CHURN),
      client.query(QUERY_MOTIVOS),
      client.query(QUERY_CHURN_PAIS),
      client.query(QUERY_TIEMPO_VIDA),
      client.query(QUERY_FLUJO),
      client.query(QUERY_TIPOS),
    ]);
    const data = {
      nuevos:        r1.rows,
      cancelaciones: r2.rows,
      tasaChurn:     r3.rows,
      tiempoVida:    r6.rows,
      motivos:       r4.rows,
      churnPais:     r5.rows,
      flujo:         r7.rows,
      tiposCancel:   r8.rows,
    };
    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
    res.status(200).json(data);
  } catch (err) {
    console.error('Churn API error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};