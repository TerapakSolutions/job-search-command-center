import { createDb, getDbPath } from './db/index.js';
import { createApp } from './app.js';
import { startDailyBriefingScheduler } from './lib/dailyBriefingScheduler.js';

const PORT = Number(process.env.PORT) || 3001;
// Bind all interfaces so Fly's edge proxy can reach the app (a loopback bind
// would make it unreachable). `listen(PORT)` already binds here by default;
// this makes it explicit and the startup log honest.
const HOST = process.env.HOST || '0.0.0.0';

const db = createDb();
const app = createApp(db);

startDailyBriefingScheduler(db);

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${getDbPath()}`);
});
