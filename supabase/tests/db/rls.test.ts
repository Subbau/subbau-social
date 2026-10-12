// RLS a granty: anon nic, přihlášený mimo app_users nic, app_user CRUD,
// tajemství a publikační funkce jen service_role, bucket media jen app_user.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chyba, jako, novaDatabaze, zalozMedium, zalozPost, zalozUcet, zalozUzivatele } from '../pomocnik/db';

const TABULKY = [
  'app_users', 'social_accounts', 'account_time_slots', 'media_assets', 'text_snippets',
  'posts', 'post_media', 'post_series', 'publish_attempts', 'audit_log',
];

let root: pg.Client;
let appUser: string;
let cizi: string;
let ucet: string;
let post: string;

beforeAll(async () => {
  ({ root } = await novaDatabaze('rls'));
  appUser = await zalozUzivatele(root, true);
  cizi = await zalozUzivatele(root, false);
  ucet = await zalozUcet(root);
  post = await zalozPost(root, ucet, { caption: 'Ahoj' });
  const medium = await zalozMedium(root);
  await root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [post, medium]);
  await root.query(`insert into public.account_time_slots (account_id, weekday, time_of_day) values ($1, 1, '18:00')`, [ucet]);
  await root.query(`insert into public.text_snippets (title, body) values ('Podpis', 'SubBau')`);
  await root.query(`insert into public.post_series (account_id, template_post_id, freq, weekdays, time_of_day, starts_on)
                    values ($1, $2, 'weekly', '{1}', '18:00', current_date)`, [ucet, post]);
  await root.query(`insert into public.publish_attempts (post_id, outcome) values ($1, 'success')`, [post]);
});
afterAll(() => root.end());

describe('anon', () => {
  it.each(TABULKY)('nesmí číst %s', async (t) => {
    const e = await chyba(jako(root, { role: 'anon' }, () => root.query(`select * from public.${t}`)));
    expect(e).toMatch(/permission denied/);
  });

  it('nesmí vkládat příspěvky ani volat is_app_user / generate', async () => {
    expect(await chyba(jako(root, { role: 'anon' }, () =>
      root.query(`insert into public.posts (account_id) values ($1)`, [ucet])))).toMatch(/permission denied/);
    expect(await chyba(jako(root, { role: 'anon' }, () =>
      root.query(`select public.is_app_user()`)))).toMatch(/permission denied/);
    expect(await chyba(jako(root, { role: 'anon' }, () =>
      root.query(`select public.generate_series_occurrences(gen_random_uuid())`)))).toMatch(/permission denied/);
  });
});

describe('přihlášený, ale ne v app_users', () => {
  const kdo = () => ({ role: 'authenticated' as const, uid: cizi });

  it.each(TABULKY)('nevidí nic v %s', async (t) => {
    const r = await jako(root, kdo(), () => root.query(`select * from public.${t}`));
    expect(r.rowCount).toBe(0);
  });

  it('nesmí vložit příspěvek ani text', async () => {
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.posts (account_id) values ($1)`, [ucet])))).toMatch(/row-level security/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.text_snippets (title, body) values ('x', 'y')`)))).toMatch(/row-level security/);
  });

  it('úprava a mazání nic nezmění', async () => {
    const u = await jako(root, kdo(), () => root.query(`update public.posts set caption = 'hack' where id = $1`, [post]));
    const d = await jako(root, kdo(), () => root.query(`delete from public.text_snippets`));
    expect(u.rowCount).toBe(0);
    expect(d.rowCount).toBe(0);
    const r = await root.query(`select caption from public.posts where id = $1`, [post]);
    expect(r.rows[0].caption).toBe('Ahoj');
  });

  it('nesmí se sám zapsat do app_users', async () => {
    const e = await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.app_users (id) values ($1)`, [cizi])));
    expect(e).toMatch(/permission denied/);
  });

  it('is_app_user() vrací false', async () => {
    const r = await jako(root, kdo(), () => root.query(`select public.is_app_user() as ok`));
    expect(r.rows[0].ok).toBe(false);
  });
});

describe('app_user', () => {
  const kdo = () => ({ role: 'authenticated' as const, uid: appUser });

  it.each(TABULKY)('vidí %s', async (t) => {
    const r = await jako(root, kdo(), () => root.query(`select * from public.${t}`));
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it('CRUD příspěvku, textu, slotu, média a série', async () => {
    await jako(root, kdo(), async () => {
      const p = await root.query(`insert into public.posts (account_id, caption) values ($1, 'nový') returning id, created_by`, [ucet]);
      expect(p.rows[0].created_by).toBe(appUser);
      const id = p.rows[0].id;
      expect((await root.query(`update public.posts set caption = 'upravený' where id = $1`, [id])).rowCount).toBe(1);
      const m = await root.query(`insert into public.media_assets (storage_path, kind, fingerprint) values ('a/b.jpg', 'image', 'f') returning id`);
      await root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [id, m.rows[0].id]);
      await root.query(`delete from public.post_media where post_id = $1`, [id]);
      expect((await root.query(`delete from public.posts where id = $1`, [id])).rowCount).toBe(1);
      const t = await root.query(`insert into public.text_snippets (title, body) values ('T', 'B') returning id`);
      expect((await root.query(`update public.text_snippets set body = 'C' where id = $1`, [t.rows[0].id])).rowCount).toBe(1);
      expect((await root.query(`delete from public.text_snippets where id = $1`, [t.rows[0].id])).rowCount).toBe(1);
      await root.query(`insert into public.account_time_slots (account_id, weekday, time_of_day) values ($1, 2, '09:00')`, [ucet]);
      const s = await root.query(`insert into public.post_series (account_id, freq, month_day, time_of_day, starts_on)
                                  values ($1, 'monthly', 31, '10:00', current_date) returning id`, [ucet]);
      expect((await root.query(`delete from public.post_series where id = $1`, [s.rows[0].id])).rowCount).toBe(1);
    });
  });

  it('u účtu smí měnit barvu, pásmo a zapnutí, nic jiného; nový účet nezaloží', async () => {
    const r = await jako(root, kdo(), () =>
      root.query(`update public.social_accounts set color = '#ff0000', is_active = false, timezone = 'Europe/Berlin' where id = $1`, [ucet]));
    expect(r.rowCount).toBe(1);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`update public.social_accounts set name = 'Jiné' where id = $1`, [ucet])))).toMatch(/jen barvu/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`update public.social_accounts set connection_status = 'connected' where id = $1`, [ucet])))).toMatch(/jen barvu/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.social_accounts (platform, external_id, name) values ('facebook', 'x', 'y')`)))).toMatch(/permission denied/);
  });

  it('publish_attempts a audit_log jen čte', async () => {
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.publish_attempts (post_id) values ($1)`, [post])))).toMatch(/permission denied/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`update public.publish_attempts set outcome = 'unknown'`)))).toMatch(/permission denied/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`insert into public.audit_log (action, entity) values ('x', 'y')`)))).toMatch(/permission denied/);
    expect(await chyba(jako(root, kdo(), () =>
      root.query(`delete from public.audit_log`)))).toMatch(/permission denied/);
  });
});

describe('tajemství a publikační funkce', () => {
  const kdo = () => ({ role: 'authenticated' as const, uid: appUser });
  const JEN_SERVICE = [
    `select public.publisher_get_token(gen_random_uuid())`,
    `select public.admin_set_credential('meta', 'x', 'tajne')`,
    `select public.publisher_meta_credential()`,
    `select * from public.claim_due_posts(5)`,
    `select public.release_stale_posts()`,
    `select public.publisher_save_progress(gen_random_uuid(), gen_random_uuid(), 'x', '{}')`,
    `select public.publisher_finish(gen_random_uuid(), gen_random_uuid(), '{"status":"failed"}')`,
    `select public.extend_all_series()`,
    `select public.publisher_return_claim(gen_random_uuid(), gen_random_uuid())`,
  ];

  it.each(JEN_SERVICE)('app_user nesmí: %s', async (sql) => {
    expect(await chyba(jako(root, kdo(), () => root.query(sql)))).toMatch(/permission denied/);
  });

  it.each(JEN_SERVICE)('anon nesmí: %s', async (sql) => {
    expect(await chyba(jako(root, { role: 'anon' }, () => root.query(sql)))).toMatch(/permission denied/);
  });

  it('secure: authenticated ani anon nemají USAGE na schéma ani právo na tabulku', async () => {
    const r = await root.query(`select
        has_schema_privilege('authenticated', 'secure', 'USAGE') a,
        has_schema_privilege('anon', 'secure', 'USAGE') b,
        has_table_privilege('authenticated', 'secure.credentials', 'SELECT') c,
        has_table_privilege('service_role', 'secure.credentials', 'SELECT') d`);
    expect(r.rows[0]).toEqual({ a: false, b: false, c: false, d: false });
  });

  it('app_user nečte secure ani vault', async () => {
    expect(await chyba(jako(root, kdo(), () => root.query(`select * from secure.credentials`)))).toMatch(/permission denied/);
    expect(await chyba(jako(root, kdo(), () => root.query(`select * from vault.decrypted_secrets`)))).toMatch(/permission denied/);
  });

  it('service_role nečte secure přímo, ale přes funkce uloží a přečte klíč', async () => {
    expect(await chyba(jako(root, { role: 'service_role' }, () =>
      root.query(`select * from secure.credentials`)))).toMatch(/permission denied/);
    const id = await jako(root, { role: 'service_role' }, async () => {
      const a = await root.query(`select public.admin_set_credential('meta', 'Systémový uživatel', '  token-1 ') as id`);
      const b = await root.query(`select public.admin_set_credential('meta', 'Systémový uživatel', 'token-2') as id`);
      expect(b.rows[0].id).toBe(a.rows[0].id);
      const t = await root.query(`select public.publisher_get_token($1) as t`, [a.rows[0].id]);
      expect(t.rows[0].t).toBe('token-2');
      const m = await root.query(`select public.publisher_meta_credential() as id`);
      expect(m.rows[0].id).toBe(a.rows[0].id);
      return a.rows[0].id as string;
    });
    const v = await root.query(`select count(*)::int n from vault.secrets`);
    expect(v.rows[0].n).toBe(1);
    const c = await root.query(`select vault_secret_id from secure.credentials where id = $1`, [id]);
    expect(c.rows[0].vault_secret_id).toBeTruthy();
    // token neleží v secure.credentials
    const sloupce = await root.query(`select string_agg(column_name, ',') s from information_schema.columns where table_schema = 'secure'`);
    expect(sloupce.rows[0].s).not.toMatch(/token|secret,|secret$/);
  });

  it('prázdný klíč se neuloží', async () => {
    expect(await chyba(jako(root, { role: 'service_role' }, () =>
      root.query(`select public.admin_set_credential('meta', 'x', '   ')`)))).toMatch(/prázdný/);
  });
});

describe('storage bucket media', () => {
  beforeAll(async () => {
    await root.query(`insert into storage.buckets (id, name, public) values ('media', 'media', false), ('jiny', 'jiny', false)`);
    await root.query(`insert into storage.objects (bucket_id, name) values ('media', 'existujici.jpg')`);
  });

  it('app_user nahraje, vidí a smaže soubor v media', async () => {
    await jako(root, { role: 'authenticated', uid: appUser }, async () => {
      await root.query(`insert into storage.objects (bucket_id, name) values ('media', 'novy.jpg')`);
      const r = await root.query(`select name from storage.objects where bucket_id = 'media' order by name`);
      expect(r.rows.map((x) => x.name)).toEqual(['existujici.jpg', 'novy.jpg']);
      expect((await root.query(`delete from storage.objects where name = 'novy.jpg'`)).rowCount).toBe(1);
    });
  });

  it('app_user nesmí do jiného bucketu', async () => {
    expect(await chyba(jako(root, { role: 'authenticated', uid: appUser }, () =>
      root.query(`insert into storage.objects (bucket_id, name) values ('jiny', 'x.jpg')`)))).toMatch(/row-level security/);
  });

  it('nezapsaný přihlášený a anon nic', async () => {
    expect(await chyba(jako(root, { role: 'authenticated', uid: cizi }, () =>
      root.query(`insert into storage.objects (bucket_id, name) values ('media', 'x.jpg')`)))).toMatch(/row-level security/);
    expect(await chyba(jako(root, { role: 'anon' }, () =>
      root.query(`insert into storage.objects (bucket_id, name) values ('media', 'y.jpg')`)))).toMatch(/row-level security/);
    const r1 = await jako(root, { role: 'authenticated', uid: cizi }, () => root.query(`select * from storage.objects`));
    const r2 = await jako(root, { role: 'anon' }, () => root.query(`select * from storage.objects`));
    expect(r1.rowCount).toBe(0);
    expect(r2.rowCount).toBe(0);
  });
});
