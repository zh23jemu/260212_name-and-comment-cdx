# SQLite Backend

## Prerequisites
- Node.js 24+ (uses built-in `node:sqlite` driver)

## Start
1. `cd server`
2. `npm install`
3. `npm run migrate`
4. `npm run seed`
5. `npm run start`

Service runs on `http://0.0.0.0:3000` by default.

## Default accounts
- `teacher / 123456`
- `admin / admin123`

## Notes
- Static HTML files are served from repository root by Fastify static plugin.
- `assets/static/bridge.js` syncs browser `localStorage` into SQLite `kv_store` through `/api/kv/*`.
- Database file: `server/data/app.db`.
