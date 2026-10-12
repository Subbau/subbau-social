-- 0002 — práva: is_app_user(), RLS na všech tabulkách, granty.
-- Pravidlo ze SPEC: každá RLS politika = is_app_user(). anon nemá nic.
-- Přihlášený, ale nezapsaný v app_users, nevidí nic.
-- Supabase dává výchozími právy všem rolím ALL na nové tabulky a EXECUTE na
-- nové funkce — proto se tu všechno nejdřív bere a pak přidává jen to potřebné.

-- ---------------------------------------------------------------- is_app_user
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users where id = auth.uid());
$$;
revoke all on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated, service_role;

-- ---------------------------------------------------------------- secure
revoke all on schema secure from public, anon, authenticated, service_role;
revoke all on all tables in schema secure from public, anon, authenticated, service_role;
alter table secure.credentials enable row level security;
-- Žádná politika: přes API se do secure nedostane nikdo, jen funkce security definer.

-- ---------------------------------------------------------------- granty v public
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.app_users to authenticated;
grant select, update, delete on public.social_accounts to authenticated;
grant select, insert, update, delete on
  public.account_time_slots,
  public.media_assets,
  public.text_snippets,
  public.posts,
  public.post_media,
  public.post_series
to authenticated;
grant select on public.publish_attempts, public.audit_log to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- RLS
alter table public.app_users          enable row level security;
alter table public.social_accounts    enable row level security;
alter table public.account_time_slots enable row level security;
alter table public.media_assets       enable row level security;
alter table public.text_snippets      enable row level security;
alter table public.posts              enable row level security;
alter table public.post_media         enable row level security;
alter table public.post_series        enable row level security;
alter table public.publish_attempts   enable row level security;
alter table public.audit_log          enable row level security;

-- Jen čtení (zápis dělá service_role nebo triggery security definer).
create policy app_users_select on public.app_users
  for select to authenticated using (public.is_app_user());
create policy publish_attempts_select on public.publish_attempts
  for select to authenticated using (public.is_app_user());
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_app_user());

-- Plný přístup app_usera (co smí měnit v posts a social_accounts, hlídají triggery 0003).
create policy social_accounts_all on public.social_accounts
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy account_time_slots_all on public.account_time_slots
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy media_assets_all on public.media_assets
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy text_snippets_all on public.text_snippets
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy posts_all on public.posts
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy post_media_all on public.post_media
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy post_series_all on public.post_series
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
