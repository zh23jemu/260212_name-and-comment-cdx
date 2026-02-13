import { z } from 'zod';
import db from '../db.js';

const upsertSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string()
});

const deleteSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1)
});

const clearSchema = z.object({
  namespace: z.string().min(1)
});

export default async function kvRoutes(fastify) {
  fastify.get('/api/kv/snapshot', async (request, reply) => {
    const namespace = String(request.query.namespace || 'global').trim();
    if (!namespace) {
      return reply.code(400).send({ error: 'INVALID_NAMESPACE' });
    }

    const rows = db.prepare(
      `SELECT storage_key as key, storage_value as value
       FROM kv_store
       WHERE namespace = ?`
    ).all(namespace);

    const payload = {};
    for (const row of rows) {
      payload[row.key] = row.value;
    }

    return { namespace, items: payload };
  });

  fastify.post('/api/kv/upsert', async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    const body = parsed.data;
    db.prepare(
      `INSERT INTO kv_store(namespace, storage_key, storage_value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(namespace, storage_key)
       DO UPDATE SET storage_value = excluded.storage_value, updated_at = datetime('now')`
    ).run(body.namespace, body.key, body.value);

    return { ok: true };
  });

  fastify.post('/api/kv/delete', async (request, reply) => {
    const parsed = deleteSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    db.prepare('DELETE FROM kv_store WHERE namespace = ? AND storage_key = ?').run(parsed.data.namespace, parsed.data.key);
    return { ok: true };
  });

  fastify.post('/api/kv/clear', async (request, reply) => {
    const parsed = clearSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    db.prepare('DELETE FROM kv_store WHERE namespace = ?').run(parsed.data.namespace);
    return { ok: true };
  });
}
