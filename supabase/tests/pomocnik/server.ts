// Jeden Postgres 17 (embedded-postgres) na celý běh testů. Každý testovací soubor
// si v něm založí vlastní databázi (pomocnik/db.ts), takže soubory běží souběžně.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgPort: number;
  }
}

function volnyPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const adresa = s.address();
      const port = typeof adresa === 'object' && adresa ? adresa.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const port = await volnyPort();
  const adresar = fs.mkdtempSync(path.join(os.tmpdir(), 'subbau-social-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: adresar,
    port,
    user: 'postgres',
    password: 'pwd',
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'timezone=UTC', '-c', 'max_connections=200', '-c', 'fsync=off'],
    onLog: () => {},
    onError: (e) => console.error('[postgres]', e),
  });
  await pg.initialise();
  await pg.start();
  // Role Supabase jsou společné celému serveru → založit jednou předem (jinak závod souborů).
  const c = pg.getPgClient('postgres', '127.0.0.1');
  await c.connect();
  const stuby = fs.readFileSync(new URL('../stubs.sql', import.meta.url), 'utf8');
  await c.query(stuby.slice(0, stuby.indexOf('end $$;') + 'end $$;'.length));
  await c.end();
  project.provide('pgPort', port);
  return async () => {
    await pg.stop();
    fs.rmSync(adresar, { recursive: true, force: true });
  };
}
