import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db.js';
import { createSession, requireAuth } from '../auth.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export default async function authRoutes(fastify) {
  fastify.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    const user = db.prepare('SELECT id, username, name, password_hash, role FROM users WHERE username = ?').get(parsed.data.username);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const session = createSession(user.id);
    
    // Set session cookie
    reply.setCookie('session_token', session.token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
    });
    
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, name: user.name || '', role: user.role }
    };
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: request.user };
  });
  
  fastify.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies.session_token;
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    reply.clearCookie('session_token', { path: '/' });
    return { ok: true };
  });
}
