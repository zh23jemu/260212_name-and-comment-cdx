import bcrypt from 'bcryptjs';
import db from './db.js';

const teacherHash = bcrypt.hashSync('123456', 10);
const adminHash = bcrypt.hashSync('admin123', 10);

db.exec('BEGIN');
try {
  db.prepare(
    `INSERT INTO users (username, name, password_hash, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       name = excluded.name,
       password_hash = excluded.password_hash,
       role = excluded.role`
  ).run('teacher', '教师账号', teacherHash, 'teacher');

  db.prepare(
    `INSERT INTO users (username, name, password_hash, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       name = excluded.name,
       password_hash = excluded.password_hash,
       role = excluded.role`
  ).run('admin', '管理员', adminHash, 'admin');

  const existingClasses = db.prepare('SELECT COUNT(1) AS count FROM classes').get().count;
  if (existingClasses === 0) {
    const cls1 = db.prepare('INSERT INTO classes (name, grade) VALUES (?, ?)').run('高一(1)班', '高一').lastInsertRowid;
    const cls2 = db.prepare('INSERT INTO classes (name, grade) VALUES (?, ?)').run('高一(2)班', '高一').lastInsertRowid;

    const students = [
      [cls1, '01', '张明'],
      [cls1, '02', '李华'],
      [cls1, '03', '王敏'],
      [cls1, '04', '赵强'],
      [cls2, '01', '陈晨'],
      [cls2, '02', '刘婷'],
      [cls2, '03', '杨帆'],
      [cls2, '04', '周杰']
    ];

    const insertStudent = db.prepare(
      'INSERT INTO students (class_id, student_no, name, status) VALUES (?, ?, ?, ?)'
    );

    for (const row of students) {
      insertStudent.run(row[0], row[1], row[2], 'active');
    }
  }

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log('Seed complete. Default users: teacher/123456, admin/admin123');
