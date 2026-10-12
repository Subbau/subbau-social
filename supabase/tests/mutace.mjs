// Ověření, že testy umějí selhat: každá mutace úmyslně rozbije kód a testy musí zčervenat.
//
//   node mutace.mjs            všechny mutace
//   node mutace.mjs claim      jen mutace, jejichž název obsahuje „claim“
//
// Mutace se NEDĚLAJÍ v těchto souborech: celý supabase/ se zkopíruje do dočasné složky,
// tam se rozbije a tam se pustí testy. Originál zůstane nedotčený i při pádu skriptu.
// Kontrolní běh bez mutace musí projít, jinak výsledky mutací nic neznamenají.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTY = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE = path.dirname(TESTY);
const filtr = process.argv[2] ?? '';

/** [název, soubor (od supabase/), hledaný text, náhrada, kontrola: 'vitest' | tsconfig] */
const MUTACE = [
  // --- publikační smyčka v DB
  ['claim bez skip locked', 'migrations/0005_publikace.sql', '     order by coalesce(p.next_attempt_at, p.scheduled_at), p.id\n     for update skip locked;', '     order by coalesce(p.next_attempt_at, p.scheduled_at), p.id\n     for update;'],
  ['claim bez zamykání', 'migrations/0005_publikace.sql', '     order by coalesce(p.next_attempt_at, p.scheduled_at), p.id\n     for update skip locked;', '     order by coalesce(p.next_attempt_at, p.scheduled_at), p.id;'],
  ['claim bere publishing v jakémkoli kroku', 'migrations/0005_publikace.sql', "and p.step = 'container_processing'", ''],
  ['claim čeká jen 5 s místo 45 s', 'migrations/0005_publikace.sql', "interval '45 seconds'", "interval '5 seconds'"],
  ['claim zvyšuje pokusy i u pokračování kontejneru', 'migrations/0005_publikace.sql', "case when p.status = 'scheduled' then p.attempt_count + 1 else p.attempt_count end", 'p.attempt_count + 1'],
  ['release po 18 min místo 20', 'migrations/0005_publikace.sql', "interval '20 minutes'", "interval '18 minutes'"],
  ['save_progress neověřuje lock_token', 'migrations/0005_publikace.sql', '     and lock_token = p_lock_token;', ';'],
  ['finish neověřuje lock_token', 'migrations/0005_publikace.sql', "lock_token = case when v_stav = 'publishing' then p.lock_token end\n   where p.id = p_post_id\n     and p.status = 'publishing'\n     and p.lock_token = p_lock_token;", "lock_token = case when v_stav = 'publishing' then p.lock_token end\n   where p.id = p_post_id\n     and p.status = 'publishing';"],
  // --- přechody stavů a omezení sloupců
  ['přechod draft→published místo draft→scheduled', 'migrations/0003_triggery.sql', "(old.status = 'draft' and new.status = 'scheduled')", "(old.status = 'draft' and new.status = 'published')"],
  ['publishing jde měnit', 'migrations/0003_triggery.sql', "if old.status = 'publishing' then", 'if false then'],
  ['published jde měnit celý', 'migrations/0003_triggery.sql', "if (to_jsonb(new) - 'error_resolved_at' - 'updated_at')", "if false and (to_jsonb(new) - 'error_resolved_at' - 'updated_at')"],
  ['failed→scheduled nevynuluje pokusy', 'migrations/0003_triggery.sql', '    new.step := null;\n    new.attempt_count := 0;\n    new.locked_at := null;', '    new.step := null;\n    new.locked_at := null;'],
  ['klient smí systémové sloupce', 'migrations/0003_triggery.sql', "raise exception 'Systémové údaje příspěvku", "raise notice 'Systémové údaje příspěvku"],
  ['klient smí měnit jméno účtu', 'migrations/0003_triggery.sql', 'if public.je_klient()\n     and (to_jsonb(new)', 'if false\n     and (to_jsonb(new)'],
  ['změna médií nezahodí remote_state', 'migrations/0003_triggery.sql', "     set remote_state = '{}', step = null, attempt_count = 0, next_attempt_at = null\n", "     set step = null, attempt_count = 0, next_attempt_at = null\n"],
  ['audit nezapisuje změny', 'migrations/0003_triggery.sql', 'create trigger posts_audit after insert or update or delete', 'create trigger posts_audit after insert or delete'],
  // --- práva
  ['RLS posts propustí každého', 'migrations/0002_prava.sql', "create policy posts_all on public.posts\n  for all to authenticated using (public.is_app_user())", "create policy posts_all on public.posts\n  for all to authenticated using (true)"],
  ['RLS text_snippets smazaná', 'migrations/0002_prava.sql', 'create policy text_snippets_all on public.text_snippets\n  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());', ''],
  ['anon dostane tabulky', 'migrations/0002_prava.sql', 'revoke all on all tables in schema public from anon, authenticated;', 'revoke all on all tables in schema public from authenticated;'],
  ['publisher_get_token pro všechny', 'migrations/0006_tajemstvi.sql', 'revoke all on function public.publisher_get_token(uuid) from public, anon, authenticated;', ''],
  ['claim_due_posts pro všechny', 'migrations/0005_publikace.sql', 'revoke all on function public.claim_due_posts(int) from public, anon, authenticated;', ''],
  ['secure schema přístupné', 'migrations/0002_prava.sql', 'revoke all on schema secure from public, anon, authenticated, service_role;', 'grant usage on schema secure to authenticated, service_role;'],
  ['storage: jakýkoli bucket', 'migrations/0007_storage.sql', "with check (bucket_id = 'media' and public.is_app_user());\n\ncreate policy media_app_user_update", "with check (public.is_app_user());\n\ncreate policy media_app_user_update"],
  // --- série
  ['série: čas v UTC posunem o 24 h (rozbije letní čas)', 'migrations/0004_serie.sql', '((g.d::date + p_time_of_day) at time zone p_timezone)', "((p_starts_on + p_time_of_day) at time zone p_timezone) + (g.d::date - p_starts_on) * interval '24 hours'"],
  ['série: čas o hodinu vedle', 'migrations/0004_serie.sql', '((g.d::date + p_time_of_day) at time zone p_timezone)', "((g.d::date + p_time_of_day) at time zone p_timezone) + interval '1 hour'"],
  ['série: měsíc bez 31. přeskočí', 'migrations/0004_serie.sql', "extract(day from (date_trunc('month', g.d) + interval '1 month - 1 day'))::int)", '99)'],
  ['série: interval týdnů ignorován', 'migrations/0004_serie.sql', '/ 7) % p_interval_n = 0', '/ 7) % 1 = 0'],
  ['série: bez on conflict', 'migrations/0004_serie.sql', 'on conflict (series_id, scheduled_at) where series_id is not null do nothing', ''],
  ['série: generated_until ignorován', 'migrations/0004_serie.sql', 's.generated_until + 1', 'null::date'],
  ['série: kopie bez médií', 'migrations/0004_serie.sql', 'where pm.post_id = t.id;', 'where pm.post_id = t.id and false;'],
  // --- Instagram
  ['IG: při navázání nový kontejner', 'functions/_shared/instagram.ts', 'if (!k.stav.container_id) {\n    const odlozeno', 'if (true) {\n    const odlozeno'],
  ['IG: pauza neuloží container_processing', 'functions/_shared/instagram.ts', "  await k.krok('container_processing');\n", ''],
  ['IG: kontejner PUBLISHED se publikuje znovu', 'functions/_shared/instagram.ts', "if (s === 'PUBLISHED' && ids.length === 1) return 'PUBLISHED';", ''],
  ['IG: nejistý výsledek nejde zpět do fronty', 'functions/_shared/publikace.ts', "platforma === 'instagram' && Boolean(stav.container_id)", 'false'],
  ['IG: karusel bez is_carousel_item', 'functions/_shared/instagram.ts', "is_carousel_item: 'true',", ''],
  ['IG: reel bez share_to_feed', 'functions/_shared/instagram.ts', "params: { media_type: 'REELS', video_url: media[0].url, caption, share_to_feed: 'true' }", "params: { media_type: 'REELS', video_url: media[0].url, caption }"],
  ['IG: PNG projde', 'functions/_shared/pravidla.ts', "return m.mime_type.toLowerCase() === 'image/jpeg';", 'return true;'],
  ['IG: limit karuselu 11', 'functions/_shared/instagram.ts', 'media.length > 10', 'media.length > 11'],
  // --- Facebook
  ['FB: fotky se nahrávají znovu', 'functions/_shared/facebook.ts', 'for (let i = ids.length; i < fotky.length; i++)', 'for (let i = 0; i < fotky.length; i++)'],
  ['FB: reel start i při navázání', 'functions/_shared/facebook.ts', 'if (!k.stav.video_id || !k.stav.upload_url) {', 'if (true) {'],
  ['FB: story se pokusí publikovat', 'functions/_shared/facebook.ts', "if (k.post.format === 'story') {", 'if (false) {'],
  ['FB: page token bez cache', 'functions/_shared/facebook.ts', 'if (ulozeny) return ulozeny;', ''],
  ['FB: jedna fotka nezveřejněná', 'functions/_shared/facebook.ts', "published: 'true',", "published: 'false',"],
  ['FB: odkaz na video bez stránky', 'functions/_shared/facebook.ts', '`${FB}/${page}/videos/${id}`', '`${FB}/videos/${id}`'],
  // --- chyby, backoff, duplicita
  ['chyby: 190 není token', 'functions/_shared/chyby.ts', 'new Set([190, 102])', 'new Set([102])'],
  ['chyby: 613 není retryable', 'functions/_shared/chyby.ts', 'new Set([4, 17, 32, 613])', 'new Set([4, 17, 32])'],
  ['chyby: výpadek po publikaci jako retryable', 'functions/_shared/chyby.ts', "    if (e.sit) {\n      return e.publikacni\n", "    if (e.sit) {\n      return !e.publikacni\n"],
  ['chyby: HTTP 500 není retryable', 'functions/_shared/chyby.ts', 'if (e.http !== null && e.http >= 500) return', 'if (e.http !== null && e.http > 500) return'],
  ['chyby: 368 není fatal', 'functions/_shared/chyby.ts', 'if (code === 368)', 'if (code === 369)'],
  ['chyby: limit IG není fatal', 'functions/_shared/chyby.ts', "if (code === 9 && e.subcode === 2207042) return zGraphu(e, 'fatal', 'ig_daily_limit');", ''],
  // --- opravy po kontrole (1–7)
  ['chyby: zpráva Graph chyby se nečistí (token z Deno URL)', 'functions/_shared/graph.ts', 'super(ocistiText(zprava));', 'super(zprava);'],
  ['chyby: chyba mimo Graph se nečistí', 'functions/_shared/chyby.ts', 'const text = ocistiText(e instanceof Error ? e.message : String(e));', 'const text = e instanceof Error ? e.message : String(e);'],
  ['chyby: ocistiText nechá access_token', 'functions/_shared/graph.ts', ".replace(/(access_token=)[^&\\s)'\",]+/gi, '$1***')", ".replace(/(access_token=)NIC/gi, '$1***')"],
  ['token zpět v URL (GET)', 'functions/_shared/graph.ts', 'const q = new URLSearchParams(params).toString();', 'const q = new URLSearchParams({ ...params, access_token: token }).toString();'],
  ['token zpět v těle (POST)', 'functions/_shared/graph.ts', 'body: new URLSearchParams(params).toString(),', 'body: new URLSearchParams({ ...params, access_token: token }).toString(),'],
  ['FB: 5xx u zveřejnění se opakuje', 'functions/_shared/chyby.ts', "if (docasna && e.publikacni && !e.overitelne) return zGraphu(e, 'unknown', 'unknown_outcome');", ''],
  ['FB: kód 2 u zveřejnění se opakuje', 'functions/_shared/chyby.ts', 'const docasna = KODY_DOCASNE.has(code) || e.isTransient || (e.http !== null && e.http >= 500);', 'const docasna = e.isTransient || (e.http !== null && e.http >= 500);'],
  ['IG: media_publish neověřitelný', 'functions/_shared/instagram.ts', 'k.token, { overitelne: true }), ', 'k.token), '],
  ['error_resolved_at: klient ho při zkusit znovu nenuluje', 'migrations/0003_triggery.sql', '    new.error_resolved_at := null;\n    new.next_attempt_at := null;', '    new.next_attempt_at := null;'],
  ['error_resolved_at: finish failed ho nenuluje', 'migrations/0005_publikace.sql', "error_resolved_at = case when v_stav = 'failed' then null else p.error_resolved_at end,", 'error_resolved_at = p.error_resolved_at,'],
  ['šablona: série nad naplánovaným jde založit', 'migrations/0004_serie.sql', 'create trigger post_series_sablona_hlidac before insert or update of template_post_id on public.post_series\n  for each row execute function public.post_series_sablona_hlidac();', ''],
  ['šablona: šablonu jde naplánovat', 'migrations/0004_serie.sql', "create trigger posts_sablona_hlidac before update on public.posts\n  for each row\n  when (new.status = 'scheduled' and old.status is distinct from 'scheduled')\n  execute function public.posts_sablona_hlidac();", ''],
  ['termín: po termínu se příspěvek začne', 'functions/_shared/publikace.ts', 'if (zbyvaMs() <= 0) {', 'if (false) {'],
  ['termín: reel upload i bez času', 'functions/_shared/facebook.ts', "if (k.zbyvaMs() < DLOUHY_KROK_MS) throw new MaloCasu('reel_upload');", ''],
  ['termín: FB video i bez času', 'functions/_shared/facebook.ts', "if (k.zbyvaMs() < DLOUHY_KROK_MS) throw new MaloCasu('video');", ''],
  ['termín: IG čeká přes termín', 'functions/_shared/instagram.ts', 'const konec = Math.min(k.ted().getTime() + k.cekani.celkemMs, k.ted().getTime() + k.zbyvaMs());', 'const konec = k.ted().getTime() + k.cekani.celkemMs;'],
  ['termín: return_claim nevrátí pokus', 'migrations/0005_publikace.sql', 'else greatest(p.attempt_count - 1, 0) end,', 'else p.attempt_count end,'],
  ['termín: return_claim neověřuje lock_token', 'migrations/0005_publikace.sql', "         lock_token = case when p.step = 'container_processing' then p.lock_token end\n   where p.id = p_post_id\n     and p.status = 'publishing'\n     and p.lock_token = p_lock_token;", "         lock_token = case when p.step = 'container_processing' then p.lock_token end\n   where p.id = p_post_id\n     and p.status = 'publishing';"],
  ['termín: return_claim i u kontejneru → scheduled', 'migrations/0005_publikace.sql', "status = case when p.step = 'container_processing' then 'publishing'::public.post_status", "status = case when false then 'publishing'::public.post_status"],
  ['IG: dohledání bez kontroly času', 'functions/_shared/instagram.ts', '&& (nejdrive === -Infinity || casInstagramu(m.timestamp) >= nejdrive));', ');'],
  ['IG: čas Instagramu špatně (+0000)', 'functions/_shared/instagram.ts', "return t ? Date.parse(t.replace(/([+-]\\d{2})(\\d{2})$/, '$1:$2')) : NaN;", "return t ? Date.parse(t.replace(/([+-]\\d{2})(\\d{2})$/, '$1:$2')) + 3_600_000 : NaN;"],
  ['chyby: 190 neodpojí účet', 'functions/_shared/publikace.ts', '    await p.db.oznacUcetKOpojeni(post.account_id, k.zprava);\n', ''],
  ['chyby: fbtrace_id se neukládá', 'functions/_shared/publikace.ts', '{ fbtrace_id: k.graph.fbtrace_id, graph_error: k.graph }', '{ graph_error: k.graph }'],
  ['backoff bez 30 min', 'functions/_shared/pravidla.ts', 'ZPOZDENI_MINUT = [2, 10, 30]', 'ZPOZDENI_MINUT = [2, 10]'],
  ['backoff o minutu vedle', 'functions/_shared/pravidla.ts', 'minut * 60_000', '(minut + 1) * 60_000'],
  // --- duplicita v claim_due_posts (2. kolo)
  ['duplicita: claim nekontroluje', 'migrations/0005_publikace.sql', '      if found then\n        v_zprava', '      if false then\n        v_zprava'],
  ['duplicita: publishing se nebere', 'migrations/0005_publikace.sql', "         and (o.status = 'publishing'\n              or (o.status", "         and (false\n              or (o.status"],
  ['duplicita: okno 28 dní', 'migrations/0005_publikace.sql', "o.published_at >= now() - interval '30 days'", "o.published_at >= now() - interval '28 days'"],
  ['duplicita: allow_duplicate ignorováno', 'migrations/0005_publikace.sql', "       and (k.platform_options -> 'allow_duplicate') is distinct from 'true'::jsonb then", '       then'],
  ['duplicita: výjimka série pro všechny', 'migrations/0005_publikace.sql', 'and not (k.series_id is not null and o.series_id is not distinct from k.series_id)', 'and not (o.series_id is not null)'],
  ['duplicita: bez advisory zámku', 'migrations/0005_publikace.sql', "      if not pg_try_advisory_xact_lock(hashtextextended(k.account_id::text || '|' || k.content_hash, 0)) then", '      if false then'],
  ['duplicita: FOR smyčka s přednačítáním (zamkne 10 řádků)', 'migrations/0005_publikace.sql', [
    ['  open c for\n    select p.id', '  for k in\n    select p.id'],
    ['     for update skip locked;\n\n  while v_vzato < v_limit loop\n    fetch c into k;\n    exit when not found;\n', '     for update skip locked\n  loop\n    exit when v_vzato >= v_limit;\n'],
    ['  close c;\n', ''],
  ]],
  ['duplicita: kontroluje i pokračování kontejneru', 'migrations/0005_publikace.sql', "    if k.status = 'scheduled'\n       and k.content_hash is not null", "    if k.content_hash is not null"],
  ['duplicita: bez odkazu na druhý příspěvek', 'migrations/0005_publikace.sql', "'Stejný příspěvek se na tomto účtu právě zveřejňuje (příspěvek ' || v_jiny.id || ').'", "'Stejný příspěvek se na tomto účtu právě zveřejňuje.'"],
  // --- 3. kolo
  ['duplicita: nejistá kopie se nebere', 'migrations/0005_publikace.sql', "              or (o.last_error_code = 'unknown_outcome'\n", "              or (false and o.last_error_code = 'unknown_outcome'\n"],
  ['duplicita: nejistá kopie bez okna 30 dní', 'migrations/0005_publikace.sql', "and o.updated_at >= now() - interval '30 days'", 'and true'],
  ['duplicita: nejistá kopie i jako koncept', 'migrations/0005_publikace.sql', "and o.status in ('scheduled', 'failed')", "and o.status in ('scheduled', 'failed', 'draft')"],
  ['duplicita: nejistá kopie jen ve failed', 'migrations/0005_publikace.sql', "and o.status in ('scheduled', 'failed')", "and o.status in ('failed')"],
  ['duplicita: nejistá zpráva bez „možná vyšel“', 'migrations/0005_publikace.sql', "'Stejný příspěvek na tomto účtu možná už vyšel — předchozí pokus (příspěvek '", "'Stejný příspěvek na tomto účtu vyšel (příspěvek '"],
  ['duplicita: nejistá zpráva bez odkazu', 'migrations/0005_publikace.sql', "               || v_jiny.id || ') skončil nejistě. Zkontrolujte stránku.'", "               || ') skončil nejistě. Zkontrolujte stránku.'"],
  ['FB {}: fotka projde', 'functions/_shared/facebook.ts', "const id = potvrzeneId(r.post_id ? r : { post_id: r.id }, 'post_id', true);", 'const id = String(r.post_id ?? r.id);'],
  ['FB {}: video projde', 'functions/_shared/facebook.ts', "  const id = potvrzeneId(r, 'id', true);\n  return hotovo(k, id, `${FB}/${page}/videos/${id}`);", "  const id = String((r as { id?: string }).id);\n  return hotovo(k, id, `${FB}/${page}/videos/${id}`);"],
  ['FB {}: víc fotek projde', 'functions/_shared/facebook.ts', "  const id = potvrzeneId(r, 'id', true);\n  return hotovo(k, id, `${FB}/${id}`);", "  const id = String((r as { id?: string }).id);\n  return hotovo(k, id, `${FB}/${id}`);"],
  ['IG {}: media_publish projde', 'functions/_shared/instagram.ts', "  const mediaId = potvrzeneId(\n    await k.publikuj(`/${ig}/media_publish`, { creation_id: containerId }, k.token, { overitelne: true }), 'id', true);", "  const mediaId = String(((await k.publikuj(`/${ig}/media_publish`, { creation_id: containerId }, k.token, { overitelne: true })) as { id?: string }).id);"],
  ['potvrzeneId bere {} jako id', 'functions/_shared/graph.ts', "if ((typeof v === 'string' && v !== '') || typeof v === 'number') return String(v);", 'return String(v);'],
  ['release nenuluje error_resolved_at', 'migrations/0005_publikace.sql', "           last_error_message = v_zprava,\n           error_resolved_at = null,\n           next_attempt_at = null,\n           locked_at = null,", "           last_error_message = v_zprava,\n           next_attempt_at = null,\n           locked_at = null,"],
  ['změna obsahu nenuluje pokusy', 'migrations/0003_triggery.sql', "    new.step := null;\n    new.attempt_count := 0;\n    new.next_attempt_at := null;\n  end if;\n\n  return new;", "    new.step := null;\n  end if;\n\n  return new;"],
  ['změna médií nenuluje pokusy', 'migrations/0003_triggery.sql', "     set remote_state = '{}', step = null, attempt_count = 0, next_attempt_at = null\n", "     set remote_state = '{}', step = null\n"],
  ['nejasná 200 u zveřejnění jako retryable', 'functions/_shared/chyby.ts', "    if (e.nejasna) {\n      return e.publikacni\n", "    if (e.nejasna) {\n      return false\n"],
  ['prázdná 200 se nebere jako nejasná', 'functions/_shared/graph.ts', "{ http: odpoved.status, publikacni, overitelne, nejasna: true });", "{ http: odpoved.status, publikacni, overitelne });"],
  ['FB feed bez id projde', 'functions/_shared/facebook.ts', "  const id = potvrzeneId(await k.publikuj(`/${page}/feed`, params, pageToken), 'id', true);", "  const id = String(((await k.publikuj(`/${page}/feed`, params, pageToken)) as { id?: string }).id);"],
  ['FB reel finish bez success projde', 'functions/_shared/facebook.ts', "  if (konec?.success !== true) potvrzeneId({}, 'success', true); // 2xx bez potvrzení = nejisté", ''],
  ['fatal po media_publish smaže remote_state', 'functions/_shared/publikace.ts', 'const ponechat = publikaceOdeslana || Boolean(stav.publish_sent_at);', 'const ponechat = false;'],
  ['MaloCasu bez stropu', 'functions/_shared/publikace.ts', 'if (odklady >= MAX_ODKLADU_CASU) {', 'if (false) {'],
  ['MaloCasu se nepočítá', 'functions/_shared/publikace.ts', 'stav.odklady_casu = odklady + 1;', ''],
  ['ocistiText: JSON tvar', 'functions/_shared/graph.ts', `.replace(/("access_token"\\s*:\\s*")[^"]*(")/gi, '$1***$2')`, ''],
  ['ocistiText: %3D tvar', 'functions/_shared/graph.ts', ".replace(/(access_token%3D)[A-Za-z0-9_\\-.|]+/gi, '$1***')", ''],
  ['verze Graph v24.0', 'functions/_shared/graph.ts', "VYCHOZI_VERZE_GRAPH = 'v26.0'", "VYCHOZI_VERZE_GRAPH = 'v24.0'"],
  ['meta-sync: IG bez propojené stránky', 'functions/_shared/ucty.ts', 'linked_page_external_id: s.id,', 'linked_page_external_id: null,'],
  ['check-accounts: 190 nechá connected', 'functions/_shared/ucty.ts', "if (k.druh === 'token') {\n      return { connection_status: 'needs_reconnect'", "if (false) {\n      return { connection_status: 'needs_reconnect'"],
  // --- setup soubory
  ['setup: bucket veřejný', 'setup/01_bucket_media.sql', '  false,\n  52428800', '  true,\n  52428800'],
  ['setup: bucket 1 GB i na Free', 'setup/01_bucket_media.sql', '  52428800, -- 50 MB', '  1073741824, -- 50 MB'],
  ['setup: bucket o bajt víc než 50 MB', 'setup/01_bucket_media.sql', '  52428800, -- 50 MB', '  52428801, -- 50 MB'],
  ['setup: znovu puštěný bucket nesrovná limit', 'setup/01_bucket_media.sql', '      file_size_limit = excluded.file_size_limit,', '      file_size_limit = storage.buckets.file_size_limit,'],
  ['setup: návod bez příkazu pro Pro', 'setup/01_bucket_media.sql', "--        update storage.buckets set file_size_limit = 1073741824 where id = 'media';", '--        (zvednout limit)'],
  ['setup: znovu puštěný bucket nesrovná public', 'setup/01_bucket_media.sql', 'set public = false,', 'set public = public,'],
  ['setup: CRON_SECRET bez zábrany', 'setup/03_cron_secret.sql', "if v_secret like '<<%' or length(v_secret) < 32 then", 'if false then'],
  ['setup: secret natvrdo v textu jobu', 'setup/04_cron.sql', "functions/v1/publisher',\n    headers := jsonb_build_object(\n      'Content-Type', 'application/json',\n      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'subbau_cron_secret')", "functions/v1/publisher',\n    headers := jsonb_build_object(\n      'Content-Type', 'application/json',\n      'Authorization', 'Bearer ' || 'aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbb'"],
  ['setup: klíč Meta bez zábrany', 'setup/05_meta_klic.sql', "if v_token like '<<%' then", 'if false then'],
  // --- zmeškané příspěvky (missed)
  ['zmeškané: claim nekontroluje', 'migrations/0005_publikace.sql', '       and k.scheduled_at < now() - c_zmeskano\n', '       and false\n'],
  ['zmeškané: hranice 3 h', 'migrations/0005_publikace.sql', "c_zmeskano constant interval := interval '2 hours';", "c_zmeskano constant interval := interval '3 hours';"],
  ['zmeškané: hranice 1 h', 'migrations/0005_publikace.sql', "c_zmeskano constant interval := interval '2 hours';", "c_zmeskano constant interval := interval '1 hour';"],
  ['zmeškané: i backoff', 'migrations/0005_publikace.sql', '       and k.attempt_count = 0\n       and k.next_attempt_at is null\n', ''],
  ['zmeškané: i rozpracované', 'migrations/0005_publikace.sql', "       and k.remote_state = '{}'::jsonb\n", ''],
  ['zmeškané: i pokračování kontejneru', 'migrations/0005_publikace.sql', "    if k.status = 'scheduled'\n       and k.attempt_count = 0", "    if k.status in ('scheduled', 'publishing')\n       and k.attempt_count >= 0"],
  ['zmeškané: bez ohledu na poslední úpravu', 'migrations/0005_publikace.sql', '\n       and k.updated_at < now() - c_zmeskano then', ' then'],
  ['zmeškané: čas vždy v Praze', 'migrations/0005_publikace.sql', "coalesce(k.tz, 'Europe/Prague')", "'Europe/Prague'"],
  ['zmeškané: čas v UTC', 'migrations/0005_publikace.sql', "coalesce(k.tz, 'Europe/Prague')", "'UTC'"],
  ['zmeškané: pokus jako success', 'migrations/0005_publikace.sql', "values (k.id, now(), now(), 'claim', 'fatal_error', 'missed', v_zprava,", "values (k.id, now(), now(), 'claim', 'success', 'missed', v_zprava,"],
  ['zmeškané: jiná zpráva', 'migrations/0005_publikace.sql', "') — server v tu dobu neběžel. Pokud ho chcete zveřejnit, naplánujte ho znovu.'", "') — server neběžel.'"],
  // --- typová kontrola (deno není k dispozici → tsc)
  ['tsc: publisher volá zpracujPost bez prostředí', 'functions/publisher/index.ts', 'await zpracujPost(p, prostredi)', 'await zpracujPost(p)', 'tsconfig.json'],
  ['tsc: Deno API v _shared', 'functions/_shared/pravidla.ts', 'export const PLATNOST_URL_SEKUND = 3600;', "export const PLATNOST_URL_SEKUND = Number(Deno.env.get('X') ?? 3600);", 'tsconfig.shared.json'],
  ['tsc: meta-sync špatný typ upsertu', 'functions/meta-sync/index.ts', "prevedNaUcty(await nactiStranky(graph, token as string), credentialId as string, new Date())", "prevedNaUcty(await nactiStranky(graph, token as string), credentialId as string, 'dnes')", 'tsconfig.json'],
];

function kopie() {
  const cil = fs.mkdtempSync(path.join(os.tmpdir(), 'subbau-social-mutace-'));
  const supa = path.join(cil, 'supabase');
  fs.cpSync(SUPABASE, supa, {
    recursive: true,
    filter: (zdroj) => !zdroj.startsWith(path.join(TESTY, 'node_modules')),
  });
  fs.symlinkSync(path.join(TESTY, 'node_modules'), path.join(supa, 'tests', 'node_modules'), 'dir');
  return { cil, supa };
}

function spust(supa, kontrola) {
  const cwd = path.join(supa, 'tests');
  if (kontrola !== 'vitest') {
    const r = spawnSync('npx', ['tsc', '-p', kontrola], { cwd, encoding: 'utf8' });
    const chyby = (r.stdout + r.stderr).split('\n').filter((l) => /error TS/.test(l));
    return { prosly: r.status === 0, padle: chyby.length, ukazka: chyby.slice(0, 2).map((l) => l.replace(/^.*?functions\//, 'functions/')) };
  }
  const json = path.join(cwd, 'vysledek.json');
  const r = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${json}`], { cwd, encoding: 'utf8', timeout: 300_000 });
  if (!fs.existsSync(json)) return { prosly: false, padle: -1, ukazka: [`vitest nevytvořil výsledek (exit ${r.status}): ${(r.stderr || '').slice(0, 300)}`] };
  const v = JSON.parse(fs.readFileSync(json, 'utf8'));
  const padle = v.testResults.flatMap((s) => s.assertionResults.filter((a) => a.status === 'failed').map((a) => `${path.basename(s.name)} › ${a.fullName}`));
  const padleSoubory = v.testResults.filter((s) => s.status === 'failed' && s.assertionResults.every((a) => a.status !== 'failed')).map((s) => `${path.basename(s.name)} (soubor spadl: ${(s.message || '').slice(0, 120)})`);
  return { prosly: r.status === 0 && v.numFailedTests === 0 && v.success, padle: v.numFailedTests + padleSoubory.length, celkem: v.numTotalTests, ukazka: [...padle, ...padleSoubory].slice(0, 2) };
}

// Kontrolní běh: kopie bez mutace musí projít (vitest i tsc).
{
  const { cil, supa } = kopie();
  const vt = spust(supa, 'vitest');
  const ts1 = spust(supa, 'tsconfig.json');
  const ts2 = spust(supa, 'tsconfig.shared.json');
  fs.rmSync(cil, { recursive: true, force: true });
  console.log(`KONTROLA bez mutace: vitest ${vt.prosly ? 'prošel' : 'SPADL'} (${vt.celkem} testů), tsc ${ts1.prosly && ts2.prosly ? 'prošel' : 'SPADL'}`);
  if (!vt.prosly || !ts1.prosly || !ts2.prosly) {
    console.log(vt.ukazka, ts1.ukazka, ts2.ukazka);
    process.exit(2);
  }
}

let spatne = 0;
const vybrane = MUTACE.filter(([nazev]) => nazev.includes(filtr));
for (const [nazev, soubor, hledej, nahrad, kontrola = 'vitest'] of vybrane) {
  const { cil, supa } = kopie();
  try {
    const cesta = path.join(supa, soubor);
    const puvodni = fs.readFileSync(cesta, 'utf8');
    // hledej může být i pole dvojic [hledej, nahrad] (víc úprav v jednom souboru)
    const dvojice = Array.isArray(hledej) ? hledej : [[hledej, nahrad]];
    let upraveny = puvodni;
    let neplatna = '';
    for (const [h, n] of dvojice) {
      const vyskytu = upraveny.split(h).length - 1;
      if (vyskytu !== 1) neplatna ||= `hledaný text je v ${soubor} ${vyskytu}×`;
      else upraveny = upraveny.replace(h, () => n);
    }
    if (neplatna) {
      console.log(`NEPLATNÁ  ${nazev}: ${neplatna}`);
      spatne++;
      continue;
    }
    fs.writeFileSync(cesta, upraveny);
    const r = spust(supa, kontrola);
    if (r.prosly) {
      spatne++;
      console.log(`ZELENÁ ✗  ${nazev} — mutace NEBYLA odhalena`);
    } else {
      console.log(`červená ✓ ${nazev} — spadlo ${r.padle}: ${r.ukazka.join(' | ')}`);
    }
  } finally {
    fs.rmSync(cil, { recursive: true, force: true });
  }
}
console.log(`\nMutací: ${vybrane.length}, odhalených: ${vybrane.length - spatne}, neodhalených/neplatných: ${spatne}`);
process.exit(spatne === 0 ? 0 : 1);
