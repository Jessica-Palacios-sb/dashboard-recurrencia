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

const QUERY = `
  SELECT
    f.student_id,
    f.id                        AS id_factura,
    f.invoice_fact_number,
    f.numero_invoice_factura,
    f.due_date,
    f.fecha_pago,
    f.total_amount_usd,
    f.payment_amount_usd,
    f.open_balance,
    f.estado,
    f.metodo_pago,
    o.tipo_pago,
    o.tipo_venta,
    o.sub_tipo_venta,
    o.tiempo_meses_estudio,
    o.pais_lead,
    o.num_cuotas,
    o.fecha_cierre              AS fecha_cierre,
    CASE
      WHEN o.pais_lead_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN o.pais_lead_agrupado IN ('Colombia')                       THEN 'Colombia'
      WHEN o.pais_lead_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    e.tipo_suscripcion,
    o.tiempo_recurrencia        AS frecuencia_suscripcion,
    e.converted_date,
    CASE
      WHEN o.tipo_venta = 'Comeback OPS'
           AND f.numero_invoice_factura = 1
           THEN 'Comeback'
      WHEN o.tipo_venta = 'Upgrade OPS'
           AND f.numero_invoice_factura IN (1,21)
           AND o.grupo IN ('Collection','Retention')
           THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2
           AND cob.tipo_cobro = 'Cobro asesor'
           THEN 'Cobranza'
      WHEN ca.id_invoice_factura IS NOT NULL
           THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2
           AND cob.id_invoice_factura IS NULL
           THEN 'Recurrencia'
      WHEN f.numero_invoice_factura >= 2
           AND cob.tipo_cobro = 'Cobro automático con caso'
           THEN 'Recurrencia'
      WHEN o.tipo_venta = 'Up-Selling'
           AND f.numero_invoice_factura = 1
           THEN 'Up-Selling'
      WHEN o.tipo_venta IN ('Cross-Selling','Freemium Cross-Selling')
           AND f.numero_invoice_factura = 1
           THEN 'Bootcamp & Cross'
      WHEN o.sub_tipo_venta = 'Mentoría'
           AND f.numero_invoice_factura >= 2
           THEN 'Cuotas Mentorías'
      WHEN f.numero_invoice_factura = 1
           AND o.tipo_venta = 'Adquisicion'
           THEN 'Adquisicion'
      ELSE 'Otro'
    END AS proceso_clasificado,
    CASE
      WHEN o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling')
           THEN 1
      ELSE 0
    END AS es_upgrade,
    'Invoice' AS tipo_ingreso
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o
    ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e
    ON f.student_id = e.student_id
  LEFT JOIN salesforce.tabla_intermedia_casos_cobranza cob
    ON cob.id_invoice_factura = f.id
  LEFT JOIN salesforce.tabla_core_casos ca
    ON f.id = ca.id_invoice_factura
    AND ca.id_registro_caso = '012UH000009AltJYAS'
  WHERE f.invoice_factura = 'invoice'
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
      OR o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling')
    )
    AND (f.fecha_pago IS NULL OR f.fecha_pago <= GETDATE())

  UNION ALL

  SELECT
    f.student_id,
    f.id                        AS id_factura,
    f.invoice_fact_number,
    f.numero_invoice_factura,
    f.due_date,
    f.fecha_pago,
    f.total_amount_usd,
    f.payment_amount_usd,
    f.open_balance,
    f.estado,
    f.metodo_pago,
    o.tipo_pago,
    o.tipo_venta,
    o.sub_tipo_venta,
    o.tiempo_meses_estudio,
    o.pais_lead,
    o.num_cuotas,
    o.fecha_cierre              AS fecha_cierre,
    CASE
      WHEN o.pais_lead_agrupado IN ('México','Mexico')                THEN 'México'
      WHEN o.pais_lead_agrupado IN ('Colombia')                       THEN 'Colombia'
      WHEN o.pais_lead_agrupado IN ('Estados Unidos','United States') THEN 'Estados Unidos'
      ELSE 'Otros'
    END AS pais_agrupado,
    e.tipo_suscripcion,
    o.tiempo_recurrencia        AS frecuencia_suscripcion,
    e.converted_date,
    CASE
      WHEN f.adelanto = true
           THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2
           AND cob.tipo_cobro = 'Cobro asesor'
           THEN 'Cobranza'
      WHEN f.numero_invoice_factura >= 2
           AND cob.id_invoice_factura IS NULL
           THEN 'Recurrencia'
      WHEN f.numero_invoice_factura >= 2
           AND cob.tipo_cobro = 'Cobro automático con caso'
           THEN 'Recurrencia'
      WHEN o.tipo_venta = 'Up-Selling'
           AND f.numero_invoice_factura = 1
           THEN 'Up-Selling'
      WHEN o.tipo_venta IN ('Cross-Selling','Freemium Cross-Selling')
           AND f.numero_invoice_factura = 1
           THEN 'Bootcamp & Cross'
      WHEN o.sub_tipo_venta = 'Mentoría'
           AND f.numero_invoice_factura >= 2
           THEN 'Cuotas Mentorías'
      WHEN f.numero_invoice_factura = 1
           AND o.tipo_venta = 'Adquisicion'
           THEN 'Adquisicion'
      ELSE 'Otro'
    END AS proceso_clasificado,
    CASE
      WHEN o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling')
           THEN 1
      ELSE 0
    END AS es_upgrade,
    'Factura' AS tipo_ingreso
  FROM salesforce.tabla_core_invoices_facturas f
  LEFT JOIN salesforce.tabla_core_oportunidades o
    ON f.id_oportunidad = o.id
  LEFT JOIN salesforce.tabla_core_estudiantes e
    ON f.student_id = e.student_id
  LEFT JOIN salesforce.tabla_intermedia_casos_cobranza cob
    ON cob.id_invoice_factura = f.id
  LEFT JOIN salesforce.tabla_core_casos ca
    ON f.id = ca.id_invoice_factura
    AND ca.id_registro_caso = '012UH000009AltJYAS'
  WHERE f.invoice_factura = 'factura'
    AND o.fecha_cierre < '2024-03-06'
    AND o.etapa IN ('Ganada Verificada', 'Closed Won')
    AND (
      (o.sub_tipo_venta LIKE '%Bootcamp%' AND o.tipo_pago = 'Cuotas')
      OR o.sub_tipo_venta LIKE '%Suscripción smartBeemo%'
      OR (o.sub_tipo_venta = 'Mentoría' AND o.tipo_pago = 'Cuotas')
      OR o.tipo_venta IN ('Up-Selling','Cross-Selling','Upgrade OPS','Freemium Cross-Selling')
    )
    AND (f.fecha_pago IS NULL OR f.fecha_pago <= GETDATE())
`;

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
      const result = await client.query(QUERY);
      const data = { data: result.rows };
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