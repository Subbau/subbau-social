// Unique omezení ze SPEC.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chyba, novaDatabaze, zalozMedium, zalozPost, zalozUcet } from '../pomocnik/db';

let root: pg.Client;
let ucet: string;
const ZITRA = new Date(Date.now() + 86_400_000).toISOString();

beforeAll(async () => {
  ({ root } = await novaDatabaze('unikaty'));
  ucet = await zalozUcet(root);
});
afterAll(() => root.end());

describe('unique', () => {
  it('social_accounts (platform, external_id); jiná platforma smí stejné id', async () => {
    await root.query(`insert into public.social_accounts (platform, external_id, name) values ('facebook', '123', 'A')`);
    expect(await chyba(root.query(`insert into public.social_accounts (platform, external_id, name) values ('facebook', '123', 'B')`)))
      .toMatch(/social_accounts_platform_external_id_key/);
    await root.query(`insert into public.social_accounts (platform, external_id, name) values ('instagram', '123', 'C')`);
  });

  it('posts (account_id, external_id) jen pro vyplněné external_id', async () => {
    await zalozPost(root, ucet);
    await zalozPost(root, ucet);
    await zalozPost(root, ucet, { external_id: 'x1' });
    expect(await chyba(zalozPost(root, ucet, { external_id: 'x1' }))).toMatch(/posts_account_external_id_key/);
    const jiny = await zalozUcet(root);
    await zalozPost(root, jiny, { external_id: 'x1' });
  });

  it('posts (series_id, scheduled_at) jen u sérií', async () => {
    const s = await root.query(`insert into public.post_series (account_id, freq, weekdays, time_of_day, starts_on)
                                values ($1, 'weekly', '{1}', '18:00', current_date) returning id`, [ucet]);
    await zalozPost(root, ucet, { series_id: s.rows[0].id, status: 'scheduled', scheduled_at: ZITRA });
    expect(await chyba(zalozPost(root, ucet, { series_id: s.rows[0].id, status: 'scheduled', scheduled_at: ZITRA })))
      .toMatch(/posts_series_scheduled_at_key/);
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: ZITRA });
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: ZITRA });
  });

  it('account_time_slots (account_id, weekday, time_of_day) a rozsah dne', async () => {
    await root.query(`insert into public.account_time_slots (account_id, weekday, time_of_day) values ($1, 3, '12:00')`, [ucet]);
    expect(await chyba(root.query(`insert into public.account_time_slots (account_id, weekday, time_of_day) values ($1, 3, '12:00')`, [ucet])))
      .toMatch(/account_time_slots_account_id_weekday_time_of_day_key/);
    expect(await chyba(root.query(`insert into public.account_time_slots (account_id, weekday, time_of_day) values ($1, 8, '12:00')`, [ucet])))
      .toMatch(/check/);
  });

  it('post_media (post_id, position) a media_assets.storage_path; médium v příspěvku nejde smazat', async () => {
    const p = await zalozPost(root, ucet);
    const m = await zalozMedium(root, { storage_path: 'jedine.jpg' });
    await root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [p, m]);
    expect(await chyba(root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [p, m])))
      .toMatch(/post_media_pkey/);
    expect(await chyba(zalozMedium(root, { storage_path: 'jedine.jpg' }))).toMatch(/media_assets_storage_path_key/);
    expect(await chyba(root.query(`delete from public.media_assets where id = $1`, [m]))).toMatch(/foreign key/);
  });

  it('secure.credentials (provider, label) i s prázdným popiskem', async () => {
    await root.query(`insert into secure.credentials (provider, label, vault_secret_id) values ('meta', null, gen_random_uuid())`);
    expect(await chyba(root.query(`insert into secure.credentials (provider, label, vault_secret_id) values ('meta', null, gen_random_uuid())`)))
      .toMatch(/credentials_provider_label_key/);
  });
});
