import { eq, type SQL, type Column } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/index.js';
import { createId, nowIso } from './id.js';

type Table = SQLiteTableWithColumns<any>;

interface CrudRouterOptions<TInsert extends Record<string, unknown>> {
  db: Db;
  table: Table;
  idCol: Column;
  buildCreate: (body: Record<string, unknown>, id: string, timestamp: string) => TInsert;
  buildUpdate: (
    body: Record<string, unknown>,
    timestamp: string,
  ) => Partial<TInsert>;
}

function byId(idCol: Column, id: string): SQL {
  return eq(idCol, id);
}

export function createCrudRouter<TInsert extends Record<string, unknown>>({
  db,
  table,
  idCol,
  buildCreate,
  buildUpdate,
}: CrudRouterOptions<TInsert>): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const rows = db.select().from(table).all();
    res.json(rows);
  });

  router.get('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const rows = db
      .select()
      .from(table)
      .where(byId(idCol, id))
      .all();
    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(rows[0]);
  });

  router.post('/', (req: Request, res: Response) => {
    const timestamp = nowIso();
    const id = createId();
    const row = buildCreate(req.body, id, timestamp);
    db.insert(table).values(row).run();
    const created = db
      .select()
      .from(table)
      .where(byId(idCol, id))
      .all();
    res.status(201).json(created[0]);
  });

  router.put('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = db
      .select()
      .from(table)
      .where(byId(idCol, id))
      .all();
    if (existing.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const timestamp = nowIso();
    const updates = buildUpdate(req.body, timestamp);
    db.update(table).set(updates).where(byId(idCol, id)).run();
    const updated = db
      .select()
      .from(table)
      .where(byId(idCol, id))
      .all();
    res.json(updated[0]);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = db
      .select()
      .from(table)
      .where(byId(idCol, id))
      .all();
    if (existing.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    db.delete(table).where(byId(idCol, id)).run();
    res.status(204).send();
  });

  return router;
}
