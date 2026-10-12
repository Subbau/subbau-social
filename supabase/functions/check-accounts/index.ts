// Edge funkce check-accounts — denně z pg_cron (Authorization: Bearer <CRON_SECRET>).
// Ověří klíč, obnoví jméno a avatar, u Instagramu stáhne limit publikování do quota.
// Neplatný klíč (Graph 190) → účty needs_reconnect.
// Nasazení s --no-verify-jwt — viz supabase/config.toml.
import { nactiKonfiguraci, odpoved, overCronSecret, sluzebniKlient } from '../_deno/prostredi.ts';
import { vytvorGraphKlienta } from '../_shared/graph.ts';
import { type KontrolovanyUcet, overKlic, zkontrolujUcet } from '../_shared/ucty.ts';

Deno.serve(async (req: Request) => {
  const k = nactiKonfiguraci();
  if (req.method !== 'POST' || !overCronSecret(req, k.cronSecret)) {
    return odpoved(401, { error: 'unauthorized' });
  }
  const sb = sluzebniKlient(k);
  const graph = vytvorGraphKlienta({ fetch, verze: k.graphVerze });

  const { data, error } = await sb.from('social_accounts')
    .select('id, platform, external_id, credential_id')
    .in('platform', ['facebook', 'instagram'])
    .not('credential_id', 'is', null);
  if (error) return odpoved(500, { error: error.message });
  const ucty = (data ?? []) as (KontrolovanyUcet & { credential_id: string })[];

  const podleKlice = new Map<string, typeof ucty>();
  for (const u of ucty) podleKlice.set(u.credential_id, [...(podleKlice.get(u.credential_id) ?? []), u]);

  const souhrn: { id: string; stav: string }[] = [];
  for (const [credentialId, skupina] of podleKlice) {
    const { data: token, error: tokErr } = await sb.rpc('publisher_get_token', { p_credential_id: credentialId });
    if (tokErr || !token) {
      souhrn.push(...skupina.map((u) => ({ id: u.id, stav: 'token_missing' })));
      continue;
    }
    const klic = await overKlic(graph, token as string);
    if (!klic.ok) {
      const zmena = {
        ...(klic.token ? { connection_status: 'needs_reconnect' } : {}),
        last_checked_at: new Date().toISOString(),
        last_check_error: klic.zprava,
      };
      const { error: e } = await sb.from('social_accounts').update(zmena).in('id', skupina.map((u) => u.id));
      if (e) console.error('check-accounts', e.message);
      souhrn.push(...skupina.map((u) => ({ id: u.id, stav: klic.token ? 'needs_reconnect' : 'check_error' })));
      continue;
    }
    for (const u of skupina) {
      const zmena = await zkontrolujUcet(graph, token as string, u, new Date());
      const { error: e } = await sb.from('social_accounts').update(zmena).eq('id', u.id);
      if (e) console.error('check-accounts', u.id, e.message);
      souhrn.push({ id: u.id, stav: zmena.connection_status ?? (zmena.last_check_error ? 'check_error' : 'ok') });
    }
  }

  return odpoved(200, { zkontrolovano: souhrn.length, ucty: souhrn });
});
