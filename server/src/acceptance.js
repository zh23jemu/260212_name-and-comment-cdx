import { spawn } from 'node:child_process';
import process from 'node:process';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        return true;
      }
    } catch (_) {
      // Keep polling.
    }
    await sleep(300);
  }
  throw new Error('Server health check timed out');
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function runChecks() {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: '123456' })
  });

  if (!login.token) {
    throw new Error('Login did not return token');
  }

  const auth = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

  const classes = await request('/api/classes', { headers: auth });
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('No classes returned');
  }

  const classId = Number(classes[0].id);
  const students = await request(`/api/classes/${classId}/students`, { headers: auth });
  if (!Array.isArray(students) || students.length === 0) {
    throw new Error('No students returned');
  }

  const studentId = Number(students[0].id);
  const today = new Date().toISOString().slice(0, 10);

  await request('/api/attendance', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ classId, studentId, status: 'present', date: today })
  });

  const attendanceRows = await request(`/api/attendance?classId=${classId}&date=${today}`, { headers: auth });
  if (!Array.isArray(attendanceRows) || attendanceRows.length === 0) {
    throw new Error('Attendance write/read check failed');
  }

  await request('/api/evaluations', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ classId, studentId, score: 5, tags: ['active'], comment: 'acceptance-check' })
  });

  const stats = await request('/api/statistics/overview', { headers: auth });
  if (typeof stats.evaluations !== 'number') {
    throw new Error('Statistics response shape invalid');
  }

  await request('/api/kv/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace: 'acceptance', key: 'k', value: 'v' })
  });

  const snapshot = await request('/api/kv/snapshot?namespace=acceptance');
  if (!snapshot.items || snapshot.items.k !== 'v') {
    throw new Error('KV snapshot validation failed');
  }

  await request('/api/kv/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace: 'acceptance', key: 'k' })
  });

  console.log('Acceptance checks passed');
}

async function main() {
  const child = spawn(process.execPath, ['src/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: process.env
  });

  let stderr = '';
  child.stderr.on('data', (buf) => {
    stderr += buf.toString();
  });

  try {
    await waitForHealth();
    await runChecks();
  } catch (error) {
    if (stderr) {
      console.error(stderr);
    }
    throw error;
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
