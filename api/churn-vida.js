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

// ── Query: Tiempo de vida hasta cancelación ───────────────────────────────────
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
  FROM salesforce.tabla_core_suscripciones s
  JOIN primera_suscripcion p ON s.student_id = p.student_id
  LEFT JOIN casos_cobranza  cob ON s.id = cob.suscripcion AND cob.ultimo_caso = 1
  LEFT JOIN casos_chargeback ch  ON s.id = ch.suscripcion  AND ch.ultimo_caso = 1
  WHERE s.fecha_cancelacion IS NOT NULL
    AND s.fecha_cancelacion >= '2024-03-06'
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const client = getClient();
  try {
    await client.connect();
    const result = await client.query(QUERY_TIEMPO_VIDA);
    res.status(200).json({ tiempoVida: result.rows });
  } catch (err) {
    console.error('churn-vida error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};