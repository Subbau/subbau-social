// Soubory supabase/setup/*.sql: zábrany proti nevyplněným <<DOPLNIT …>> a výsledek po vyplnění.
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRACE, chyba, novaDatabaze, zalozUzivatele } from '../pomocnik/db';

const SETUP = path.resolve(MIGRACE, '../setup');
const cti = (f: string) => fs.readFileSync(path.join(SETUP, f), 'utf8');
const CRON_SECRET = 'a'.repeat(20) + 'b'.repeat(20);

let root: pg.Client;
beforeAll(async () => {
  ({ root } = await novaDatabaze('setup'));
  await root.query(fs.readFileSync(path.resolve(MIGRACE, '../tests/stubs_cron.sql'), 'utf8'));
});
afterAll(() => root.end());

describe('setup', () => {
  it('01 bucket media: privátní, 50 MB (Free plán), povolené typy; jde pustit znovu', async () => {
    const ocekavane = {
      public: false,
      file_size_limit: '52428800',
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
    };
    await root.query(cti('01_bucket_media.sql'));
    expect((await root.query(`select * from storage.buckets where id = 'media'`)).rows[0]).toMatchObject(ocekavane);
    await root.query(`update storage.buckets set public = true, file_size_limit = 10 where id = 'media'`);
    await root.query(cti('01_bucket_media.sql'));
    // návod k přechodu na Pro obsahuje funkční příkaz pro 1 GB
    expect(cti('01_bucket_media.sql')).toContain("update storage.buckets set file_size_limit = 1073741824 where id = 'media';");
    const r = await root.query(`select * from storage.buckets where id = 'media'`);
    expect(r.rows[0]).toMatchObject({
      public: false,
      file_size_limit: '52428800',
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
    });
    // příkaz z návodu (přechod na Pro) opravdu zvedne limit na 1 GB
    const prikaz = /^--\s+(update storage\.buckets set file_size_limit = \d+ where id = 'media';)$/m.exec(cti('01_bucket_media.sql'))![1];
    await root.query(prikaz);
    expect((await root.query(`select file_size_limit from storage.buckets where id = 'media'`)).rows[0].file_size_limit).toBe('1073741824');
  });

  it('02 první uživatel: bez vyplnění chyba, s vyplněním zápis, neznámý e-mail chyba', async () => {
    expect(await chyba(root.query(cti('02_prvni_uzivatel.sql')))).toMatch(/doplňte e-mail/);
    const id = await zalozUzivatele(root, false);
    const email = (await root.query(`select email from auth.users where id = $1`, [id])).rows[0].email;
    await root.query(cti('02_prvni_uzivatel.sql').replace('<<DOPLNIT E-MAIL MAJITELE>>', email.toUpperCase()).replace('<<DOPLNIT JMÉNO>>', 'Patrik'));
    expect((await root.query(`select name, role from public.app_users where id = $1`, [id])).rows[0]).toEqual({ name: 'Patrik', role: 'admin' });
    expect(await chyba(root.query(cti('02_prvni_uzivatel.sql').replace('<<DOPLNIT E-MAIL MAJITELE>>', 'nikdo@x.cz').replace('<<DOPLNIT JMÉNO>>', 'X'))))
      .toMatch(/není/);
  });

  it('03 CRON_SECRET: bez vyplnění a krátký chyba; uloží se do Vaultu, podruhé přepíše', async () => {
    expect(await chyba(root.query(cti('03_cron_secret.sql')))).toMatch(/Doplňte CRON_SECRET/);
    expect(await chyba(root.query(cti('03_cron_secret.sql').replace('<<DOPLNIT CRON_SECRET (min. 32 znaků)>>', 'kratke')))).toMatch(/Doplňte CRON_SECRET/);
    await root.query(cti('03_cron_secret.sql').replace('<<DOPLNIT CRON_SECRET (min. 32 znaků)>>', 'x'.repeat(40)));
    await root.query(cti('03_cron_secret.sql').replace('<<DOPLNIT CRON_SECRET (min. 32 znaků)>>', CRON_SECRET));
    const r = await root.query(`select decrypted_secret from vault.decrypted_secrets where name = 'subbau_cron_secret'`);
    expect(r.rows).toEqual([{ decrypted_secret: CRON_SECRET }]);
  });

  it('04 cron: bez PROJECT_REF chyba; úlohy bez secretu v textu; publisher dostane Bearer z Vaultu', async () => {
    // pg_cron a pg_net v čistém Postgresu nejsou → řádky create extension nahrazuje stubs_cron.sql
    const bezRozsireni = cti('04_cron.sql').replace(/^create extension .*$/gm, '');
    expect(await chyba(root.query(bezRozsireni))).toMatch(/Doplňte PROJECT_REF/);
    await root.query(bezRozsireni.replaceAll('<<DOPLNIT PROJECT_REF>>', 'abcdefgh'));
    await root.query(bezRozsireni.replaceAll('<<DOPLNIT PROJECT_REF>>', 'abcdefgh'));
    const ulohy = (await root.query(`select jobname, schedule, command from cron.job order by jobname collate "C"`)).rows;
    expect(ulohy.map((u) => [u.jobname, u.schedule])).toEqual([
      ['subbau-check-accounts', '30 2 * * *'],
      ['subbau-cron-uklid', '0 3 * * *'],
      ['subbau-extend-series', '15 2 * * *'],
      ['subbau-publisher', '* * * * *'],
    ]);
    for (const u of ulohy) expect(u.command).not.toContain(CRON_SECRET);

    for (const u of ulohy) await root.query(u.command);
    const pozadavky = (await root.query(`select url, headers, timeout_milliseconds from net.pozadavky order by id`)).rows;
    expect(pozadavky.map((p) => p.url)).toEqual([
      'https://abcdefgh.supabase.co/functions/v1/check-accounts',
      'https://abcdefgh.supabase.co/functions/v1/publisher',
    ]);
    for (const p of pozadavky) expect(p.headers.Authorization).toBe(`Bearer ${CRON_SECRET}`);
  });

  it('05 klíč Meta: bez vyplnění chyba; uloží se jen do Vaultu, podruhé přepíše', async () => {
    expect(await chyba(root.query(cti('05_meta_klic.sql')))).toMatch(/Doplňte token/);
    await root.query(cti('05_meta_klic.sql').replace('<<DOPLNIT TOKEN SYSTÉMOVÉHO UŽIVATELE META>>', 'EAAB-prvni'));
    await root.query(cti('05_meta_klic.sql').replace('<<DOPLNIT TOKEN SYSTÉMOVÉHO UŽIVATELE META>>', 'EAAB-druhy'));
    const c = (await root.query(`select id from secure.credentials`)).rows;
    expect(c).toHaveLength(1);
    expect((await root.query(`select public.publisher_get_token($1) t`, [c[0].id])).rows[0].t).toBe('EAAB-druhy');
  });
});
