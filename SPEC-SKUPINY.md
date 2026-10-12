# SubBau Social Manager — Skupiny (kontrakt DB ↔ UI)

## Proč a co
Majitel chce dostávat náborové příspěvky do ~160 facebookových skupin, kde je **jen členem**.
Meta zrušila publikování do skupin přes API (22. 4. 2024) a automatizace osobního účtu (robot
v prohlížeči) porušuje pravidla Facebooku a hrozí zablokováním účtu → **nestavíme žádné
automatické odesílání do skupin.** Stavíme **asistenta pro ruční sdílení z telefonu**:
appka připraví dávku skupin, v čas pošle notifikaci do telefonu, a na obrazovce „Skupiny dnes“
jedním klepnutím zkopíruje text + otevře sdílení obrázku + otevře skupinu; uživatel jen vloží
a odešle ve Facebooku a v appce odškrtne.

Kvůli spamové ochraně Facebooku: dávky rozložené v čase (výchozí 20 skupin, odstup 120 min),
2–3 varianty textu, které se střídají po skupinách.

## Databáze (migrace `supabase/migrations/0008_skupiny.sql`)
Vše RLS `public.is_app_user()` jako ostatní tabulky; granty pro authenticated jako v 0002;
service_role vše. Nic pro anon.

- `fb_groups`: `id uuid pk`, `name text not null`, `url text null` (https://www.facebook.com/groups/…),
  `sady text[] not null default '{}'` (štítky, např. „OSVČ Německo“), `is_active boolean not null default true`,
  `note text` (pravidla skupiny), `last_sent_at timestamptz`, `created_at`, `updated_at`.
  Stejné `name` může být víckrát (FB má víc skupin stejného jména) — žádný unique na name;
  unique na `url` where url is not null.
- `group_campaigns` (rozesílka): `id`, `title text not null`, `variants text[] not null`
  (1–3 texty, check cardinality 1..3, žádný prázdný), `starts_at timestamptz not null`,
  `batch_size int not null default 20 check 1..100`, `batch_interval_minutes int not null default 120 check 15..1440`,
  `status text not null default 'active' check in ('active','done','cancelled')`,
  `created_by uuid default auth.uid()`, `created_at`.
- `group_campaign_media`: `campaign_id → group_campaigns on delete cascade`, `asset_id → media_assets on delete restrict`,
  `position smallint`, pk(campaign_id, position).
- `group_batches`: `id`, `campaign_id → cascade`, `batch_no int not null`, `due_at timestamptz not null`,
  `notified_at timestamptz null`, unique(campaign_id, batch_no).
- `group_tasks`: `id`, `campaign_id → cascade`, `batch_id → group_batches cascade`, `group_id → fb_groups on delete cascade`,
  `variant_index smallint not null`, `status text not null default 'pending' check in ('pending','sent','skipped')`,
  `done_at timestamptz`, unique(campaign_id, group_id).
  Trigger: při `status → sent` nastaví `done_at=now()` a `fb_groups.last_sent_at=now()`; když všechny tasky
  kampaně nejsou `pending`, kampaň → `done`.
- `public.create_group_campaign(p_title text, p_variants text[], p_asset_ids uuid[], p_group_ids uuid[],
  p_starts_at timestamptz, p_batch_size int, p_batch_interval_minutes int) returns uuid` — security invoker
  (RLS platí), v jedné transakci: kampaň, média, dávky (`due_at = starts_at + (batch_no-1)*interval`),
  tasky (skupiny v pořadí pole; `variant_index = pořadí % cardinality(variants)`). Neaktivní skupiny přeskočí.
  Prázdné skupiny/varianty → chyba česky.
- `push_subscriptions`: `id`, `user_id uuid not null default auth.uid() → auth.users cascade`,
  `endpoint text not null unique`, `p256dh text not null`, `auth text not null`, `user_agent text`, `created_at`.
  RLS: app_user vidí a maže jen své (user_id = auth.uid()) a vkládá jen se svým user_id.
- `public.due_group_batches(p_limit int default 10)` — **jen service_role**: vrátí dávky s
  `due_at <= now()` a `notified_at is null` u kampaní `active`, s počtem pending tasků, a **atomicky** jim nastaví
  `notified_at = now()` (update … returning, `for update skip locked`), aby se notifikace neposlala dvakrát.
  Dávka starší než 12 h se označí, ale nevrátí (zmeškaná — neposílat noční spam).

Setup `supabase/setup/06_cron_skupiny.sql`: pg_cron každou minutu → `net.http_post` na
`https://<<DOPLNIT VERCEL DOMÉNA>>/api/cron/skupiny` s `Authorization: Bearer <secret z Vaultu 'subbau_vercel_cron_secret'>`,
timeout 30000. Hlídá placeholder jako ostatní setup soubory.

## Server (Next.js na Vercelu, Node runtime)
- `src/app/api/cron/skupiny/route.ts` (POST): ověří `Authorization: Bearer ${VERCEL_CRON_SECRET}` (konstantní čas,
  min. 32 znaků, jinak 401). Klient Supabase se `SUPABASE_SECRET_KEY` (server-only env, NIKDY `NEXT_PUBLIC_`),
  zavolá `due_group_batches(10)`, pro každou dávku pošle Web Push všem `push_subscriptions`
  (balík `web-push`, VAPID: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:info@subbau.cz`).
  Text: „Skupiny: dávka X z Y — N skupin čeká“, klik otevře `/skupiny/dnes`. Odběr, který vrátí 404/410, smaže.
  Odpověď JSON bez citlivých dat. Route nesmí importovat nic, co by service klíč poslalo do klienta.
- Pokud chybí env, route vrátí 500 s českou hláškou, ale build musí projít bez env.

## UI
- Menu: nová položka **Skupiny** (pod Kalendář).
- `/skupiny` — seznam skupin: hledání, filtr podle sady, přepínač aktivní, úprava názvu/URL/sad/poznámky,
  „Naposledy odesláno“. **Import**: textové pole, kam majitel vloží zkopírovanou stránku facebook.com/groups/joins
  (řádky se jménem skupiny; ignorovat řádky „Naposledy jste tu byl(a)“, „před …“, „Všechny skupiny, ve kterých jste (N)“,
  „Skupiny“, „Skupiny, ve kterých jste“, „Nové upozornění v nastaveních“, prázdné), případně řádky `název<TAB>url`.
  Náhled před uložením (počet, duplicity jmen označit), uložit hromadně. Už existující (stejné url, nebo stejné jméno bez url)
  znovu nevkládat.
- `/skupiny/nova` — nová rozesílka: název, 1–3 varianty textu (vložení šablony z text_snippets), média z knihovny
  (obrázky; video povolit, ale upozornit, že do skupin se z telefonu sdílí hůř), výběr skupin (podle sady / ručně,
  „vybrat vše aktivní“), start, velikost dávky, odstup. Náhled rozpisu dávek (časy). Zavolá `create_group_campaign`.
  Z editoru příspěvku tlačítko „Poslat i do skupin“ → předvyplní text a média.
- `/skupiny/dnes` — **telefon na prvním místě** (375 px). Aktuální dávky (due_at <= now, pending tasky), pořadí podle dávky.
  Velká karta jedné skupiny: název, ukazatel „7 / 20 v dávce · 31 / 160 celkem“, varianta textu.
  Tlačítko **„Sdílet do skupiny“**: v jednom klepnutí `navigator.clipboard.writeText(text)` a pak
  `navigator.share({ files: [obrázek jako File], text })` (kde to jde; jinak stáhnout obrázek); hláška „Text je ve schránce —
  ve Facebooku vyber skupinu, vlož text a odešli.“
  Tlačítko **„Otevřít skupinu“**: `url`, jinak `https://www.facebook.com/search/groups/?q=<název>`.
  Tlačítka **„Odesláno ✓“** (status sent → další skupina) a **„Přeskočit“** (skipped). Zpět o jednu (vrátit na pending).
  Budoucí dávky jen jako seznam s časy.
- `/skupiny/kampane` (nebo sekce na /skupiny): přehled rozesílek, průběh, zrušit (status cancelled).
- **Upozornění do telefonu**: PWA — `public/manifest.webmanifest` (název SubBau Social, display standalone, ikony),
  service worker `public/sw.js` jen pro push (`push` → showNotification, `notificationclick` → otevřít/přepnout na URL);
  žádné cachování stránek. Na `/ucty` nebo `/skupiny` panel „Upozornění v telefonu“: stav, tlačítko Zapnout
  (Notification.requestPermission → pushManager.subscribe s VAPID → insert do push_subscriptions), Vypnout.
  Na iPhonu, když appka neběží jako přidaná na plochu, ukázat návod „Sdílet → Přidat na plochu“ (iOS 16.4+).
- Všechno česky, bez `\u` escapů.
