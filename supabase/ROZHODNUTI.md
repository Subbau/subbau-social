# Rozhodnutí DB agenta (SubBau Social Manager)

Kde SPEC.md mlčel nebo si odporoval, jak jsem to rozhodl. SPEC.md jsem neměnil.
Body 1 a 3 rozhodl koordinátor po kontrole (12. 10.); část „Opravy po kontrole“ je na konci.

## Rozpory ve SPEC

1. **Backoff — ROZHODNUTO: 4 pokusy celkem** = první pokus + 3 opakování po 2 / 10 / 30 min
   (po 1. pokusu +2 min, po 2. +10, po 3. +30; když selže i 4. → `failed`). „Po 3. pokusu
   failed“ ve SPEC se tím rozumí po 3. opakování. Jedna konstanta `ZPOZDENI_MINUT`
   v `functions/_shared/pravidla.ts`, `MAX_POKUSU = 4`.
2. **Výchozí verze Graph API** — v zadání `v24.0`, koordinátor opravil na **`v26.0`**.
   Jediné místo: `VYCHOZI_VERZE_GRAPH` v `_shared/graph.ts`; přebíjí env `GRAPH_API_VERSION`
   (jen tvar `vX.Y`, jinak se použije výchozí).
3. **Dočasná chyba u volání, které zveřejňuje — ROZHODNUTO.** U Facebooku zveřejňovací
   volání (`/feed`, `/photos` s `published=true`, `/videos`, `video_reels` finish, `/feed`
   s `attached_media`) nejde ověřit: HTTP ≥ 500, kódy 1/2 i `is_transient` → **unknown**
   → `failed` / `unknown_outcome`, bez automatického opakování (jinak hrozí zdvojení).
   Přípravné kroky (nepublikované fotky, reel start/upload, IG kontejnery) zůstávají retryable.
   IG `media_publish` zůstává retryable (volba `overitelne`): před každým opakováním se čte
   stav kontejneru. Rate limit (4/17/32/613), token a trvalé chyby se u zveřejnění nemění.

## Díry ve SPEC — doplněno

### Opakování (post_series)
4. **Sloupec `post_series.generated_until`** (nad rámec SPEC). Bez něj by denní
   `extend_all_series()` vrátil zpět každý smazaný výskyt a k přesunutému výskytu přidal
   druhý v původním čase. Výskyty se generují jen za `generated_until`. Změna rozvrhu
   (čas, dny, interval, pásmo, začátek, konec, horizont, účet) ho trigger vynuluje.
   Staré výskyty se nemažou — **UI při změně času série musí smazat budoucí naplánované
   výskyty samo**, jinak budou vedle sebe staré i nové.
5. Pomocná funkce `public.series_occurrences(...)` (čistý výpočet okamžiků) — kvůli testům
   přechodu času na konkrétní data (29. 3. a 25. 10. 2026), aniž by se do produkčního kódu
   pašovaly „testovací hodiny“.
6. Výskyt = kopie šablony: `caption, format, link_url, platform_options, post_media`,
   `copied_from_id = šablona`. `content_hash` se kopíruje, jen když je šablona ze stejného účtu
   (hash obsahuje account_id).
7. Týdenní interval se počítá od pondělí týdne, ve kterém série začíná; měsíční od měsíce začátku.
8. Nad SPEC: `freq not null`, `horizon_weeks` 1–104, týdenní musí mít `weekdays`, měsíční
   `month_day`. `post_series.account_id` bez cascade (stejně jako posts).
9. `generate_series_occurrences` je security **invoker** (app_user jde přes RLS a triggery);
   cron ho volá přes `extend_all_series()` jako postgres. Série bez šablony → 0 + warning.

### Duplicita
10. **Kontrola duplicity je v DB, v `claim_due_posts`** (2. kolo; přednost podle
    `scheduled_at` zrušena — pouštěla obě kopie, když jedna čekala v backoffu). Naplánovaný
    příspěvek s `content_hash` (bez `allow_duplicate`) je duplicita, když na stejném účtu
    existuje JINÝ příspěvek se stejným `content_hash` ve stavu `publishing`, nebo `published`
    za 30 dní, **nebo který skončil nejistě** (`last_error_code = 'unknown_outcome'`, stav
    `scheduled` nebo `failed`, `updated_at` za 30 dní — mohl ve skutečnosti vyjít: IG v backoffu
    po nejistém `media_publish`, FB `failed` / `unknown_outcome`; 3. kolo). Výjimka: výskyty
    téže série. U nejisté kopie zpráva říká „možná už vyšel — předchozí pokus skončil nejistě“
    a `remote_ids.duplicate_status = 'unknown_outcome'`. Koncept (`draft`) s nejistou chybou
    se nepočítá (uživatel ho stáhl z fronty). Duplicita rovnou skončí `failed` /
    `duplicate_suspected`, zpráva česky s id druhého příspěvku, v `publish_attempts`
    `remote_ids.duplicate_of`; pokus se nepočítá.
11. Rozhodování serializuje **`pg_try_advisory_xact_lock(hash(account_id | content_hash))`**.
    Ve stejné dávce (stejná transakce) je zámek re-entrantní → druhá kopie vidí první jako
    `publishing` a rovnou skončí `failed`. Drží-li zámek **souběžný** claim, kopie se v tomto
    běhu přeskočí (zůstane `scheduled`, nic se nečeká) a odmítne ji další běh. Blokující
    `pg_advisory_xact_lock`, jak stálo v zadání, jsem nepoužil: dvě souběžné dávky s různými
    obsahy by se mohly zaseknout navzájem (deadlock — každá drží zámek, na který čeká druhá).
    Kontroluje se každý naplánovaný příspěvek (i s rozpracovaným `remote_state`), ne
    pokračování kontejneru (claim b). Kurzor se čte po jednom řádku (`FETCH`), protože smyčka
    `FOR` v plpgsql přednačítá po 10 a zamkla by víc řádků, než vezme. Kontrola v Edge funkci
    (`jePodezrelaDuplicita`, `najdiDuplicity`) je odstraněná — byla by druhá, slabší kopie.

### Přechody stavů a klient
12. „service_role smí vše“ = cokoli, co neběží pod rolí `authenticated`/`anon` (service_role,
    postgres z cronu a SQL editoru, funkce security definer). Funkce `public.je_klient()`.
13. Nový příspěvek od klienta: systémové sloupce (`external_id`, `attempt_count`, `remote_state`,
    `last_error_*`, `lock_*`, `step`, `published_at`…) se **tiše nastaví na výchozí** — kopie
    příspěvku je nepřenese. Úprava systémového sloupce u existujícího → chyba.
14. `failed → draft` vynuluje pokusy stejně jako `failed → scheduled`. Obojí vynuluje
    i `error_resolved_at`; `publisher_finish` s výsledkem `failed`, `release_stale_posts`
    i odmítnutí duplicity v claimu taky — opakovaná chyba se tak znovu ukáže na stránce Chyby.
15. Změna obsahu (`caption`, `format`, `link_url`, `account_id` nebo `post_media`) u
    `draft`/`scheduled`/`failed` zahodí `remote_state` a vynuluje `step`, `attempt_count`
    a `next_attempt_at` — jiný obsah je nový příspěvek (jinak by se zveřejnil starý IG kontejner).
    Důsledek: kdo po nejistém výsledku upraví text a pustí znovu, ztratí pojistku proti zdvojení.
16. Média příspěvku ve stavu `publishing`/`published` klient měnit nesmí (trigger na post_media).
17. `social_accounts`: klient nesmí zakládat (účty dělá meta-sync), smí mazat (FK z posts
    smazání účtu s příspěvky zablokuje).
18. `app_users`: klient jen čte; majitele zapíše `setup/02_prvni_uzivatel.sql`.
    Doporučeno vypnout registraci v Auth.

### Publikační smyčka
19. Funkce nad rámec SPEC (EXECUTE jen service_role): `publisher_save_progress`,
    `publisher_finish` (oba ověřují `lock_token` a stav `publishing`; vrací false, když zámek
    převzal jiný běh), `publisher_meta_credential()` (id nejnovější Meta credential).
20. `release_stale_posts()` vrací počet a zapíše i řádek do `publish_attempts`
    (`outcome='unknown'`). `remote_state` nechá — při ručním „zkusit znovu“ pak IG nejdřív
    ověří kontejner. Podle SPEC uvolní i `container_processing` (když cron 20 min neběžel),
    i když tam ještě nic nevyšlo.
21. Pauza IG kontejneru: když je `IN_PROGRESS` i **60 minut** po vytvoření → fatal
    `container_timeout`. Jinak by ho claim (b) bral znovu donekonečna (claim obnovuje `locked_at`,
    takže release_stale na něj nedosáhne).
22. `publish_attempts`: jeden řádek za vyřešený běh; pauza (`container_processing`) řádek
    nezapisuje. `error_code` = náš kód (stejný jako `posts.last_error_code`), surový kód Graphu
    je v `remote_ids.graph_error {code, subcode, type, fbtrace_id}`, `fbtrace_id` i přímo
    v `remote_ids.fbtrace_id`. Token chyba → `outcome='fatal_error'`.
23. Po trvalé chybě (fatal) se `remote_state` vyprázdní (zůstává v `publish_attempts.remote_ids`)
    — **kromě** případu, kdy už odešlo zveřejňovací volání (`publish_sent_at`, u FB jakékoli
    zveřejňovací volání): pak zůstává, aby ruční „zkusit znovu“ u IG podle kontejneru poznal,
    že příspěvek vyšel. Po chybě tokenu a dočasné chybě zůstává vždy.
24. Předkontroly → `failed` s kódem: `platform_not_supported` (TikTok), `account_inactive`,
    `not_connected`, `needs_reconnect` (token), `account_missing`. Nečekají ve frontě.
25. Nejistý výsledek: Facebook → `failed` / `unknown_outcome`, bez opakování. Instagram se
    známým kontejnerem → zpět `scheduled` s backoffem (další pokus nejdřív čte stav kontejneru,
    nic nezdvojí); po vyčerpání pokusů `failed` / `unknown_outcome`.
26. Chyba mimo Graph (pád DB, náš kód): před odesláním zveřejnění → retryable `internal_error`,
    po něm → unknown.
27. Publisher zpracuje až 5 příspěvků **souběžně**; IG čeká na kontejner nejvýš 20 s
    (dotaz á 3 s), ale nikdy přes termín běhu. Timeout požadavku 30 s, nahrávání videa/reelu 90 s.
27a. **Termín běhu 110 s od startu** (limit Edge funkce 150 s; pg_net timeout zůstává 150 s).
    Po termínu se nový příspěvek nezačne a dlouhý krok (FB reel upload, FB video přes
    `file_url`, 90 s) se nezačne, když se do termínu nevejde. Příspěvek se vrátí funkcí
    `publisher_return_claim` (jen service_role, ověřuje `lock_token`): běžný → `scheduled`
    a `attempt_count − 1` (claim ho zvýšil), pokračování kontejneru (`step =
    container_processing`) zůstává `publishing` a claim (b) ho vezme po 45 s. `remote_state`
    zůstává, další běh naváže. Krajní případ: naplánovaný příspěvek, který po dočasné chybě
    nese `step = container_processing`, se vrátí jako pokračování — pokus mu zůstane započtený
    jednou, zpracuje se ale celý.
27b. Odklady kvůli nedostatku času (`MaloCasu`) se počítají v `remote_state.odklady_casu`;
    po 10 odkladech je další nedostatek času `failed` / `no_time` („Video se nepodařilo
    začít nahrávat — server neměl ani po 10 pokusech dost času…“). Vrácení na začátku běhu
    (příspěvek se vůbec nezačal) se nepočítá — není to vlastnost příspěvku, ale fronty.

27c. **Zmeškané příspěvky se samy pozdě nezveřejní** (rozhodl koordinátor; uspaný Free projekt,
    výpadek cronu). V `claim_due_posts`: naplánovaný příspěvek, který ještě nebyl zahájen
    (`attempt_count = 0`, `next_attempt_at` prázdné, `remote_state = {}`) a má `scheduled_at`
    víc než **2 h** v minulosti (jediná konstanta `c_zmeskano`), skončí `failed` / `missed`:
    „Příspěvek nevyšel včas (plánovaný čas DD. MM. HH:MM) — server v tu dobu neběžel. Pokud ho
    chcete zveřejnit, naplánujte ho znovu.“ Čas v pásmu účtu (`social_accounts.timezone`,
    výchozí Europe/Prague). Zápis do `publish_attempts` (`fatal_error`, `missed`). Backoff,
    rozpracované příspěvky a pokračování kontejneru se tím neřídí.
    **Doplněk nad zadání:** i poslední úprava (`updated_at`) musí být starší než 2 h. Jinak by
    ruční „zkusit znovu“ (failed → scheduled bez změny času) nebo přeplánování na minulý čas
    skončilo hned znovu jako `missed` — uživatel by příspěvek nemohl pustit bez změny času.
    S doplňkem se takový příspěvek vezme hned (test „zkusit znovu starého příspěvku“).

### Mapování chyb (doplněk k SPEC)
28. Token: 190, 102 a podkódy 458/459/460/463/464/467/492. Retryable: 4/17/32/613
    (`rate_limited`), 1/2 a `is_transient` (`meta_unavailable`), HTTP ≥ 500 — kromě
    neověřitelného zveřejnění na FB, tam unknown (bod 3). HTTP 2xx s prázdným / ne-JSON
    tělem nebo bez očekávaného id (`potvrzeneId`): u zveřejňovacího volání unknown (FB → failed
    `unknown_outcome`, IG → zpět do fronty s kontrolou kontejneru), u přípravného kroku
    retryable — nikdy fatal `graph_error`. Přesně `{}` (HTTP 200) u kteréhokoli zveřejňovacího
    volání (FB feed, fotka, víc fotek, video; IG `media_publish`) i reel finish bez
    `success: true` → unknown; nic se nezapíše jako published. Fatal: 100, 200
    + 10 a 2xx (`permission_denied`), 368, 506, 9/2207042 (`ig_daily_limit`), ostatní neznámé
    kódy (`graph_error` + původní zpráva). Výpadek spojení: běžný krok retryable `network`,
    po odeslání zveřejnění unknown `unknown_outcome`.

### Facebook
29. `carousel` na FB = příspěvek s více fotkami; video v karuselu, video + fotky, víc videí
    → fatal `media_combination`.
30. Odkaz (`link_url`) se u fotek/videa/reelu připojí na konec textu (jen textový příspěvek
    má samostatný parametr `link`).
31. URL reelu `https://www.facebook.com/reel/{video_id}` (SPEC ji neuváděl). U jedné fotky
    `external_id = post_id` (záložně `id`).
32. Prázdný textový příspěvek → fatal `empty_post`. Stránka bez page tokenu → token chyba
    `page_access_missing`.

### Instagram
33. Feed s jedním videem → `REELS` + `share_to_feed=true` (samostatné VIDEO ve feedu Meta zrušila).
    Feed s víc médii → karusel. Bez média → fatal `media_required`. Story bez popisku.
34. Karusel: video děti se před vytvořením rodiče čekají do `FINISHED` (nevím jistě, jestli to
    Meta vyžaduje — bezpečnější varianta).
35. Dohledání po nejistém `media_publish`: popisek se porovnává po ořezání a sjednocení mezer
    **a zároveň** `timestamp` příspěvku musí být ≥ `publish_sent_at − 1 min` (bez něj
    `container_created_at − 1 min`), aby se nenašel minulý výskyt série se stejným textem.
    Čas Instagramu `…+0000` se převádí na `…+00:00`.
    Nenajde-li se (nebo jde o story, která v `/media` není), příspěvek se označí `published`
    **bez** `external_id`/`external_url` — kontejner `PUBLISHED` je rozhodující.
36. JPEG se kontroluje podle `mime_type` (bez něj podle přípony) → fatal `image_not_jpeg`.
37. Selhání dotazu na permalink po úspěšném zveřejnění není chyba (published bez odkazu).

### Šablona série
37a. Šablona série (`post_series.template_post_id`) nesmí být `scheduled` — publikovala by se
    navíc k výskytům. Trigger odmítne založit/přepnout sérii nad naplánovaným příspěvkem
    a odmítne naplánovat příspěvek, který je šablonou (pro všechny role, i service_role).

### Účty
38. meta-sync: IG `name = username`; upsert nemění `color/timezone/is_active`; stránkování
    po 100, nejvýš 10 stran. Dřív propojené účty, které klíč už nevidí → `needs_reconnect`.
39. check-accounts: nejdřív `GET /me` (platnost klíče); 190 → všechny účty s tím klíčem
    `needs_reconnect`; jiná chyba jen `last_check_error`. `quota` =
    `{ig_used, ig_limit, ig_window_seconds, checked_at}`.

### Bezpečnost a nasazení
40. Token jde v hlavičce **`Authorization: Bearer`** (GET i POST), ne v URL ani v těle — Deno
    ve zprávě o selhání fetch uvádí celou URL. Každý text chyby (GraphChyba, chyba mimo Graph,
    tedy i `last_error_message`, `publish_attempts.error_message` a `last_check_error`) navíc
    prochází `ocistiText()`: URL → `[URL]`, `access_token=…`, `access_token%3D…`
    i JSON `"access_token":"…"` → `***`, `Bearer/OAuth <token>` → `***`. Mock v testech hází chybu s celou URL jako Deno, varianta `sit-token` i s tokenem.
    Reel upload na `rupload.facebook.com` dál podle podkladů `Authorization: OAuth <page token>`.
    `attached_media` jde jako JSON řetězec ve form poli — **neověřeno proti živému API**.
41. `CRON_SECRET` musí mít aspoň 24 znaků (setup vyžaduje 32), porovnává se v konstantním čase.
    `publisher` a `check-accounts` mají `verify_jwt = false` (`supabase/config.toml`), protože
    CRON_SECRET není JWT — jinak by je brána odmítla dřív, než se dostanou ke slovu.
42. **Storage politiky jsou v migraci 0007**, bucket v `setup/01`. Politiky jsou práva —
    mají být verzované a testované a platit hned, jak bucket vznikne. Bucket má nastavení
    (limit, typy) a zakládá se ručně; limit je teď 50 MB kvůli plánu Free (bod 45).
43. `secure.credentials`: `unique nulls not distinct (provider, label)` — podle toho
    `admin_set_credential` aktualizuje místo zakládání dalšího. Secret ve Vaultu má
    generované jméno (`credential_meta_…`).
44. pg_net timeout 150 s (publisher může čekat na IG). Úklid `cron.job_run_details`
    starších 7 dní jako čtvrtá úloha.

### Plán Free (projekt zatím zdarma, později Pro)
45. **Limit souboru 50 MB** (bucket `media` = 52428800 B, víc Free plán nepovolí). Po přechodu
    na Pro: zvednout globální limit v Dashboard → Storage → Settings a pustit
    `update storage.buckets set file_size_limit = 1073741824 where id = 'media';` (návod
    v `setup/01_bucket_media.sql`, test ten příkaz skutečně pouští). Do té doby video nad 50 MB
    nejde nahrát vůbec.
46. **Uspání projektu po 7 dnech nečinnosti** (Free). pg_cron volá každou minutu Edge funkci
    `publisher` přes pg_net. **Nevíme, jestli to Supabase počítá jako aktivitu** — sledovat
    (upozornění e-mailem před uspáním, Dashboard). Uspaný projekt nepublikuje nic, naplánované
    příspěvky zmeškané o víc než 2 h po probuzení nevyjdou — skončí `failed` / `missed` (bod 27c).
47. **Strop Edge funkce 150 s** (Free) — ověřeno podle kódu, nic jsem neměnil:
    - `publisher`: termín 110 s; dlouhé kroky (90 s) se po termínu nezačínají. V krajním případě,
      kdy by Meta odpovídala až těsně před 30s timeoutem u každého volání, by konec IG
      publikace (stav kontejneru → `media_publish` → permalink, každé ≤ 30 s) mohl přesáhnout
      150 s; běžně volání trvají pod sekundu. Když funkci platforma utne, příspěvek zůstane
      `publishing` a `release_stale_posts` ho po 20 min označí jako nejistý.
    - `meta-sync`: 1 volání Graph (`/me/accounts`, ≤ 30 s; stránkování po 100 — u 3 stránek
      jedna strana) + několik dotazů do DB. Hluboko pod 150 s.
    - `check-accounts`: volání jdou za sebou: `/me` + 1 na FB stránku + 2 na Instagram =
      u 3 FB + 1 IG 6 volání. Běžně pár sekund. **Jen kdyby Meta u všech visela až do timeoutu
      30 s, vyšlo by to na ~180 s > 150 s** — funkce by se utnula, už zkontrolované účty zůstanou
      zapsané, zbytek se zkontroluje další den (nic se nerozbije). Neměnil jsem; kdyby to vadilo,
      stačí termín jako u publisheru nebo kratší timeout.

## Skupiny (0008_skupiny.sql, setup/06, podle SPEC-SKUPINY.md)
48. 0008 jde pustit nad nasazeným stavem 0001–0007 a nic z nich nemění; používá
    `is_app_user()`, `nastav_updated_at()`, `media_assets`, `auth.users`. Testy ji pouští po
    0001–0007 na čisté databázi (PG 17.10 + napodobenina Supabase).
49. Varianty textu hlídá funkce `varianty_platne(text[])` (1–3, žádná null ani jen mezery) —
    v check constraintu nejde poddotaz. Nad SPEC: `fb_groups.name` a `group_campaigns.title`
    nesmí být prázdné; `variant_index` 0–2; `batch_no ≥ 1`.
50. `push_subscriptions`: politiky select/insert/delete jen vlastní (`user_id = auth.uid()`
    + `is_app_user()`). **Nad SPEC i update** (taky jen vlastní a jen na sebe), aby UI mohlo
    upsertovat stejný endpoint při novém přihlášení. Testy ověřují i dotazy bez WHERE, kde
    platí jen politika update/delete (select politika je nemaskuje).
51. Trigger úkolů: `done_at = now()` při `sent` **i `skipped`**, při návratu na `pending` null.
    Před počítáním pending úkolů **zamkne řádek kampaně** (`for update`) — dva poslední úkoly
    odškrtnuté naráz ze dvou spojení by jinak nechaly kampaň `active` (test se dvěma spojeními).
    `fb_groups.last_sent_at` se přepočítá jako poslední `done_at` odeslaných úkolů skupiny —
    „Zpět“ tak vrátí předchozí hodnotu (i z dřívější kampaně), ne „teď“. Kampaň bez pending
    úkolů → `done`; „Zpět“ u hotové → zase `active`; zrušená (`cancelled`) se nemění.
52. `create_group_campaign` je **security definer** (oprava po kontrole: dávky klient
    nesmí zapisovat, viz 55) a hned na začátku ověří `is_app_user()` („Nemáte přístup do
    aplikace.“). Všechny politiky skupin jsou `is_app_user()`, takže výsledek je stejný jako
    s RLS (SPEC říká invoker — rozdíl je jen v tom, kdo dávky zapisuje). Skupiny v pořadí pole; opakované id v poli se bere jednou (první
    výskyt), neaktivní, neexistující a pro uživatele neviditelné (RLS) se přeskočí; varianta =
    pořadí mezi zařazenými skupinami % počet variant. `p_batch_size`/`p_batch_interval_minutes`
    null → 20 / 120. Média od pozice 0 v pořadí pole. Bez dočasné tabulky (klient nemusí mít
    právo TEMP). Chyby česky (`22023`), vše v jedné transakci (chyba = nic se nezaloží).
53. `due_group_batches(p_limit)` vrací `batch_id, campaign_id, campaign_title, batch_no,
    batch_count, due_at, pending_count`. Zmeškané (> 12 h, jediná konstanta `c_zmeskano`) jen
    označí. **Nad SPEC:** dávka bez pending úkolů (uživatel ji udělal dřív) se taky jen označí
    a nevrátí — notifikace „0 skupin čeká“ nemá smysl. Dávky zrušených kampaní se neoznačují.
    Souběh: `for update of x skip locked` + update v téže transakci → druhé volání dávku
    nevrátí (test se dvěma spojeními i se čtyřmi souběžnými).
54. `setup/06_cron_skupiny.sql` ukládá i secret do Vaultu (`subbau_vercel_cron_secret`) —
    nikde jinde se neukládal. Hlídá placeholder domény i jejího tvaru (bez `https://`,
    bez lomítka) a secretu (min. 32 znaků). Při opakování smí secret zůstat placeholderem,
    pak se ve Vaultu nemění. Úloha `subbau-skupiny`, každou minutu, timeout 30 s.

55. **`group_batches` klient jen čte** (grant SELECT a jen select politika). Kdyby směl
    měnit `notified_at`, vynutil by si opakované notifikace. Dávky zakládá
    `create_group_campaign`, značí `due_group_batches`, uvolňuje `release_group_batch`;
    smazání kampaně je smaže kaskádou.
56. **`release_group_batch(p_batch_id uuid) returns boolean`** — jen service_role. Cron route
    ji zavolá, když se notifikace dávky nedoručila na žádný odběr: vrátí `notified_at = null`,
    jen když je kampaň `active` a dávka má pending úkoly (jinak false, nic nemění). Další běh
    `due_group_batches` dávku vrátí znovu; strop 12 h platí dál (zmeškaná se zase jen označí).

## Co ověřit nešlo
- **Deno není nainstalované** → Edge funkce (`publisher`, `meta-sync`, `check-accounts`, `_deno/`)
  prošly jen `tsc --noEmit` (strict) s minimálním shimem `Deno.env/serve` a skutečnými typy
  `@supabase/supabase-js@2.117.3` (namapované z `npm:`). Neběžely v Deno runtime.
  `_shared` prochází tsc bez shimu → Deno API v něm být nemůže (mutace to ověřila).
- **Živé Graph API** — vše jen proti mocku podle podkladů v zadání.
- **pg_cron, pg_net, Vault, Storage** — v testech napodobeniny (`tests/stubs.sql`,
  `tests/stubs_cron.sql`); šifrování Vaultu, podepsané URL a skutečné volání cronu ne.
- Jestli Edge funkce doběhne, když pg_net po 150 s spojení zavře (limit Free 150 s, placený 400 s).
- Jestli minutové volání z pg_cron brání uspání projektu na plánu Free (bod 46).
- 0008 a setup 06 na ostrém projektu (PG 17.11, skutečný pg_cron/pg_net/Vault) — jen na
  zkušebním PG 17.10 s napodobeninou. Vercel route `/api/cron/skupiny` a Web Push nejsou
  moje část.
- Že Graph API bere `Authorization: Bearer` u všech použitých volání — podle koordinátora ano,
  živě neověřeno.

## Dodatek pro UI agenta (nic z toho SPEC nemění)
- Chyby triggerů jsou česky (`P0001`) — dají se ukázat přímo.
- Kódy `last_error_code`: `duplicate_suspected`, `unknown_outcome`, `token_invalid`,
  `needs_reconnect`, `page_access_missing`, `rate_limited`, `meta_unavailable`, `network`,
  `invalid_parameter`, `permission_denied`, `blocked`, `duplicate_rejected`, `ig_daily_limit`,
  `graph_error`, `internal_error`, `format_not_supported`, `platform_not_supported`,
  `media_combination`, `media_required`, `carousel_count`, `image_not_jpeg`, `empty_post`,
  `container_error`, `container_expired`, `container_timeout`, `account_inactive`,
  `not_connected`, `account_missing`, `no_time`, `missed`.
- Pro „Načíst účty“: `supabase.functions.invoke('meta-sync', { method: 'POST' })` →
  `{nacteno: [{platform, external_id, name}], odpojeno}`; 400 = chybí/neplatný klíč.
