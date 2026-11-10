import { createDb, getDbPath } from './db/index.js';
import { createApp } from './app.js';
import { startDailyBriefingScheduler } from './lib/dailyBriefingScheduler.js';
import { recoverInterruptedInboundEmails } from './lib/inboundEmailStartupRecovery.js';

const PORT = Number(process.env.PORT) || 3001;
// Bind all interfaces so Fly's edge proxy can reach the app (a loopback bind
// would make it unreachable). `listen(PORT)` already binds here by default;
// this makes it explicit and the startup log honest.
const HOST = process.env.HOST || '0.0.0.0';

const db = createDb();
const app = createApp(db);

startDailyBriefingScheduler(db);

// Emails a deploy or restart interrupted (see inboundEmailStartupRecovery).
const recovered = recoverInterruptedInboundEmails(db);
if (recovered.length > 0) {
  console.log(`[inbound-processing] rescheduled ${recovered.length} interrupted email(s)`);
}

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${getDbPath()}`);
});
