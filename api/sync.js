const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

const ENDPOINTS = [
  'recurrencia',
  'salud',
  'salud-cohortes',
  'cancelaciones',
  'churn',
  'marketing',
];

const LOG_KEY = 'sync:log';
const LOG_TTL = 604800; // 7 días

async function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';

  // Llamada del cron de Vercel
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, type: 'cron' };
  }

  // Sesión de super admin
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const raw = await redis.get(`session:${token}`);
    if (raw) {
      const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (session.email === 'jpalacios@smartbeemo.com') {
        return { ok: true, type: 'admin', email: session.email };
      }
    }
  }

  return { ok: false };
}

async function triggerSync(baseUrl, secret) {
  const startedAt = new Date().toISOString();

  await redis.set(LOG_KEY, JSON.stringify({
    status: 'running',
    startedAt,
    endpoints: {},
  }), { ex: LOG_TTL });

  const fetchEndpoint = async (name) => {
    const t0 = Date.now();
    try {
      const response = await fetch(`${baseUrl}/api/${name}`, {
        headers: { 'x-sync-secret': secret },
        signal: AbortSignal.timeout(280000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { status: 'ok', ms: Date.now() - t0, syncedAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'error', error: err.message, ms: Date.now() - t0 };
    }
  };

  const results = {};
  await Promise.allSettled(
    ENDPOINTS.map(async (name) => {
      results[name] = await fetchEndpoint(name);
    })
  );

  const completedAt = new Date().toISOString();
  const hasErrors = Object.values(results).some((r) => r.status === 'error');

  const log = {
    status: hasErrors ? 'partial' : 'ok',
    startedAt,
    completedAt,
    endpoints: results,
  };

  await redis.set(LOG_KEY, JSON.stringify(log), { ex: LOG_TTL });
  return log;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'No autorizado' });

  if (req.method === 'GET') {
    const raw = await redis.get(LOG_KEY);
    const log = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    return res.status(200).json({ ok: true, log });
  }

  if (req.method === 'POST') {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${proto}://${req.headers.host}`;
    const secret = process.env.CRON_SECRET;

    const log = await triggerSync(baseUrl, secret);
    return res.status(200).json({ ok: true, log });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
