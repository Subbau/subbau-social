-- 0008 — Skupiny: asistent pro RUČNÍ sdílení do facebookových skupin (SPEC-SKUPINY.md).
-- Nic tu automaticky nepublikuje do skupin. Appka připraví dávky, pošle upozornění do
-- telefonu a uživatel sdílí sám.
--
-- Pouští se nad nasazeným stavem 0001–0007; ty se nemění. Používá z nich:
-- public.is_app_user(), public.nastav_updated_at(), public.media_assets, auth.users.
--
-- Tabulky: fb_groups, group_campaigns, group_campaign_media, group_batches, group_tasks,
--          push_subscriptions
-- Funkce:  create_group_campaign(...)  (app_user; security definer s kontrolou is_app_user)
--          due_group_batches(n)        (jen service_role)
--          release_group_batch(id)     (jen service_role)

-- ---------------------------------------------------------------- pomocná kontrola variant
-- 1–3 texty, žádný prázdný ani null. V check constraintu nejde poddotaz → funkce.
create or replace function public.varianty_platne(p_variants text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_variants is not null
     and cardinality(p_variants) between 1 and 3
     and not exists (select 1 from unnest(p_variants) as v(t) where v.t is null or btrim(v.t) = '');
$$;
revoke all on function public.varianty_platne(text[]) from public, anon;
grant execute on function public.varianty_platne(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------- tabulky
create table public.fb_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  url text null,
  sady text[] not null default '{}',
  is_active boolean not null default true,
  note text,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Stejné jméno smí být víckrát (FB má víc skupin stejného jména); unikátní je jen URL.
create unique index fb_groups_url_key on public.fb_groups (url) where url is not null;
create index fb_groups_sady_idx on public.fb_groups using gin (sady);

create trigger fb_groups_updated_at before update on public.fb_groups
  for each row execute function public.nastav_updated_at();

create table public.group_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  variants text[] not null constraint group_campaigns_variants_check check (public.varianty_platne(variants)),
  starts_at timestamptz not null,
  batch_size int not null default 20 check (batch_size between 1 and 100),
  batch_interval_minutes int not null default 120 check (batch_interval_minutes between 15 and 1440),
  status text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.group_campaign_media (
  campaign_id uuid not null references public.group_campaigns (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete restrict,
  position smallint not null,
  primary key (campaign_id, position)
);
create index group_campaign_media_asset_idx on public.group_campaign_media (asset_id);

create table public.group_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.group_campaigns (id) on delete cascade,
  batch_no int not null check (batch_no >= 1),
  due_at timestamptz not null,
  notified_at timestamptz null,
  unique (campaign_id, batch_no)
);
create index group_batches_due_idx on public.group_batches (due_at) where notified_at is null;

create table public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.group_campaigns (id) on delete cascade,
  batch_id uuid not null references public.group_batches (id) on delete cascade,
  group_id uuid not null references public.fb_groups (id) on delete cascade,
  variant_index smallint not null check (variant_index between 0 and 2),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  done_at timestamptz,
  unique (campaign_id, group_id)
);
create index group_tasks_batch_idx on public.group_tasks (batch_id, status);
create index group_tasks_group_idx on public.group_tasks (group_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------- práva
-- Supabase dává výchozími právy anon i authenticated ALL → nejdřív vzít, pak přidat potřebné.
revoke all on public.fb_groups, public.group_campaigns, public.group_campaign_media,
              public.group_batches, public.group_tasks, public.push_subscriptions
  from anon, authenticated;
grant select, insert, update, delete on public.fb_groups, public.group_campaigns,
  public.group_campaign_media, public.group_tasks, public.push_subscriptions
  to authenticated;
-- Dávky klient jen čte: kdyby směl měnit notified_at, mohl by si vynutit opakované
-- notifikace. Zakládá je create_group_campaign, značí due_group_batches / release_group_batch.
grant select on public.group_batches to authenticated;
grant all on public.fb_groups, public.group_campaigns, public.group_campaign_media,
             public.group_batches, public.group_tasks, public.push_subscriptions
  to service_role;

alter table public.fb_groups            enable row level security;
alter table public.group_campaigns      enable row level security;
alter table public.group_campaign_media enable row level security;
alter table public.group_batches        enable row level security;
alter table public.group_tasks          enable row level security;
alter table public.push_subscriptions   enable row level security;

create policy fb_groups_all on public.fb_groups
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy group_campaigns_all on public.group_campaigns
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy group_campaign_media_all on public.group_campaign_media
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy group_batches_select on public.group_batches
  for select to authenticated using (public.is_app_user());
create policy group_tasks_all on public.group_tasks
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- Odběry upozornění: každý app_user jen své. Update je navíc nad SPEC (upsert při
-- znovupřihlášení stejného prohlížeče), taky jen vlastní a jen na sebe.
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (public.is_app_user() and user_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated with check (public.is_app_user() and user_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (public.is_app_user() and user_id = auth.uid())
  with check (public.is_app_user() and user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (public.is_app_user() and user_id = auth.uid());

-- ---------------------------------------------------------------- trigger úkolů
-- BEFORE: done_at podle stavu (sent/skipped = teď, zpět na pending = null).
create or replace function public.group_tasks_stav()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.done_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

create trigger group_tasks_stav before update of status on public.group_tasks
  for each row execute function public.group_tasks_stav();

-- AFTER (security definer — mění i fb_groups a group_campaigns):
--  - fb_groups.last_sent_at = poslední odeslání skupiny (při „zpět“ se přepočítá),
--  - kampaň bez pending úkolů → done; „zpět“ u hotové kampaně → zase active.
--    Zrušená (cancelled) kampaň se nemění.
create or replace function public.group_tasks_po_zmene()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  -- Nejdřív zamknout řádek kampaně: dva souběžně odškrtnuté poslední úkoly by jinak oba
  -- napočítaly „ještě jeden pending“ (ten druhý ještě nepotvrzený) a kampaň by zůstala active.
  -- Druhá transakce tu počká, než první skončí, a pak už vidí její změnu.
  perform 1 from public.group_campaigns where id = new.campaign_id for update;

  update public.fb_groups g
     set last_sent_at = (select max(t.done_at) from public.group_tasks t
                          where t.group_id = g.id and t.status = 'sent')
   where g.id = new.group_id;

  if exists (select 1 from public.group_tasks t where t.campaign_id = new.campaign_id and t.status = 'pending') then
    update public.group_campaigns set status = 'active' where id = new.campaign_id and status = 'done';
  else
    update public.group_campaigns set status = 'done' where id = new.campaign_id and status = 'active';
  end if;
  return null;
end;
$$;
revoke all on function public.group_tasks_po_zmene() from public, anon, authenticated;

create trigger group_tasks_po_zmene after update of status on public.group_tasks
  for each row execute function public.group_tasks_po_zmene();

-- ---------------------------------------------------------------- create_group_campaign
-- Security DEFINER (dávky klient nesmí zapisovat), proto na začátku výslovně is_app_user():
-- všechny politiky skupin jsou is_app_user(), takže výsledek je stejný jako s RLS.
-- V jedné transakci: kampaň, média, dávky, úkoly. Skupiny v pořadí pole, duplicity v poli
-- a neaktivní (i neexistující) skupiny se přeskočí; varianta = pořadí % počet variant.
create or replace function public.create_group_campaign(
  p_title text,
  p_variants text[],
  p_asset_ids uuid[],
  p_group_ids uuid[],
  p_starts_at timestamptz,
  p_batch_size int,
  p_batch_interval_minutes int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_velikost int := coalesce(p_batch_size, 20);
  v_odstup int := coalesce(p_batch_interval_minutes, 120);
  v_skupiny uuid[];
  v_pocet int;
  v_davek int;
begin
  if not public.is_app_user() then
    raise exception 'Nemáte přístup do aplikace.' using errcode = '42501';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Rozesílka musí mít název.' using errcode = '22023';
  end if;
  if not public.varianty_platne(p_variants) then
    raise exception 'Rozesílka potřebuje 1 až 3 varianty textu a žádná nesmí být prázdná.' using errcode = '22023';
  end if;
  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'Vyberte aspoň jednu skupinu.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'Chybí čas začátku rozesílky.' using errcode = '22023';
  end if;

  -- aktivní skupiny v pořadí prvního výskytu v poli (bez dočasné tabulky — klient
  -- nemusí mít právo TEMP)
  select array_agg(x.gid order by x.prvni) into v_skupiny
    from (
      select u.gid, min(u.ord) as prvni
        from unnest(p_group_ids) with ordinality as u(gid, ord)
        join public.fb_groups g on g.id = u.gid and g.is_active
       group by u.gid
    ) x;
  v_pocet := coalesce(cardinality(v_skupiny), 0);
  if v_pocet = 0 then
    raise exception 'Žádná z vybraných skupin není aktivní.' using errcode = '22023';
  end if;

  insert into public.group_campaigns (title, variants, starts_at, batch_size, batch_interval_minutes)
  values (btrim(p_title), p_variants, p_starts_at, v_velikost, v_odstup)
  returning id into v_id;

  insert into public.group_campaign_media (campaign_id, asset_id, position)
  select v_id, a.aid, (a.ord - 1)::smallint
    from unnest(coalesce(p_asset_ids, '{}'::uuid[])) with ordinality as a(aid, ord);

  v_davek := (v_pocet + v_velikost - 1) / v_velikost;
  insert into public.group_batches (campaign_id, batch_no, due_at)
  select v_id, b, p_starts_at + (b - 1) * make_interval(mins => v_odstup)
    from generate_series(1, v_davek) as b;

  insert into public.group_tasks (campaign_id, batch_id, group_id, variant_index)
  select v_id, gb.id, s.gid, ((s.ord - 1) % cardinality(p_variants))::smallint
    from unnest(v_skupiny) with ordinality as s(gid, ord)
    join public.group_batches gb on gb.campaign_id = v_id and gb.batch_no = (s.ord - 1) / v_velikost + 1;

  return v_id;
end;
$$;
revoke all on function public.create_group_campaign(text, text[], uuid[], uuid[], timestamptz, int, int) from public, anon;
grant execute on function public.create_group_campaign(text, text[], uuid[], uuid[], timestamptz, int, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------- due_group_batches
-- Jen service_role (volá ho cron route na Vercelu). Vrátí splatné, ještě neoznámené dávky
-- aktivních kampaní a ATOMICKY jim nastaví notified_at (for update skip locked), takže
-- souběžné volání tutéž dávku nevrátí. Dávka splatná před víc než 12 h se jen označí
-- a nevrátí (zmeškaná — žádný noční spam). Dávka bez pending úkolů se označí a nevrátí.
create or replace function public.due_group_batches(p_limit int default 10)
returns table (
  batch_id uuid,
  campaign_id uuid,
  campaign_title text,
  batch_no int,
  batch_count int,
  due_at timestamptz,
  pending_count int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- Jediné místo s hranicí zmeškané dávky.
  c_zmeskano constant interval := interval '12 hours';
begin
  -- 1) zmeškané: jen označit
  update public.group_batches b
     set notified_at = now()
   where b.id in (
     select x.id
       from public.group_batches x
       join public.group_campaigns c on c.id = x.campaign_id
      where x.notified_at is null
        and x.due_at < now() - c_zmeskano
        and c.status = 'active'
      for update of x skip locked);

  -- 2) splatné: označit a vrátit (s neprázdnou dávkou)
  return query
  with kandidati as (
    select x.id
      from public.group_batches x
      join public.group_campaigns c on c.id = x.campaign_id
     where x.notified_at is null
       and x.due_at <= now()
       and x.due_at >= now() - c_zmeskano
       and c.status = 'active'
     order by x.due_at, x.batch_no
     limit greatest(coalesce(p_limit, 10), 0)
     for update of x skip locked
  ), oznacene as (
    update public.group_batches b
       set notified_at = now()
      from kandidati k
     where b.id = k.id
    returning b.id, b.campaign_id, b.batch_no, b.due_at
  )
  select o.id, o.campaign_id, c.title, o.batch_no,
         (select count(*)::int from public.group_batches z where z.campaign_id = o.campaign_id),
         o.due_at, p.n
    from oznacene o
    join public.group_campaigns c on c.id = o.campaign_id
    cross join lateral (
      select count(*)::int as n from public.group_tasks t where t.batch_id = o.id and t.status = 'pending'
    ) p
   where p.n > 0
   order by o.due_at, o.batch_no;
end;
$$;
revoke all on function public.due_group_batches(int) from public, anon, authenticated;
grant execute on function public.due_group_batches(int) to service_role;

-- ---------------------------------------------------------------- release_group_batch
-- Jen service_role. Cron route ji zavolá, když se notifikace dávky nedoručila na žádný
-- odběr: vrátí notified_at = null, aby se dávka při dalším běhu zkusila znovu (strop 12 h
-- v due_group_batches dál platí). Jen u aktivní kampaně a dávky s pending úkoly, jinak false.
create or replace function public.release_group_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_batches b
     set notified_at = null
   where b.id = p_batch_id
     and exists (select 1 from public.group_campaigns c where c.id = b.campaign_id and c.status = 'active')
     and exists (select 1 from public.group_tasks t where t.batch_id = b.id and t.status = 'pending');
  return found;
end;
$$;
revoke all on function public.release_group_batch(uuid) from public, anon, authenticated;
grant execute on function public.release_group_batch(uuid) to service_role;
