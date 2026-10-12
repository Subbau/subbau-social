// Mapování chyb Graph API a chování klienta Graph.
import { describe, expect, it } from 'vitest';
import { klasifikujChybu } from '../../functions/_shared/chyby';
import { GraphChyba, VYCHOZI_VERZE_GRAPH, ocistiText, potvrzeneId, verzeGraph, vytvorGraphKlienta } from '../../functions/_shared/graph';
import { chybaGraph, mockMeta } from '../pomocnik/meta';

/** Pošle požadavek přes klienta s mockem, který vrátí danou odpověď, a vrátí klasifikaci. */
async function klasifikuj(odpoved: Parameters<ReturnType<typeof mockMeta>['na']>[2], publikacni = false, overitelne = false) {
  const meta = mockMeta().na('POST', '/X/feed', odpoved);
  try {
    await meta.graph.post('/X/feed', { message: 'a' }, 'TAJNY_TOKEN_EAAB1234567890', { publikacni, overitelne });
  } catch (e) {
    return { k: klasifikujChybu(e), e: e as GraphChyba };
  }
  throw new Error('čekala se chyba');
}

describe('mapování chyb', () => {
  it.each([190, 102])('kód %i → token', async (code) => {
    expect((await klasifikuj(chybaGraph(code))).k).toMatchObject({ druh: 'token', kod: 'token_invalid' });
  });

  it('podkód 463 (vypršelá relace) → token', async () => {
    expect((await klasifikuj(chybaGraph(1, 463))).k.druh).toBe('token');
  });

  it.each([4, 17, 32, 613])('kód %i → retryable rate_limited', async (code) => {
    expect((await klasifikuj(chybaGraph(code, undefined, 400))).k).toMatchObject({ druh: 'retryable', kod: 'rate_limited' });
  });

  it.each([500, 502, 503, 504])('HTTP %i bez kódu → retryable', async (status) => {
    expect((await klasifikuj({ status, text: '<html>Bad gateway</html>' })).k).toMatchObject({ druh: 'retryable', kod: 'meta_unavailable', http: status });
  });

  it('HTTP 500 s kódem 2 → retryable', async () => {
    expect((await klasifikuj(chybaGraph(2, undefined, 500))).k.druh).toBe('retryable');
  });

  it.each([
    [100, 'invalid_parameter'],
    [200, 'permission_denied'],
    [368, 'blocked'],
    [506, 'duplicate_rejected'],
  ])('kód %i → fatal %s', async (code, kod) => {
    expect((await klasifikuj(chybaGraph(code))).k).toMatchObject({ druh: 'fatal', kod });
  });

  it('kód 9 / 2207042 → fatal ig_daily_limit', async () => {
    const { k } = await klasifikuj(chybaGraph(9, 2207042));
    expect(k).toMatchObject({ druh: 'fatal', kod: 'ig_daily_limit' });
    expect(k.zprava).toMatch(/100 příspěvků za 24 hodin/);
  });

  it('výpadek spojení u běžného kroku → retryable, po odeslání publikace → unknown', async () => {
    expect((await klasifikuj('sit', false)).k).toMatchObject({ druh: 'retryable', kod: 'network' });
    expect((await klasifikuj('sit', true)).k).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
  });

  it('neověřitelné zveřejnění (FB): HTTP ≥ 500, kód 1/2, is_transient → unknown', async () => {
    expect((await klasifikuj({ status: 503, text: 'x' }, true)).k).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
    expect((await klasifikuj({ status: 500, text: 'x' }, true)).k.druh).toBe('unknown');
    expect((await klasifikuj(chybaGraph(2, undefined, 400), true)).k.druh).toBe('unknown');
    expect((await klasifikuj(chybaGraph(1, undefined, 400), true)).k.druh).toBe('unknown');
    expect((await klasifikuj({ status: 400, telo: { error: { message: 'x', code: 999, is_transient: true } } }, true)).k.druh).toBe('unknown');
  });

  it('neověřitelné zveřejnění: rate limit, token a trvalé chyby se nemění', async () => {
    expect((await klasifikuj(chybaGraph(613), true)).k.druh).toBe('retryable');
    expect((await klasifikuj(chybaGraph(190), true)).k.druh).toBe('token');
    expect((await klasifikuj(chybaGraph(100), true)).k.druh).toBe('fatal');
  });

  it('ověřitelné zveřejnění (IG media_publish) a přípravné kroky: 5xx / kód 2 → retryable', async () => {
    expect((await klasifikuj({ status: 503, text: 'x' }, true, true)).k.druh).toBe('retryable');
    expect((await klasifikuj(chybaGraph(2, undefined, 500), true, true)).k.druh).toBe('retryable');
    expect((await klasifikuj({ status: 503, text: 'x' }, false)).k.druh).toBe('retryable');
    expect((await klasifikuj(chybaGraph(2, undefined, 500), false)).k.druh).toBe('retryable');
  });

  it('neznámý kód → fatal s původní zprávou', async () => {
    const { k } = await klasifikuj(chybaGraph(12345, undefined, 400, 'Něco divného'));
    expect(k).toMatchObject({ druh: 'fatal', kod: 'graph_error', puvodni: 'Něco divného' });
  });

  it('fbtrace_id, typ a podkód se zachovají; token se do zprávy nedostane', async () => {
    const { k, e } = await klasifikuj(chybaGraph(190, 460, 401, 'Session invalidated'));
    expect(k.graph).toEqual({ code: 190, subcode: 460, type: 'OAuthException', fbtrace_id: 'TRACE123' });
    expect(k.http).toBe(401);
    const sit = await klasifikuj('sit-token');
    const getMeta = mockMeta().na('GET', '/Y', 'sit-token').na('GET', '/Z', { status: 500, text: 'x' }).na('GET', '/W', 'sit');
    const getSit = await getMeta.graph.get('/Y', { fields: 'id' }, 'TAJNY_TOKEN_EAAB1234567890').catch((x: Error) => x);
    const get500 = await getMeta.graph.get('/Z', { fields: 'id' }, 'TAJNY_TOKEN_EAAB1234567890').catch((x: Error) => x);
    const getDeno = await getMeta.graph.get('/W', { fields: 'id' }, 'TAJNY_TOKEN_EAAB1234567890').catch((x: Error) => x);
    // token jde hlavičkou, v URL není
    expect(getMeta.volani.every((v) => v.token === 'TAJNY_TOKEN_EAAB1234567890' && !v.url.includes('TAJNY'))).toBe(true);
    for (const text of [e.message, k.zprava, sit.e.message, sit.k.zprava, JSON.stringify(sit.k),
      String(getSit), String(get500), String(getDeno), JSON.stringify(klasifikujChybu(getSit)),
      JSON.stringify(klasifikujChybu(get500)), JSON.stringify(klasifikujChybu(getDeno))]) {
      expect(text).not.toContain('TAJNY_TOKEN');
      expect(text).not.toContain('graph.facebook.com');
    }
    expect(String(getSit)).toMatch(/Spojení s Graph API selhalo/);
  });

  it('každá zpráva je česky a neprázdná', async () => {
    for (const code of [190, 4, 100, 200, 368, 506]) {
      const { k } = await klasifikuj(chybaGraph(code));
      expect(k.zprava.length).toBeGreaterThan(20);
      expect(k.zprava).toMatch(/[áčďéěíňóřšťúůýž]/i);
    }
  });

  it('ocistiText: URL, access_token, Bearer/OAuth token pryč; běžné zprávy Mety beze změny', () => {
    const deno = 'TypeError: error sending request for url (https://graph.facebook.com/v26.0/1?fields=id&access_token=EAABxyz): reset; Authorization: Bearer EAABxyzEAABxyzEAABxyz';
    const cisty = ocistiText(deno);
    expect(cisty).not.toContain('EAABxyz');
    expect(cisty).not.toContain('graph.facebook.com');
    expect(ocistiText('x access_token=ABC&y=1')).toBe('x access_token=***&y=1');
    expect(ocistiText('OAuth EAAB1234567890abcdef')).toBe('OAuth ***');
    expect(ocistiText('Invalid OAuth access token - Cannot parse access token')).toBe('Invalid OAuth access token - Cannot parse access token');
  });

  it('ocistiText: i JSON tvar a URL-kódované access_token', () => {
    const json = ocistiText('{"error":"x","access_token":"EAABtajny123","id":"1"}');
    expect(json).toBe('{"error":"x","access_token":"***","id":"1"}');
    const kod = ocistiText('body=fields%3Did%26access_token%3DEAABtajny123%26x%3D1');
    expect(kod).not.toContain('EAABtajny123');
    expect(kod).toContain('access_token%3D***');
  });

  it('HTTP 200 s prázdným / ne-JSON tělem: u zveřejnění unknown, jinak retryable (ne fatal)', async () => {
    expect((await klasifikuj({ status: 200, text: '' }, true)).k).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
    expect((await klasifikuj({ status: 200, text: '<html>ok</html>' }, true, true)).k).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
    expect((await klasifikuj({ status: 200, text: '' }, false)).k).toMatchObject({ druh: 'retryable', kod: 'meta_unavailable' });
  });

  it('potvrzeneId: chybějící id u zveřejnění = unknown, u přípravy retryable', () => {
    expect(potvrzeneId({ id: 'A1' }, 'id', true)).toBe('A1');
    expect(potvrzeneId({ id: 12 }, 'id', true)).toBe('12');
    const bez = (() => { try { potvrzeneId({ success: true }, 'id', true); } catch (e) { return e; } return null; })();
    expect(klasifikujChybu(bez)).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
    const bezPriprava = (() => { try { potvrzeneId(null, 'id', false); } catch (e) { return e; } return null; })();
    expect(klasifikujChybu(bezPriprava)).toMatchObject({ druh: 'retryable' });
  });

  it('chyba mimo Graph se taky čistí (např. pád s URL v textu)', () => {
    const k = klasifikujChybu(new Error('selhalo https://x.cz/a?access_token=EAABtajne'), false);
    expect(k.puvodni).not.toContain('EAABtajne');
  });

  it('chyba mimo Graph: před publikací retryable, po ní unknown', () => {
    expect(klasifikujChybu(new Error('DB spadla'), false)).toMatchObject({ druh: 'retryable', kod: 'internal_error' });
    expect(klasifikujChybu(new Error('DB spadla'), true)).toMatchObject({ druh: 'unknown', kod: 'unknown_outcome' });
  });
});

describe('klient Graph', () => {
  it('verze: výchozí v26.0, env přebíjí, nesmysl → výchozí', () => {
    expect(VYCHOZI_VERZE_GRAPH).toBe('v26.0');
    expect(verzeGraph(undefined)).toBe('v26.0');
    expect(verzeGraph(' v27.0 ')).toBe('v27.0');
    expect(verzeGraph('latest')).toBe('v26.0');
    const meta = mockMeta();
    expect(vytvorGraphKlienta({ fetch: meta.fetch, verze: 'v25.0' }).verze).toBe('v25.0');
  });

  it('token jde v hlavičce Authorization: Bearer, ne v URL ani v těle', async () => {
    const meta = mockMeta().na('GET', '/1', { telo: { ok: 1 } }).na('POST', '/1/feed', { telo: { id: '1' } });
    await meta.graph.get('/1', { fields: 'id' }, 'T1');
    await meta.graph.post('/1/feed', { message: 'Příliš žluťoučký kůň' }, 'T2');
    const [get, post] = meta.volani;
    expect(get.url).toBe('https://graph.facebook.com/v26.0/1?fields=id');
    expect(get.hlavicky.Authorization).toBe('Bearer T1');
    expect(post.url).toBe('https://graph.facebook.com/v26.0/1/feed');
    expect(post.params).toEqual({ message: 'Příliš žluťoučký kůň' });
    expect(post.hlavicky).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer T2' });
  });

  it('200 s tělem {error} je chyba; prázdná odpověď je chyba', async () => {
    const meta = mockMeta().na('GET', '/a', { status: 200, telo: { error: { message: 'x', code: 100 } } }).na('GET', '/b', { status: 200, text: '' });
    await expect(meta.graph.get('/a', {}, 't')).rejects.toMatchObject({ code: 100 });
    await expect(meta.graph.get('/b', {}, 't')).rejects.toBeInstanceOf(GraphChyba);
  });
});
