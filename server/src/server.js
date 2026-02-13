import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import kvRoutes from './routes/kv.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true
});

const rootDir = path.resolve(process.cwd(), '..');

await app.register(fastifyStatic, {
  root: rootDir,
  prefix: '/',
  decorateReply: false
});

await app.register(authRoutes);
await app.register(dataRoutes);
await app.register(kvRoutes);

app.get('/api/health', async () => ({ ok: true, timestamp: new Date().toISOString() }));

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'NOT_FOUND' });
    return;
  }

  reply.code(404).type('text/plain').send('Not found');
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3000');

app.listen({ host, port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
