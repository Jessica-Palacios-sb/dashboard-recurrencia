const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function getSession(token) {
  if (!token) return null;
  const raw = await redis.get(`session:${token}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query.action;

  // ── set-direct: el usuario (o un admin) fija una contraseña directamente ──────
  // Lo usa el modal obligatorio de cambio de clave y el botón "Cambiar contraseña".
  if (action === 'set-direct') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (!session) return res.status(401).json({ error: 'No autorizado' });

    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const emailLower = email.toLowerCase().trim();
    // Solo puede cambiar su propia contraseña, salvo que sea admin.
    if (emailLower !== session.email && session.rol !== 'admin') {
      return res.status(403).json({ error: 'No autorizado para cambiar esta contraseña' });
    }

    const raw = await redis.get(`user:${emailLower}`);
    if (!raw) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = typeof raw === 'string' ? JSON.parse(raw) : raw;

    user.password = hashPassword(password);
    user.must_change_password = false;
    await redis.set(`user:${emailLower}`, JSON.stringify(user));

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Acción no válida' });
};
