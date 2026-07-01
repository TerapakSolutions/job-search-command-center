import { createDb, getDbPath } from './db/index.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3001;

const db = createDb();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${getDbPath()}`);
});
