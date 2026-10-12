// meta-sync (převod stránek na účty) a check-accounts (kontrola účtu, limit IG).
import { describe, expect, it } from 'vitest';
import { nactiStranky, overKlic, prevedNaUcty, uctyMimoKlic, zkontrolujUcet } from '../../functions/_shared/ucty';
import { chybaGraph, mockMeta } from '../pomocnik/meta';

const TED = new Date('2026-10-12T03:00:00.000Z');

describe('meta-sync', () => {
  it('stránky → FB účty a propojené IG s linked_page_external_id', async () => {
    const meta = mockMeta().na('GET', '/me/accounts', { telo: { data: [
      { id: 'P1', name: 'SubBau', picture: { data: { url: 'https://cdn/p1.jpg' } },
        instagram_business_account: { id: 'IG1', username: 'subbau.cz', profile_picture_url: 'https://cdn/ig1.jpg' } },
      { id: 'P2', name: 'SubBau Nábor' },
    ] } });
    const stranky = await nactiStranky(meta.graph, 'KLIC');
    expect(meta.volani[0].params).toMatchObject({
      fields: 'id,name,picture{url},instagram_business_account{id,username,profile_picture_url}',
    });
    expect(meta.volani[0].token).toBe('KLIC');
    const radky = prevedNaUcty(stranky, 'cred-1', TED);
    expect(radky).toEqual([
      expect.objectContaining({ platform: 'facebook', external_id: 'P1', name: 'SubBau', avatar_url: 'https://cdn/p1.jpg', linked_page_external_id: null, connection_status: 'connected', credential_id: 'cred-1' }),
      expect.objectContaining({ platform: 'instagram', external_id: 'IG1', name: 'subbau.cz', username: 'subbau.cz', avatar_url: 'https://cdn/ig1.jpg', linked_page_external_id: 'P1' }),
      expect.objectContaining({ platform: 'facebook', external_id: 'P2', avatar_url: null }),
    ]);
    for (const r of radky) {
      expect(r).not.toHaveProperty('color');
      expect(r).not.toHaveProperty('is_active');
      expect(r).not.toHaveProperty('timezone');
    }
  });

  it('stránkování přes kurzor after', async () => {
    const meta = mockMeta()
      .na('GET', '/me/accounts', { telo: { data: [{ id: 'P1', name: 'A' }], paging: { cursors: { after: 'K1' }, next: 'https://graph…' } } },
        { telo: { data: [{ id: 'P2', name: 'B' }], paging: { cursors: { after: 'K2' } } } });
    expect((await nactiStranky(meta.graph, 'KLIC')).map((s) => s.id)).toEqual(['P1', 'P2']);
    expect(meta.volani[1].params.after).toBe('K1');
    expect(meta.volani).toHaveLength(2);
  });

  it('dřív propojené účty, které klíč nevidí → k odpojení', () => {
    const nove = prevedNaUcty([{ id: 'P1', name: 'A' }], 'c', TED);
    expect(uctyMimoKlic([
      { id: 'a', platform: 'facebook', external_id: 'P1', connection_status: 'connected' },
      { id: 'b', platform: 'facebook', external_id: 'P9', connection_status: 'connected' },
      { id: 'c', platform: 'instagram', external_id: 'IG9', connection_status: 'not_connected' },
      { id: 'd', platform: 'tiktok', external_id: 'T1', connection_status: 'connected' },
    ], nove)).toEqual(['b']);
  });
});

describe('check-accounts', () => {
  it('FB: jméno a avatar, connected', async () => {
    const meta = mockMeta().na('GET', '/P1', { telo: { name: 'SubBau s.r.o.', picture: { data: { url: 'https://cdn/n.jpg' } } } });
    expect(await zkontrolujUcet(meta.graph, 'K', { id: 'a', platform: 'facebook', external_id: 'P1' }, TED)).toEqual({
      name: 'SubBau s.r.o.', avatar_url: 'https://cdn/n.jpg', connection_status: 'connected', last_checked_at: TED.toISOString(), last_check_error: null,
    });
  });

  it('IG: content_publishing_limit → quota', async () => {
    const meta = mockMeta()
      .na('GET', '/IG1', { telo: { username: 'subbau.cz', profile_picture_url: 'https://cdn/i.jpg' } })
      .na('GET', '/IG1/content_publishing_limit', { telo: { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] } });
    const z = await zkontrolujUcet(meta.graph, 'K', { id: 'b', platform: 'instagram', external_id: 'IG1' }, TED);
    expect(meta.volani[1].params.fields).toBe('quota_usage,config');
    expect(z).toMatchObject({
      name: 'subbau.cz', username: 'subbau.cz', connection_status: 'connected',
      quota: { ig_used: 3, ig_limit: 100, ig_window_seconds: 86400, checked_at: TED.toISOString() },
    });
  });

  it('190 → needs_reconnect; jiná chyba jen zapíše last_check_error', async () => {
    const a = mockMeta().na('GET', '/P1', chybaGraph(190));
    expect(await zkontrolujUcet(a.graph, 'K', { id: 'a', platform: 'facebook', external_id: 'P1' }, TED))
      .toMatchObject({ connection_status: 'needs_reconnect', last_check_error: expect.stringMatching(/Propojte účet znovu/) });
    const b = mockMeta().na('GET', '/P1', { status: 503, text: 'x' });
    const z = await zkontrolujUcet(b.graph, 'K', { id: 'a', platform: 'facebook', external_id: 'P1' }, TED);
    expect(z.connection_status).toBeUndefined();
    expect(z.last_check_error).toMatch(/dočasně nedostupná/);
  });

  it('ověření klíče', async () => {
    expect(await overKlic(mockMeta().na('GET', '/me', { telo: { id: '1' } }).graph, 'K')).toEqual({ ok: true });
    expect(await overKlic(mockMeta().na('GET', '/me', chybaGraph(190)).graph, 'K')).toMatchObject({ ok: false, token: true });
    expect(await overKlic(mockMeta().na('GET', '/me', 'sit').graph, 'K')).toMatchObject({ ok: false, token: false });
  });

  it('last_check_error neobsahuje token ani URL, i když ho tam runtime dá', async () => {
    const meta = mockMeta().na('GET', '/P1', 'sit-token');
    const z = await zkontrolujUcet(meta.graph, 'EAAB_TAJNY_KLIC_1234567890', { id: 'a', platform: 'facebook', external_id: 'P1' }, TED);
    expect(z.last_check_error).toMatch(/Nepodařilo se spojit/);
    expect(z.last_check_error).not.toContain('EAAB_TAJNY_KLIC_1234567890');
    expect(z.last_check_error).not.toContain('graph.facebook.com');
  });
});
