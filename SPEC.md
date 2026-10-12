# SubBau Social Manager — společné zadání (kontrakt mezi DB a UI)

Interní webová appka jedné firmy (SubBau) pro plánování a automatické publikování
příspěvků na **3 Facebook stránky a 1 Instagram**. TikTok je **odložen** — v enumu
`platform` existuje, ale nic se pro něj neimplementuje (publisher ho odmítne kódem
`platform_not_supported`). Používá ji **jeden člověk** (majitel, admin). UI česky.

Stack: Next.js (App Router, TypeScript, Tailwind) na Vercelu, Supabase (Postgres, Auth,
Storage, Vault, Edge Functions, pg_cron + pg_net). Supabase projekt je **nový a samostatný**
— žádné vazby na jiné projekty.

**Nic se nenasazuje, nepushuje ani nevolá na skutečné API.** Žádné skutečné klíče.

## Rozložení repozitáře

```
/                      Next.js appka (vlastní package.json)         ← UI agent
/supabase/migrations   SQL migrace 0001_*.sql …                     ← DB agent
/supabase/functions    Edge funkce (Deno): publisher, meta-sync,
                       check-accounts, _shared/ (čistá logika)      ← DB agent
/supabase/setup        SQL, které majitel pustí ručně po založení
                       (pg_cron, bucket, uložení klíče)            ← DB agent
/supabase/tests        vlastní package.json: vitest, embedded-postgres, pg ← DB agent
/SPEC.md               tento soubor (neměnit; nejasnosti hlásit)
```

## Databáze (schema public, není-li řečeno jinak)

Enumy:
- `platform`: `facebook`, `instagram`, `tiktok`
- `post_status`: `draft`, `scheduled`, `publishing`, `published`, `failed`
  (UI: koncept, naplánováno, publikuje se, zveřejněno, chyba)
- `post_format`: `feed`, `reel`, `story`, `carousel`

### app_users
`id uuid pk → auth.users(id) on delete cascade`, `email text`, `name text`,
`role text not null default 'admin' check (role in ('admin','editor'))`, `created_at`.
Funkce `public.is_app_user() returns boolean` (security definer, stable, search_path pevný):
existuje řádek s `id = auth.uid()`. **Každá RLS politika všech tabulek níže = `is_app_user()`.**
anon nemá nic. Přihlášený, ale nezapsaný v app_users, nevidí nic.

### social_accounts
`id uuid pk default gen_random_uuid()`, `platform platform not null`,
`external_id text not null` (FB page id / IG user id), `name text not null`,
`username text`, `avatar_url text`, `color text not null default '#2563eb'`,
`timezone text not null default 'Europe/Prague'`, `is_active boolean not null default true`,
`connection_status text not null default 'not_connected'
  check in ('connected','needs_reconnect','not_connected')`,
`credential_id uuid null → secure.credentials(id)`,
`linked_page_external_id text null` (u IG: FB stránka, přes kterou je propojen),
`quota jsonb not null default '{}'` (např. `{"ig_used":3,"ig_limit":100,"checked_at":…}`),
`token_expires_at timestamptz`, `last_checked_at timestamptz`, `last_check_error text`,
`created_at`, `updated_at`. `unique(platform, external_id)`.
Klient smí měnit jen `color`, `timezone`, `is_active` (ostatní jen service_role — triggerem).

### secure schema (není vystavené přes API)
`secure.credentials(id uuid pk, provider text check in ('meta','tiktok'), label text,
vault_secret_id uuid not null, created_at)`. Token leží **jen ve Vaultu**.
Funkce v `public`, `EXECUTE` **jen pro service_role** (revoke z public/anon/authenticated):
- `public.admin_set_credential(p_provider text, p_label text, p_token text) returns uuid`
  — založí/aktualizuje vault secret, vrátí credential id.
- `public.publisher_get_token(p_credential_id uuid) returns text`.

### account_time_slots
`id`, `account_id → social_accounts on delete cascade`, `weekday smallint check 1..7`
(ISO, 1 = pondělí), `time_of_day time not null`, `unique(account_id, weekday, time_of_day)`.

### media_assets
`id`, `account_id uuid null → social_accounts on delete set null` (null = sdílené),
`storage_path text not null unique` (bucket `media`, privátní),
`kind text check in ('image','video')`, `mime_type text`, `size_bytes bigint`,
`width int`, `height int`, `duration_seconds numeric`, `fingerprint text not null`,
`thumbnail_path text`, `original_name text`, `tags text[] not null default '{}'`,
`created_by uuid default auth.uid()`, `created_at`.

**fingerprint** = hex sha256 celého souboru, je-li ≤ 50 MB; jinak
`hex sha256(prvních 8 MiB) + ':' + size_bytes`.

### text_snippets
`id`, `account_id null → social_accounts on delete cascade`, `title text not null`,
`body text not null`, `created_at`, `updated_at`.

### posts — jeden řádek = jeden účet + jeden čas
`id`, `account_id not null → social_accounts`, `group_id uuid null` (varianty
založené spolu pro víc účtů), `series_id uuid null → post_series on delete set null`,
`copied_from_id uuid null → posts on delete set null`,
`format post_format not null default 'feed'`, `caption text not null default ''`,
`link_url text null`, `scheduled_at timestamptz null`,
`status post_status not null default 'draft'`,
`platform_options jsonb not null default '{}'` (např. `{"allow_duplicate":true}`),
`content_hash text`, `external_id text`, `external_url text`, `published_at timestamptz`,
`attempt_count int not null default 0`, `next_attempt_at timestamptz`,
`locked_at timestamptz`, `lock_token uuid`, `step text`,
`remote_state jsonb not null default '{}'` (container_id, video_id … uložené po každém kroku),
`last_error_code text`, `last_error_message text` (česky), `error_resolved_at timestamptz`,
`created_by uuid default auth.uid()`, `created_at`, `updated_at`.

Omezení:
- `status <> 'scheduled' or scheduled_at is not null`
- unique `(account_id, external_id) where external_id is not null`
- unique `(series_id, scheduled_at) where series_id is not null`

**content_hash** = hex sha256 řetězce
`account_id + '|' + format + '|' + normalize(caption) + '|' + fingerprinty médií v pořadí position spojené ','`,
kde `normalize` = trim, sjednocení bílých znaků na jednu mezeru, lowercase (JS `toLocaleLowerCase('cs-CZ')`).
Počítá UI při každém uložení.

Přechody stavů (trigger; service_role smí vše):
- klient: `draft ↔ scheduled`, `failed → scheduled | draft`, nový řádek jen `draft|scheduled`.
- klient **nesmí** měnit řádek ve stavu `publishing`; u `published` smí jen
  `error_resolved_at` (nic jiného). Mazání `publishing` a `published` zakázané.
- při klientském `failed → scheduled` se vynuluje `next_attempt_at`, `step`,
  `last_error_*` zůstanou pro historii; `attempt_count` se vynuluje.

### post_media
`post_id → posts on delete cascade`, `asset_id → media_assets on delete restrict`,
`position smallint not null`, `primary key(post_id, position)`.

### post_series — opakování
`id`, `account_id not null`, `template_post_id uuid → posts on delete set null`,
`freq text check in ('weekly','monthly')`, `interval_n int not null default 1 check > 0`,
`weekdays smallint[]` (weekly; ISO), `month_day smallint` (monthly, 1..31; když měsíc
den nemá → poslední den měsíce), `time_of_day time not null`,
`timezone text not null default 'Europe/Prague'`, `starts_on date not null`,
`until_on date null`, `horizon_weeks int not null default 8`,
`is_active boolean not null default true`, `created_at`.

`public.generate_series_occurrences(p_series_id uuid) returns int` — vytvoří chybějící
výskyty od max(dnes, starts_on) do min(until_on, dnes + horizon) jako kopie šablony
(caption, format, link_url, platform_options, post_media) se stavem `scheduled`;
čas = `time_of_day` v **místním čase timezone** (přechod letní/zimní čas se nesmí rozbít).
Idempotentní díky unique(series_id, scheduled_at). Volatelné přihlášeným app_user.

### publish_attempts
`id`, `post_id → posts on delete cascade`, `started_at`, `finished_at`, `step text`,
`outcome text check in ('success','retryable_error','fatal_error','unknown')`,
`http_status int`, `error_code text`, `error_message text` (surově z platformy),
`error_message_cs text`, `remote_ids jsonb`, `created_at`. Klient jen čte.

### audit_log
`id bigserial`, `actor uuid`, `action text`, `entity text`, `entity_id uuid`,
`details jsonb`, `created_at`. Trigger na posts (insert/update stavu nebo času/delete).
Klient jen čte.

## Publikační smyčka (service_role)

- `public.claim_due_posts(p_limit int default 5) returns setof posts`:
  a) `scheduled` s `scheduled_at <= now()` a (`next_attempt_at` null nebo ≤ now()),
  b) `publishing` se `step = 'container_processing'` a `locked_at < now() - interval '45 seconds'`;
  `for update skip locked`, nastaví `status='publishing'`, `locked_at=now()`,
  nový `lock_token`; u (a) `attempt_count + 1`.
- `public.release_stale_posts()` — `publishing` s `locked_at < now() - interval '20 minutes'`
  → `failed`, `last_error_code='unknown_outcome'`, česká zpráva „Nevíme, jestli
  příspěvek vyšel — zkontrolujte stránku, než ho pustíte znovu.“ **Bez automatického opakování.**
- Dočasná chyba → zpět `scheduled`, `next_attempt_at = now() + 2 / 10 / 30 min`
  podle attempt_count; po 3. pokusu `failed`.
- Před publikací: existuje-li na stejném účtu jiný post `published` se stejným
  `content_hash` za posledních 30 dní a `platform_options.allow_duplicate` není true
  → `failed`, kód `duplicate_suspected`.
- Chyba tokenu (Graph 190) → účet `needs_reconnect` a post `failed`.
- Edge funkce `publisher` se volá z pg_cron každou minutu přes pg_net s hlavičkou
  `Authorization: Bearer <CRON_SECRET>`; jinak 401.
- Média: dočasné podepsané URL z bucketu `media` (platnost 1 h).

## Obrazovky (UI)

`/login`, `/kalendar` (týden/měsíc), `/prispevky/novy`, `/prispevky/[id]`, `/seznam`,
`/chyby`, `/media`, `/texty`, `/ucty`. Vše kromě /login jen pro přihlášeného app_usera.
Časy se zobrazují v časovém pásmu účtu (Europe/Prague).
