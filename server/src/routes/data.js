import { z } from 'zod';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const attendanceSchema = z.object({
  classId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  status: z.enum(['present', 'late', 'absent', 'leave']),
  date: z.string().min(1)
});

const evaluationSchema = z.object({
  classId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.string()).default([]),
  comment: z.string().optional().default('')
});
const createStudentSchema = z.object({
  classId: z.number().int().positive(),
  name: z.string().min(1),
  studentNo: z.string().optional().default(''),
  status: z.string().optional().default('active')
});
const createClassSchema = z.object({
  name: z.string().min(1),
  grade: z.string().optional().default('')
});
const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  grade: z.string().optional()
});
const batchDeleteStudentsSchema = z.object({
  studentIds: z.array(z.number().int().positive()).min(1)
});

export default async function dataRoutes(fastify) {
  fastify.get('/api/classes', async () => {
    return db.prepare('SELECT id, name, grade, created_at as createdAt FROM classes ORDER BY id').all();
  });

  fastify.post('/api/classes', async (request, reply) => {
    const parsed = createClassSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const result = db.prepare(
      `INSERT INTO classes (name, grade)
       VALUES (?, ?)`
    ).run(body.name.trim(), (body.grade || '').trim());

    return { ok: true, id: result.lastInsertRowid };
  });

  fastify.put('/api/classes/:id', async (request, reply) => {
    const classId = Number(request.params.id);
    if (!Number.isInteger(classId) || classId <= 0) {
      return reply.code(400).send({ error: 'INVALID_CLASS_ID' });
    }

    const parsed = updateClassSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const existing = db.prepare('SELECT id, name, grade FROM classes WHERE id = ?').get(classId);
    if (!existing) {
      return reply.code(404).send({ error: 'CLASS_NOT_FOUND' });
    }

    const name = (parsed.data.name ?? existing.name ?? '').trim();
    const grade = (parsed.data.grade ?? existing.grade ?? '').trim();
    if (!name) {
      return reply.code(400).send({ error: 'INVALID_CLASS_NAME' });
    }

    db.prepare('UPDATE classes SET name = ?, grade = ? WHERE id = ?').run(name, grade, classId);
    return { ok: true, id: classId };
  });

  fastify.delete('/api/classes/:id', async (request, reply) => {
    const classId = Number(request.params.id);
    if (!Number.isInteger(classId) || classId <= 0) {
      return reply.code(400).send({ error: 'INVALID_CLASS_ID' });
    }

    const existing = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
    if (!existing) {
      return { ok: true, id: classId, deleted: false };
    }

    db.exec('BEGIN');
    try {
      const studentRows = db.prepare('SELECT id FROM students WHERE class_id = ?').all(classId);
      const delAttendanceByClass = db.prepare('DELETE FROM attendance WHERE class_id = ?');
      const delEvalByClass = db.prepare('DELETE FROM evaluations WHERE class_id = ?');
      const delAttendanceByStudent = db.prepare('DELETE FROM attendance WHERE student_id = ?');
      const delEvalByStudent = db.prepare('DELETE FROM evaluations WHERE student_id = ?');
      const delStudents = db.prepare('DELETE FROM students WHERE class_id = ?');
      const delClass = db.prepare('DELETE FROM classes WHERE id = ?');

      delAttendanceByClass.run(classId);
      delEvalByClass.run(classId);
      for (const row of studentRows) {
        delAttendanceByStudent.run(row.id);
        delEvalByStudent.run(row.id);
      }
      delStudents.run(classId);
      delClass.run(classId);

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { ok: true, id: classId, deleted: true };
  });

  fastify.get('/api/classes/:id/students', async (request, reply) => {
    const classId = Number(request.params.id);
    if (!Number.isInteger(classId) || classId <= 0) {
      return reply.code(400).send({ error: 'INVALID_CLASS_ID' });
    }

    const rows = db.prepare(
      `SELECT id, class_id as classId, student_no as studentNo, name, status, created_at as createdAt
       FROM students
       WHERE class_id = ?
       ORDER BY CAST(student_no AS INTEGER), student_no, id`
    ).all(classId);

    return rows;
  });

  fastify.delete('/api/students/:id', async (request, reply) => {
    const studentId = Number(request.params.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return reply.code(400).send({ error: 'INVALID_STUDENT_ID' });
    }

    const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
    if (!existing) {
      // Idempotent delete: missing record is treated as already deleted.
      return { ok: true, id: studentId, deleted: false };
    }

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM attendance WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM evaluations WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { ok: true, id: studentId, deleted: true };
  });

  fastify.post('/api/students/batch-delete', async (request, reply) => {
    const parsed = batchDeleteStudentsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const ids = Array.from(new Set(parsed.data.studentIds));
    let deletedCount = 0;

    db.exec('BEGIN');
    try {
      const delAttendance = db.prepare('DELETE FROM attendance WHERE student_id = ?');
      const delEvaluation = db.prepare('DELETE FROM evaluations WHERE student_id = ?');
      const delStudent = db.prepare('DELETE FROM students WHERE id = ?');

      for (const id of ids) {
        delAttendance.run(id);
        delEvaluation.run(id);
        const result = delStudent.run(id);
        deletedCount += Number(result.changes || 0);
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { ok: true, requested: ids.length, deleted: deletedCount };
  });

  fastify.post('/api/students', async (request, reply) => {
    const parsed = createStudentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(body.classId);
    if (!cls) {
      return reply.code(404).send({ error: 'CLASS_NOT_FOUND' });
    }

    if (body.studentNo) {
      const duplicate = db.prepare(
        'SELECT id FROM students WHERE class_id = ? AND student_no = ? LIMIT 1'
      ).get(body.classId, body.studentNo);
      if (duplicate) {
        return reply.code(409).send({ error: 'DUPLICATE_STUDENT_NO' });
      }
    }

    const result = db.prepare(
      `INSERT INTO students (class_id, student_no, name, status)
       VALUES (?, ?, ?, ?)`
    ).run(body.classId, body.studentNo || '', body.name, body.status || 'active');

    return { ok: true, id: result.lastInsertRowid };
  });

  fastify.get('/api/attendance', { preHandler: requireAuth }, async (request, reply) => {
    const classId = Number(request.query.classId);
    const date = String(request.query.date || '').trim();

    if (!Number.isInteger(classId) || classId <= 0 || !date) {
      return reply.code(400).send({ error: 'INVALID_QUERY' });
    }

    return db.prepare(
      `SELECT id, class_id as classId, student_id as studentId, status, attendance_date as date, created_at as createdAt
       FROM attendance
       WHERE class_id = ? AND attendance_date = ?
       ORDER BY student_id`
    ).all(classId, date);
  });

  fastify.post('/api/attendance', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = attendanceSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const row = parsed.data;
    db.prepare(
      `INSERT INTO attendance (class_id, student_id, status, attendance_date, teacher_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(class_id, student_id, attendance_date)
       DO UPDATE SET status = excluded.status, teacher_id = excluded.teacher_id`
    ).run(row.classId, row.studentId, row.status, row.date, request.user.id);

    return { ok: true };
  });

  fastify.post('/api/evaluations', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = evaluationSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    }

    const row = parsed.data;
    const result = db.prepare(
      `INSERT INTO evaluations (class_id, student_id, teacher_id, score, tags_json, comment)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(row.classId, row.studentId, request.user.id, row.score, JSON.stringify(row.tags), row.comment || '');

    return { id: result.lastInsertRowid, ok: true };
  });

  fastify.get('/api/statistics/overview', { preHandler: requireAuth }, async () => {
    const classes = db.prepare('SELECT COUNT(1) as count FROM classes').get().count;
    const students = db.prepare('SELECT COUNT(1) as count FROM students').get().count;
    const evaluations = db.prepare('SELECT COUNT(1) as count FROM evaluations').get().count;

    const avg = db.prepare('SELECT IFNULL(ROUND(AVG(score), 2), 0) as avgScore FROM evaluations').get().avgScore;

    const topStudents = db.prepare(
      `SELECT s.id, s.name, s.class_id as classId, ROUND(AVG(e.score), 2) as avgScore, COUNT(e.id) as evaluationCount
       FROM evaluations e
       JOIN students s ON s.id = e.student_id
       GROUP BY e.student_id
       ORDER BY avgScore DESC, evaluationCount DESC
       LIMIT 10`
    ).all();

    return {
      classes,
      students,
      evaluations,
      avgScore: avg,
      topStudents
    };
  });
}
