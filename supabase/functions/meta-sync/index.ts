// Edge funkce meta-sync — volá ji přihlášený app_user z UI (tlačítko „Načíst účty“).
// Ověří JWT a řádek v app_users, přečte stránky a Instagramy, které vidí klíč Meta
// (GET /me/accounts), a upsertne social_accounts (FB i IG). Barvu, pásmo a zapnutí nemění.
import { CORS, nactiKonfiguraci, odpoved, sluzebniKlient } from '../_deno/prostredi.ts';
import { klasifikujChybu } from '../_shared/chyby.ts';
import { vytvorGraphKlienta } from '../_shared/graph.ts';
import { ZPRAVA_MIMO_KLIC, nactiStranky, prevedNaUcty, uctyMimoKlic } from '../_shared/ucty.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return odpoved(405, { error: 'Jen POST.' }, CORS);

  const k = nactiKonfiguraci();
  const sb = sluzebniKlient(k);

  // 1) přihlášený uživatel
  const jwt = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!jwt) return odpoved(401, { error: 'Nepřihlášený.' }, CORS);
  const { data: auth, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !auth?.user) return odpoved(401, { error: 'Nepřihlášený.' }, CORS);

  // 2) zapsaný v app_users
  const { data: appUser, error: auErr } = await sb.from('app_users').select('id').eq('id', auth.user.id).maybeSingle();
  if (auErr) return odpoved(500, { error: auErr.message }, CORS);
  if (!appUser) return odpoved(403, { error: 'Nemáte přístup do aplikace.' }, CORS);

  // 3) klíč Meta
  const { data: credentialId, error: credErr } = await sb.rpc('publisher_meta_credential');
  if (credErr) return odpoved(500, { error: credErr.message }, CORS);
  if (!credentialId) {
    return odpoved(400, { error: 'Klíč Meta není uložený. Uložte ho podle supabase/setup/05_meta_klic.sql.' }, CORS);
  }
  const { data: token, error: tokErr } = await sb.rpc('publisher_get_token', { p_credential_id: credentialId });
  if (tokErr || !token) return odpoved(500, { error: tokErr?.message ?? 'Klíč Meta nejde přečíst.' }, CORS);

  // 4) stránky z Mety
  const graph = vytvorGraphKlienta({ fetch, verze: k.graphVerze });
  let radky;
  try {
    radky = prevedNaUcty(await nactiStranky(graph, token as string), credentialId as string, new Date());
  } catch (e) {
    const c = klasifikujChybu(e);
    return odpoved(c.druh === 'token' ? 400 : 502, { error: c.zprava, kod: c.kod }, CORS);
  }

  // 5) zápis
  if (radky.length > 0) {
    const { error } = await sb.from('social_accounts').upsert(radky, { onConflict: 'platform,external_id' });
    if (error) return odpoved(500, { error: error.message }, CORS);
  }
  const { data: existujici, error: exErr } = await sb.from('social_accounts')
    .select('id, platform, external_id, connection_status');
  if (exErr) return odpoved(500, { error: exErr.message }, CORS);
  const odpojit = uctyMimoKlic(existujici ?? [], radky);
  if (odpojit.length > 0) {
    const { error } = await sb.from('social_accounts')
      .update({ connection_status: 'needs_reconnect', last_check_error: ZPRAVA_MIMO_KLIC })
      .in('id', odpojit);
    if (error) return odpoved(500, { error: error.message }, CORS);
  }

  return odpoved(200, {
    nacteno: radky.map((r) => ({ platform: r.platform, external_id: r.external_id, name: r.name })),
    odpojeno: odpojit.length,
  }, CORS);
});
