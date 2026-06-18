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
  query_timeout: 270000,
});

// CTEs de "detalle" (provistas por negocio) — invoice-level. Se omite el join a
// tabla_intermedia_estado_clientes (no se usa y puede multiplicar filas).
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
    CASE WHEN coalesce(d.id_invoice, cm.id_invoice) IS NOT NULL AND i.payment_amount_usd > 0 THEN 'Pago con descuento'
      WHEN coalesce(d.id_invoice, cm.id_invoice) IS NOT NULL AND i.total_amount_usd = 0 THEN 'Mes de gracia'
      WHEN i.estado IN ('Pagada','En Mora','Reembolsada','No Pagada') THEN i.estado END estado_invoice,
    CASE WHEN i.ultima_invoice_factura = 1 THEN c.fecha_mes_cancelacion ELSE NULL END fecha_mes_cancelacion,
    CASE WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL AND cob.status = 'Cerrado - Cartera Irrecuperable' THEN 'Cancelación por mora'
      WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL AND ch.numero_caso IS NOT NULL THEN 'Cancelación por chargeback'
      WHEN i.ultima_invoice_factura = 1 AND c.fecha_cancelacion IS NOT NULL THEN 'Cancelación voluntaria'
      ELSE NULL END tipo_cancelacion,
    CASE WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND c.status_cancelacion IN ('Cancelada por pago de saldo pendiente','Upgraded') AND c.fecha_cancelacion IS NOT NULL THEN 1
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND i.tipo_pago = 'Contado' AND c.fecha_cancelacion IS NOT NULL THEN 1
      WHEN u.id_student IS NOT NULL AND i.ultima_invoice_factura = 1 AND u.ssub_tipo_venta = 'Saldo pendiente suscripción' THEN 1
      ELSE 0 END Up,
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

// Una sola consulta: detalle se calcula una vez y se devuelven funnel + cohorte (con discriminador 'tipo').
const QUERY = `${DETALLE}
, funnel AS (
  SELECT 'funnel' AS tipo, pais, tipo_cliente, tipo_pago,
    CASE
      WHEN Up = 1 THEN 'Upgrade'
      WHEN tipo_cancelacion = 'Cancelación por mora' THEN 'Por mora'
      WHEN tipo_cancelacion = 'Cancelación por chargeback' THEN 'Chargeback'
      WHEN tipo_cancelacion = 'Cancelación voluntaria' THEN 'Voluntaria'
      WHEN estado_pago = 'No pago' THEN 'En mora sin cancelar'
      ELSE NULL
    END AS k1,
    NULL AS k2,
    COUNT(*) AS n,
    ROUND(SUM(COALESCE(cash_sin_pagar, 0))::numeric, 0) AS cash
  FROM detalle
  WHERE ultima_invoice_factura = 1
  GROUP BY 2,3,4,5
),
cohorte AS (
  SELECT 'cohorte' AS tipo, pais, tipo_cliente, NULL AS tipo_pago,
    TO_CHAR(fecha_cierre, 'YYYY-MM') AS k1,
    TO_CHAR(due_date, 'YYYY-MM')     AS k2,
    COUNT(*) AS n,
    NULL AS cash
  FROM detalle
  WHERE fecha_cierre IS NOT NULL AND due_date IS NOT NULL
  GROUP BY 2,3,5,6
)
SELECT * FROM funnel WHERE k1 IS NOT NULL
UNION ALL
SELECT * FROM cohorte`;

let _redis = null;
const getRedis = () => {
  if (!_redis) _redis = new Redis({
    url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  });
  return _redis;
};
const CACHE_KEY = 'cache:facturacion';
const CACHE_TTL = 18000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
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
    const r = await client.query(QUERY);
    const funnel = r.rows.filter(x => x.tipo === 'funnel').map(x => ({
      pais: x.pais, tipo_cliente: x.tipo_cliente, tipo_pago: x.tipo_pago,
      razon: x.k1, oportunidades: +x.n, cash_en_riesgo: +x.cash || 0,
    }));
    const cohorte = r.rows.filter(x => x.tipo === 'cohorte').map(x => ({
      pais: x.pais, tipo_cliente: x.tipo_cliente,
      cohorte: x.k1, mes_vencimiento: x.k2, invoices: +x.n,
    }));
    const data = { funnel, cohorte };
    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL });
    res.status(200).json(data);
  } catch (err) {
    console.error('Facturacion API error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};
