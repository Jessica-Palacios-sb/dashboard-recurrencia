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

  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password)
    return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });

  if (password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const emailLower = email.toLowerCase().trim();

  // Verificar si ya existe
  const existing = await redis.get(`user:${emailLower}`);
  if (existing) return res.status(400).json({ error: 'Este email ya está registrado' });

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    nombre: nombre.trim(),
    email: emailLower,
    password: hashPassword(password),
    rol: 'viewer',
    estado: 'pendiente',
    pestanas: ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'],
    created_at: new Date().toISOString(),
  };

  // Guardar usuario
  await redis.set(`user:${emailLower}`, JSON.stringify(user));
  await redis.sadd('users:all', emailLower);

  // Notificar al admin por email via Resend
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Dashboard Beemo <noreply@smartbeemo.com>',
        to: ['jpalacios@smartbeemo.com'],
        subject: `Nueva solicitud de acceso — ${nombre}`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
            <h2 style="color:#111">Nueva solicitud de acceso al Dashboard</h2>
            <p><strong>Nombre:</strong> ${nombre}</p>
            <p><strong>Email:</strong> ${emailLower}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-CO', {timeZone:'America/Bogota'})}</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
            <p style="color:#666;font-size:14px">
              Ingresa al dashboard y ve a la pestaña <strong>Usuarios</strong> para aprobar o rechazar esta solicitud.
            </p>
          </div>
        `,
      }),
    });
  } catch (e) {
    console.error('Error sending email:', e.message);
  }

  res.status(200).json({ ok: true, message: 'Solicitud enviada. Te avisaremos cuando sea aprobada.' });
};