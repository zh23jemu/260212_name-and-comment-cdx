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

    const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').get(parsed.data.username);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const session = createSession(user.id);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username, role: user.role }
    };
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: request.user };
  });
}
