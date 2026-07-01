import { and, eq, type SQL, type Column } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/index.js';
import { createId, nowIso } from './id.js';

type Table = SQLiteTableWithColumns<any>;

interface CrudRouterOptions<TInsert extends Record<string, unknown>> {
  db: Db;
  table: Table;
  idCol: Column;
  userIdCol: Column;
  buildCreate: (body: Record<string, unknown>, id: string, timestamp: string) => TInsert;
  buildUpdate: (
    body: Record<string, unknown>,
    timestamp: string,
  ) => Partial<TInsert>;
}

function byIdAndUser(
  idCol: Column,
  userIdCol: Column,
  id: string,
  userId: string,
): SQL {
  return and(eq(idCol, id), eq(userIdCol, userId))!;
}

export function createCrudRouter<TInsert extends Record<string, unknown>>({
  db,
  table,
  idCol,
  userIdCol,
  buildCreate,
  buildUpdate,
}: CrudRouterOptions<TInsert>): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    const rows = db
      .select()
      .from(table)
      .where(eq(userIdCol, userId))
      .all();
    res.json(rows);
  });

  router.get('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const rows = db
      .select()
      .from(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .all();
    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(rows[0]);
  });

  router.post('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    const timestamp = nowIso();
    const id = createId();
    const row = {
      ...buildCreate(req.body, id, timestamp),
      userId,
    };
    db.insert(table).values(row).run();
    const created = db
      .select()
      .from(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .all();
    res.status(201).json(created[0]);
  });

  router.put('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const existing = db
      .select()
      .from(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .all();
    if (existing.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const timestamp = nowIso();
    const updates = buildUpdate(req.body, timestamp);
    db.update(table)
      .set(updates)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .run();
    const updated = db
      .select()
      .from(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .all();
    res.json(updated[0]);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const existing = db
      .select()
      .from(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .all();
    if (existing.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    db.delete(table)
      .where(byIdAndUser(idCol, userIdCol, id, userId))
      .run();
    res.status(204).send();
  });

  return router;
}
