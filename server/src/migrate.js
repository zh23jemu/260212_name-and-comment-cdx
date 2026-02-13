import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';

const migrationPath = path.join(process.cwd(), 'src', 'migrations.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
db.exec(sql);

console.log('Migration complete:', migrationPath);
