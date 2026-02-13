import crypto from 'node:crypto';
import db from './db.js';

const TTL_DAYS = 7;

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt);

  return { token, expiresAt };
}

export function resolveSession(token) {
  if (!token) {
    return null;
  }

  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username, u.name, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).get(token);

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    token: row.token,
    expiresAt: row.expires_at,
    user: {
      id: row.id,
      username: row.username,
      name: row.name || '',
      role: row.role
    }
  };
}

export function requireAuth(request, reply, done) {
  const authHeader = request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = resolveSession(token);

  if (!session) {
    reply.code(401).send({ error: 'UNAUTHORIZED' });
    return;
  }

  request.user = session.user;
  done();
}
