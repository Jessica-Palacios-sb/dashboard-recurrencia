const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const raw = await redis.get(`session:${token}`);
  if (!raw) return res.status(401).json({ error: 'Sesión inválida o expirada' });

  const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
  res.status(200).json({
    ok: true,
    user: {
      nombre: session.nombre,
      email: session.email,
      rol: session.rol,
      superAdmin: !!session.superAdmin,
      pestanas: session.pestanas || ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'],
      must_change_password: !!session.must_change_password,
    }
  });
};