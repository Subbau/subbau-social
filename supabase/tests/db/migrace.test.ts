import { afterAll, describe, expect, it } from 'vitest';
import { novaDatabaze, seznamMigraci } from '../pomocnik/db';

describe('migrace', () => {
  let konec: () => Promise<void> = async () => {};
  afterAll(() => konec());

  it('projdou na čisté databázi a založí politiky', async () => {
    const db = await novaDatabaze('migrace');
    konec = () => db.root.end();
    expect(seznamMigraci().length).toBeGreaterThanOrEqual(7);
    const r = await db.root.query(`select count(*)::int n from pg_policies where schemaname in ('public','storage')`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(14);
    const kolace = await db.root.query(`select datlocprovider, datlocale from pg_database where datname = current_database()`);
    expect(kolace.rows[0]).toEqual({ datlocprovider: 'i', datlocale: 'cs-CZ' });
  });
});
