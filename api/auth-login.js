const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });

  const emailLower = email.toLowerCase().trim();
  const raw = await redis.get(`user:${emailLower}`);
  if (!raw) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (user.password !== hashPassword(password))
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  if (user.estado === 'pendiente')
    return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación' });

  if (user.estado === 'rechazado')
    return res.status(403).json({ error: 'Tu acceso fue rechazado. Contacta a jpalacios@smartbeemo.com' });

  if (user.estado === 'suspendido')
    return res.status(403).json({ error: 'Tu acceso fue suspendido. Contacta a jpalacios@smartbeemo.com' });

  // Crear sesión
  const sessionToken = crypto.randomUUID();
  const session = {
    userId: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    pestanas: user.pestanas || ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'],
    created_at: new Date().toISOString(),
  };

  // Sesión válida por 7 días
  await redis.set(`session:${sessionToken}`, JSON.stringify(session), { ex: 604800 });

  res.status(200).json({
    ok: true,
    token: sessionToken,
    user: {
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      pestanas: user.pestanas || ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'],
      must_change_password: !!user.must_change_password,
    },
  });
};