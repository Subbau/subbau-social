-- 0001 — základ: enumy, tabulky, indexy, omezení.
-- Práva (RLS, granty) jsou v 0002, triggery v 0003, publikační funkce v 0004.
-- Názvy tabulek a sloupců přesně podle SPEC.md.

-- ---------------------------------------------------------------- enumy
create type public.platform as enum ('facebook', 'instagram', 'tiktok');
create type public.post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed');
create type public.post_format as enum ('feed', 'reel', 'story', 'carousel');

-- ---------------------------------------------------------------- app_users
create table public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  role text not null default 'admin' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- secure
-- Schéma se nevystavuje přes API (v Supabase API settings ho NEPŘIDÁVAT).
create schema if not exists secure;

create table secure.credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'tiktok')),
  label text,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  constraint credentials_provider_label_key unique nulls not distinct (provider, label)
);

-- ---------------------------------------------------------------- social_accounts
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform public.platform not null,
  external_id text not null,
  name text not null,
  username text,
  avatar_url text,
  color text not null default '#2563eb',
  timezone text not null default 'Europe/Prague',
  is_active boolean not null default true,
  connection_status text not null default 'not_connected'
    check (connection_status in ('connected', 'needs_reconnect', 'not_connected')),
  credential_id uuid null references secure.credentials (id),
  linked_page_external_id text null,
  quota jsonb not null default '{}',
  token_expires_at timestamptz,
  last_checked_at timestamptz,
  last_check_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);

-- ---------------------------------------------------------------- account_time_slots
create table public.account_time_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  time_of_day time not null,
  unique (account_id, weekday, time_of_day)
);

-- ---------------------------------------------------------------- media_assets
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null references public.social_accounts (id) on delete set null,
  storage_path text not null unique,
  kind text check (kind in ('image', 'video')),
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  duration_seconds numeric,
  fingerprint text not null,
  thumbnail_path text,
  original_name text,
  tags text[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index media_assets_account_idx on public.media_assets (account_id);
create index media_assets_fingerprint_idx on public.media_assets (fingerprint);

-- ---------------------------------------------------------------- text_snippets
create table public.text_snippets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null references public.social_accounts (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index text_snippets_account_idx on public.text_snippets (account_id);

-- ---------------------------------------------------------------- posts + post_series
-- posts a post_series na sebe odkazují navzájem → posts nejdřív bez series FK.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id),
  group_id uuid null,
  series_id uuid null,
  copied_from_id uuid null references public.posts (id) on delete set null,
  format public.post_format not null default 'feed',
  caption text not null default '',
  link_url text null,
  scheduled_at timestamptz null,
  status public.post_status not null default 'draft',
  platform_options jsonb not null default '{}',
  content_hash text,
  external_id text,
  external_url text,
  published_at timestamptz,
  attempt_count int not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  step text,
  remote_state jsonb not null default '{}',
  last_error_code text,
  last_error_message text,
  error_resolved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_scheduled_needs_time check (status <> 'scheduled' or scheduled_at is not null)
);

create table public.post_series (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id),
  template_post_id uuid references public.posts (id) on delete set null,
  freq text not null check (freq in ('weekly', 'monthly')),
  interval_n int not null default 1 check (interval_n > 0),
  weekdays smallint[],
  month_day smallint check (month_day between 1 and 31),
  time_of_day time not null,
  timezone text not null default 'Europe/Prague',
  starts_on date not null,
  until_on date null,
  horizon_weeks int not null default 8 check (horizon_weeks between 1 and 104),
  is_active boolean not null default true,
  -- Nad rámec SPEC (viz ROZHODNUTI.md): do kterého dne (v časovém pásmu série)
  -- už jsou výskyty vygenerované. Smazaný nebo přesunutý výskyt se tak denním
  -- prodloužením znovu nevytvoří. Změna rozvrhu série ho vynuluje (trigger 0003).
  generated_until date null,
  created_at timestamptz not null default now(),
  constraint post_series_weekly_needs_days check (
    freq <> 'weekly' or (weekdays is not null and cardinality(weekdays) > 0
                         and weekdays <@ array[1,2,3,4,5,6,7]::smallint[])),
  constraint post_series_monthly_needs_day check (freq <> 'monthly' or month_day is not null)
);

alter table public.posts
  add constraint posts_series_id_fkey foreign key (series_id)
  references public.post_series (id) on delete set null;

create unique index posts_account_external_id_key
  on public.posts (account_id, external_id) where external_id is not null;
create unique index posts_series_scheduled_at_key
  on public.posts (series_id, scheduled_at) where series_id is not null;

-- Publikační smyčka hledá splatné a rozpracované příspěvky.
create index posts_due_idx on public.posts (scheduled_at)
  where status = 'scheduled';
create index posts_publishing_idx on public.posts (locked_at)
  where status = 'publishing';
-- Kontrola duplicity (stejný účet + content_hash mezi zveřejněnými).
create index posts_duplicate_idx on public.posts (account_id, content_hash, published_at)
  where status = 'published';
create index posts_account_idx on public.posts (account_id, scheduled_at);
create index posts_group_idx on public.posts (group_id) where group_id is not null;
create index posts_copied_from_idx on public.posts (copied_from_id) where copied_from_id is not null;
create index post_series_account_idx on public.post_series (account_id);
create index post_series_template_idx on public.post_series (template_post_id);

-- ---------------------------------------------------------------- post_media
create table public.post_media (
  post_id uuid not null references public.posts (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete restrict,
  position smallint not null,
  primary key (post_id, position)
);
create index post_media_asset_idx on public.post_media (asset_id);

-- ---------------------------------------------------------------- publish_attempts
create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  step text,
  outcome text check (outcome in ('success', 'retryable_error', 'fatal_error', 'unknown')),
  http_status int,
  error_code text,
  error_message text,
  error_message_cs text,
  remote_ids jsonb,
  created_at timestamptz not null default now()
);
create index publish_attempts_post_idx on public.publish_attempts (post_id, started_at desc);

-- ---------------------------------------------------------------- audit_log
create table public.audit_log (
  id bigserial primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
