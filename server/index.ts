import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { createDb, getDbPath } from './db/index.js';
import {
  applicationsRouter,
  contactsRouter,
  communicationsRouter,
  followUpTasksRouter,
  interviewsRouter,
  documentsRouter,
} from './routes/index.js';

const PORT = Number(process.env.PORT) || 3001;

const db = createDb();
const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbPath: getDbPath() });
});

app.use('/api/applications', applicationsRouter(db));
app.use('/api/contacts', contactsRouter(db));
app.use('/api/communications', communicationsRouter(db));
app.use('/api/follow-up-tasks', followUpTasksRouter(db));
app.use('/api/interviews', interviewsRouter(db));
app.use('/api/documents', documentsRouter(db));

const distPath = path.join(process.cwd(), 'dist');
const APP_BASE = '/smartapp-ui-kit';

app.use(APP_BASE, express.static(distPath));
app.get('/', (_req, res) => {
  res.redirect(APP_BASE);
});
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.method !== 'GET') {
    next();
    return;
  }
  if (!req.path.startsWith(APP_BASE)) {
    next();
    return;
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${getDbPath()}`);
});
