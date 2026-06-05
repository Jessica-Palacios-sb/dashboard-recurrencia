const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
});

async function getSession(token) {
  if (!token) return null;
  const raw = await redis.get(`session:${token}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar sesión admin
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  if (session.rol !== 'admin') return res.status(403).json({ error: 'Se requiere rol admin' });

  // GET — listar todos los usuarios
  if (req.method === 'GET') {
    const emails = await redis.smembers('users:all');
    const users = await Promise.all(
      emails.map(async (email) => {
        const raw = await redis.get(`user:${email}`);
        if (!raw) return null;
        const u = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, estado: u.estado, created_at: u.created_at,
      pestanas: u.pestanas || ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'] };
      })
    );
    const sorted = users.filter(Boolean).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.status(200).json({ users: sorted });
  }

  // POST — aprobar, rechazar o cambiar rol
  if (req.method === 'POST') {
    const { email, action, rol } = req.body;
    if (!email || !action) return res.status(400).json({ error: 'Email y acción son requeridos' });

    const emailLower = email.toLowerCase().trim();
    const raw = await redis.get(`user:${emailLower}`);
    if (!raw) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (action === 'aprobar') {
      user.estado = 'aprobado';
      user.approved_at = new Date().toISOString();
      user.approved_by = session.email;
      // Enviar email de bienvenida
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Dashboard Beemo <noreply@smartbeemo.com>',
            to: [emailLower],
            subject: '¡Tu acceso al Dashboard fue aprobado!',
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
                <h2 style="color:#111">¡Bienvenido/a ${user.nombre}!</h2>
                <p>Tu solicitud de acceso al Dashboard de Recurrencia de Beemo fue <strong style="color:#10b981">aprobada</strong>.</p>
                <p>Ya puedes ingresar con tu email y contraseña en:</p>
                <a href="https://dashboard-recurrencia.vercel.app" 
                   style="display:inline-block;margin:16px 0;padding:12px 24px;background:#FFD700;color:#111;font-weight:700;text-decoration:none;border-radius:8px">
                  Ir al Dashboard
                </a>
                <p style="color:#666;font-size:14px">Si tienes alguna duda escríbenos a jpalacios@smartbeemo.com</p>
              </div>
            `,
          }),
        });
      } catch (e) { console.error('Email error:', e.message); }
    } else if (action === 'rechazar') {
      user.estado = 'rechazado';
    } else if (action === 'suspender') {
      user.estado = 'suspendido';
    } else if (action === 'reactivar') {
      user.estado = 'aprobado';
    } else if (action === 'cambiar_rol' && rol) {
      user.rol = rol;
    } else if (action === 'cambiar_pestanas' && req.body.pestanas) {
      user.pestanas = req.body.pestanas;
    } else if (action === 'reset_password') {
      const crypto = require('crypto');
      const tempPassword = (req.body.tempPassword || 'Beemo2024').toString();
      if (tempPassword.length < 6) return res.status(400).json({ error: 'La contraseña temporal debe tener al menos 6 caracteres' });
      user.password = crypto.createHash('sha256').update(tempPassword).digest('hex');
      user.must_change_password = true;
    } else {
      return res.status(400).json({ error: 'Acción no válida' });
    }

    await redis.set(`user:${emailLower}`, JSON.stringify(user));
    return res.status(200).json({ ok: true, user: { nombre: user.nombre, email: user.email, rol: user.rol, estado: user.estado } });
  }

  res.status(405).json({ error: 'Method not allowed' });
};