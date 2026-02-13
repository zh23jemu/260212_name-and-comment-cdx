import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'app.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

export default db;
