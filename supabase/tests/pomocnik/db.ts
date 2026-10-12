// Založení čisté databáze (ICU cs-CZ jako Supabase), stuby Supabase a VŠECHNY migrace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { inject } from 'vitest';

const TESTY = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRACE = path.resolve(TESTY, '../migrations');

export type Kdo =
  | { role: 'anon' }
  | { role: 'authenticated'; uid: string }
  | { role: 'service_role' };

export function konfigurace(database: string): pg.ClientConfig {
  return { host: '127.0.0.1', port: inject('pgPort'), user: 'postgres', password: 'pwd', database };
}

export function seznamMigraci(): string[] {
  const cislo = (f: string) => Number(/^(\d+)/.exec(f)![1]);
  return fs
    .readdirSync(MIGRACE)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => cislo(a) - cislo(b) || a.localeCompare(b));
}

let poradi = 0;

/** Nová databáze se stuby a migracemi. Vrací připojení jako postgres (vlastník). */
export async function novaDatabaze(predpona: string): Promise<{ nazev: string; root: pg.Client; pripoj: () => Promise<pg.Client> }> {
  const nazev = `${predpona}_${process.pid}_${++poradi}_${Date.now() % 100000}`.toLowerCase();
  const sprava = new pg.Client(konfigurace('postgres'));
  await sprava.connect();
  await sprava.query(`create database ${nazev} template template0 encoding 'UTF8' locale_provider icu icu_locale 'cs-CZ'`);
  await sprava.end();

  const root = new pg.Client(konfigurace(nazev));
  await root.connect();
  await root.query(fs.readFileSync(path.join(TESTY, 'stubs.sql'), 'utf8'));
  for (const f of seznamMigraci()) {
    try {
      await root.query(fs.readFileSync(path.join(MIGRACE, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migrace ${f} spadla: ${(e as Error).message}`);
    }
  }
  const pripoj = async () => {
    const c = new pg.Client(konfigurace(nazev));
    await c.connect();
    return c;
  };
  return { nazev, root, pripoj };
}

/** Spustí fn v transakci pod danou rolí a s danými JWT claims (jako PostgREST). */
export async function jako<T>(c: pg.Client, kdo: Kdo, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    await c.query(`set local role ${kdo.role}`);
    const claims = kdo.role === 'authenticated' ? { sub: kdo.uid, role: 'authenticated' } : { role: kdo.role };
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const vysledek = await fn();
    await c.query('commit');
    return vysledek;
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

/** Uživatel v auth.users; s app=true i v app_users. */
export async function zalozUzivatele(root: pg.Client, app: boolean): Promise<string> {
  const r = await root.query(`insert into auth.users (email) values ('u' || gen_random_uuid() || '@example.cz') returning id`);
  const id = r.rows[0].id as string;
  if (app) await root.query(`insert into public.app_users (id, email, name) values ($1, 'majitel@example.cz', 'Majitel')`, [id]);
  return id;
}

export async function zalozUcet(root: pg.Client, platform: 'facebook' | 'instagram' | 'tiktok' = 'facebook'): Promise<string> {
  const r = await root.query(
    `insert into public.social_accounts (platform, external_id, name) values ($1, 'ext_' || gen_random_uuid(), 'Účet') returning id`,
    [platform],
  );
  return r.rows[0].id as string;
}

export async function zalozPost(root: pg.Client, ucet: string, pole: Record<string, unknown> = {}): Promise<string> {
  const sloupce = ['account_id', ...Object.keys(pole)];
  const hodnoty = [ucet, ...Object.values(pole)];
  const r = await root.query(
    `insert into public.posts (${sloupce.join(',')}) values (${sloupce.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
    hodnoty,
  );
  return r.rows[0].id as string;
}

export async function zalozMedium(root: pg.Client, pole: Record<string, unknown> = {}): Promise<string> {
  const r = await root.query(
    `insert into public.media_assets (storage_path, kind, mime_type, fingerprint)
     values ($1, $2, $3, 'abc') returning id`,
    [pole.storage_path ?? `soubory/${Math.random()}.jpg`, pole.kind ?? 'image', pole.mime_type ?? 'image/jpeg'],
  );
  return r.rows[0].id as string;
}

/** Očekávané selhání; vrací text chyby, aby test mohl ověřit, že padá ze správného důvodu. */
export async function chyba(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('Očekávala se chyba, ale příkaz prošel.');
}
