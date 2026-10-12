-- 0004 — opakované příspěvky (post_series).
--
-- series_occurrences(...)          čistý výpočet okamžiků výskytů v zadaném rozsahu dnů
--                                  (čas = time_of_day v MÍSTNÍM čase pásma, takže
--                                  18:00 zůstane 18:00 i přes přechod letní/zimní čas)
-- generate_series_occurrences(id)  vytvoří chybějící výskyty jako kopie šablony
-- extend_all_series()              denní cron: prodlouží všechny aktivní série
-- Šablona série nesmí být naplánovaná (publikovala by se navíc k výskytům) — dva triggery níže.

create or replace function public.series_occurrences(
  p_freq text,
  p_interval_n int,
  p_weekdays smallint[],
  p_month_day smallint,
  p_time_of_day time,
  p_timezone text,
  p_starts_on date,
  p_from date,
  p_to date
)
returns setof timestamptz
language sql
stable
set search_path = ''
as $$
  select ((g.d::date + p_time_of_day) at time zone p_timezone) as okamzik
  from generate_series(greatest(p_from, p_starts_on)::timestamp, p_to::timestamp, interval '1 day') as g(d)
  where case p_freq
    when 'weekly' then
      extract(isodow from g.d)::smallint = any (p_weekdays)
      -- týdny se počítají od pondělí týdne, ve kterém série začíná
      and ((g.d::date - (p_starts_on - (extract(isodow from p_starts_on)::int - 1))) / 7) % p_interval_n = 0
    when 'monthly' then
      ((extract(year from g.d)::int * 12 + extract(month from g.d)::int)
        - (extract(year from p_starts_on)::int * 12 + extract(month from p_starts_on)::int)) % p_interval_n = 0
      -- měsíc bez daného dne (31. v dubnu, 30. v únoru) → poslední den měsíce
      and extract(day from g.d)::int = least(
            p_month_day::int,
            extract(day from (date_trunc('month', g.d) + interval '1 month - 1 day'))::int)
    else false
  end
  order by 1;
$$;
revoke all on function public.series_occurrences(text, int, smallint[], smallint, time, text, date, date, date)
  from public, anon;
grant execute on function public.series_occurrences(text, int, smallint[], smallint, time, text, date, date, date)
  to authenticated, service_role;

-- Security INVOKER: klient (app_user) projde přes RLS a triggery jako při ručním vložení.
-- Cron to volá jako postgres přes extend_all_series().
create or replace function public.generate_series_occurrences(p_series_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  s public.post_series;
  t public.posts;
  v_dnes date;
  v_od date;
  v_do date;
  v_okamzik timestamptz;
  v_novy uuid;
  v_pocet int := 0;
begin
  select * into s from public.post_series where id = p_series_id;
  if not found then
    raise exception 'Opakování % neexistuje.', p_series_id using errcode = 'P0002';
  end if;
  if not s.is_active then
    return 0;
  end if;

  select * into t from public.posts where id = s.template_post_id;
  if not found then
    raise warning 'Opakování % nemá šablonu, výskyty se nevytvoří.', p_series_id;
    return 0;
  end if;

  v_dnes := (now() at time zone s.timezone)::date;
  v_od := greatest(v_dnes, s.starts_on, s.generated_until + 1);
  v_do := v_dnes + s.horizon_weeks * 7;
  if s.until_on is not null then
    v_do := least(v_do, s.until_on);
  end if;
  if v_od > v_do then
    return 0;
  end if;

  for v_okamzik in
    select o from public.series_occurrences(
      s.freq, s.interval_n, s.weekdays, s.month_day, s.time_of_day, s.timezone,
      s.starts_on, v_od, v_do) as o
  loop
    continue when v_okamzik <= now();
    v_novy := null;
    insert into public.posts (
      account_id, series_id, copied_from_id, format, caption, link_url,
      scheduled_at, status, platform_options, content_hash)
    values (
      s.account_id, s.id, t.id, t.format, t.caption, t.link_url,
      v_okamzik, 'scheduled', t.platform_options,
      -- content_hash obsahuje account_id; šablona z jiného účtu → UI ho přepočítá
      case when t.account_id = s.account_id then t.content_hash end)
    on conflict (series_id, scheduled_at) where series_id is not null do nothing
    returning id into v_novy;

    if v_novy is not null then
      insert into public.post_media (post_id, asset_id, position)
      select v_novy, pm.asset_id, pm.position
        from public.post_media pm
       where pm.post_id = t.id;
      v_pocet := v_pocet + 1;
    end if;
  end loop;

  update public.post_series set generated_until = v_do where id = s.id;
  return v_pocet;
end;
$$;
revoke all on function public.generate_series_occurrences(uuid) from public, anon;
grant execute on function public.generate_series_occurrences(uuid) to authenticated, service_role;

create or replace function public.extend_all_series()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_celkem int := 0;
begin
  for v_id in
    select id from public.post_series
     where is_active
       and (until_on is null or until_on >= (now() at time zone timezone)::date)
     order by created_at
  loop
    begin
      v_celkem := v_celkem + public.generate_series_occurrences(v_id);
    exception when others then
      -- jedna rozbitá série nesmí zastavit ostatní
      raise warning 'Opakování %: %', v_id, sqlerrm;
    end;
  end loop;
  return v_celkem;
end;
$$;
revoke all on function public.extend_all_series() from public, anon, authenticated;
grant execute on function public.extend_all_series() to service_role;

-- ---------------------------------------------------------------- šablona není naplánovaná
-- Platí pro všechny role (i service_role): šablona je předloha, ne příspěvek ve frontě.
create or replace function public.post_series_sablona_hlidac()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.template_post_id is not null and exists (
    select 1 from public.posts p where p.id = new.template_post_id and p.status = 'scheduled'
  ) then
    raise exception 'Šablona opakování nemůže být naplánovaný příspěvek — nejdřív ho vraťte do konceptu.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.post_series_sablona_hlidac() from public, anon, authenticated;

create trigger post_series_sablona_hlidac before insert or update of template_post_id on public.post_series
  for each row execute function public.post_series_sablona_hlidac();

create or replace function public.posts_sablona_hlidac()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.post_series s where s.template_post_id = new.id) then
    raise exception 'Tento příspěvek je šablona opakování — naplánovat nejde, naplánované jsou jeho výskyty.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.posts_sablona_hlidac() from public, anon, authenticated;

create trigger posts_sablona_hlidac before update on public.posts
  for each row
  when (new.status = 'scheduled' and old.status is distinct from 'scheduled')
  execute function public.posts_sablona_hlidac();
