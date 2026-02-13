import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';

const migrationPath = path.join(process.cwd(), 'src', 'migrations.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
db.exec(sql);

// Backward-compatible schema upgrades for existing databases.
const userColumns = db.prepare("PRAGMA table_info('users')").all();
const hasName = userColumns.some((col) => String(col.name) === 'name');
if (!hasName) {
  db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
}

console.log('Migration complete:', migrationPath);
