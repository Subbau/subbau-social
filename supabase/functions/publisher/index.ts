// Edge funkce publisher — volá ji pg_cron každou minutu přes pg_net
// s hlavičkou Authorization: Bearer <CRON_SECRET>. Jinak 401.
// Tenká vrstva: uvolní zaseknuté, vezme až 5 splatných a každý zpracuje (_shared/publikace.ts).
// Termín běhu ~110 s: po něm se nové příspěvky nezačínají a dlouhé kroky (nahrání videa)
// se nezačnou, když se do termínu nevejdou — příspěvek se vrátí do fronty bez započítání pokusu.
// Nasazení s --no-verify-jwt (CRON_SECRET není JWT) — viz supabase/config.toml.
import { nactiKonfiguraci, odpoved, overCronSecret, sluzebniKlient, spanek } from '../_deno/prostredi.ts';
import { vytvorPodepisovac, vytvorPublikacniDb } from '../_deno/publikacni_db.ts';
import { vytvorGraphKlienta } from '../_shared/graph.ts';
import { type Prostredi, zpracujPost } from '../_shared/publikace.ts';
import type { Prispevek } from '../_shared/typy.ts';

const DAVKA = 5;
/** Termín běhu od startu: limit Edge funkce je 150 s (Free), rezerva na zápis výsledků. */
const TERMIN_MS = 110_000;

Deno.serve(async (req: Request) => {
  const start = Date.now();
  const k = nactiKonfiguraci();
  if (req.method !== 'POST' || !overCronSecret(req, k.cronSecret)) {
    return odpoved(401, { error: 'unauthorized' });
  }

  const sb = sluzebniKlient(k);

  const uvolnene = await sb.rpc('release_stale_posts');
  if (uvolnene.error) return odpoved(500, { error: `release_stale_posts: ${uvolnene.error.message}` });

  const vzate = await sb.rpc('claim_due_posts', { p_limit: DAVKA });
  if (vzate.error) return odpoved(500, { error: `claim_due_posts: ${vzate.error.message}` });
  const posty = (vzate.data ?? []) as Prispevek[];

  const prostredi: Prostredi = {
    db: vytvorPublikacniDb(sb),
    graph: vytvorGraphKlienta({ fetch, verze: k.graphVerze }),
    podepisovac: vytvorPodepisovac(sb),
    ted: () => new Date(),
    spanek,
    pageTokeny: new Map(),
    termin: new Date(start + TERMIN_MS),
  };

  // Příspěvky jsou na sobě nezávislé → souběžně (každý čeká na IG kontejner nejvýš ~20 s).
  const vysledky = await Promise.all(posty.map(async (p) => {
    try {
      return await zpracujPost(p, prostredi);
    } catch (e) {
      // Selhal i zápis výsledku (např. výpadek DB). Příspěvek zůstává publishing;
      // release_stale_posts ho za 20 minut označí jako nejistý.
      console.error('publisher', p.id, e instanceof Error ? e.message : e);
      return { postId: p.id, vysledek: 'error' };
    }
  }));

  return odpoved(200, { uvolneno: uvolnene.data, zpracovano: vysledky });
});
