-- 0003 — triggery: přechody stavů posts, omezení sloupců pro klienta,
-- zámek médií publikovaných příspěvků, updated_at, audit.
--
-- „Klient“ = příkaz běží pod rolí authenticated (nebo anon). Všechno ostatní
-- (service_role z Edge funkcí, postgres z cronu a SQL editoru, funkce security
-- definer vlastněné postgres) smí vše — přesně jak říká SPEC („service_role smí vše“).
-- Triggery hlídače jsou schválně security INVOKER, aby current_user byla role volajícího.

create or replace function public.je_klient()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;
revoke all on function public.je_klient() from public, anon;
grant execute on function public.je_klient() to authenticated, service_role;

-- ---------------------------------------------------------------- updated_at
create or replace function public.nastav_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger text_snippets_updated_at before update on public.text_snippets
  for each row execute function public.nastav_updated_at();

-- ---------------------------------------------------------------- posts: hlídač
create or replace function public.posts_hlidac()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_klient boolean := public.je_klient();
begin
  if tg_op = 'INSERT' then
    if v_klient then
      if new.status not in ('draft', 'scheduled') then
        raise exception 'Nový příspěvek může být jen koncept nebo naplánovaný (ne %).', new.status
          using errcode = 'P0001';
      end if;
      -- Systémové sloupce nastavuje jen publikační smyčka; kopie příspěvku je nepřenáší.
      new.external_id := null;
      new.external_url := null;
      new.published_at := null;
      new.attempt_count := 0;
      new.next_attempt_at := null;
      new.locked_at := null;
      new.lock_token := null;
      new.step := null;
      new.remote_state := '{}';
      new.last_error_code := null;
      new.last_error_message := null;
      new.error_resolved_at := null;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_klient and old.status in ('publishing', 'published') then
      raise exception 'Příspěvek, který se publikuje nebo už vyšel, nelze smazat.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE
  new.updated_at := now();
  if not v_klient then
    return new;
  end if;

  if old.status = 'publishing' then
    raise exception 'Příspěvek se právě publikuje, teď ho nelze měnit.' using errcode = 'P0001';
  end if;

  if old.status = 'published' then
    if (to_jsonb(new) - 'error_resolved_at' - 'updated_at')
       is distinct from (to_jsonb(old) - 'error_resolved_at' - 'updated_at') then
      raise exception 'U zveřejněného příspěvku jde změnit jen „chyba vyřešena“.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'scheduled')
    or (old.status = 'scheduled' and new.status = 'draft')
    or (old.status = 'failed' and new.status in ('scheduled', 'draft'))
  ) then
    raise exception 'Změna stavu % → % není dovolená.', old.status, new.status using errcode = 'P0001';
  end if;

  if (new.external_id, new.external_url, new.published_at, new.attempt_count, new.next_attempt_at,
      new.locked_at, new.lock_token, new.step, new.remote_state, new.last_error_code,
      new.last_error_message)
     is distinct from
     (old.external_id, old.external_url, old.published_at, old.attempt_count, old.next_attempt_at,
      old.locked_at, old.lock_token, old.step, old.remote_state, old.last_error_code,
      old.last_error_message) then
    raise exception 'Systémové údaje příspěvku mění jen publikační smyčka.' using errcode = 'P0001';
  end if;

  -- Ruční „zkusit znovu“: nový začátek počítání pokusů; last_error_* zůstávají pro historii.
  -- error_resolved_at se nuluje, aby se případná další chyba znovu ukázala na stránce Chyby.
  if old.status = 'failed' and new.status in ('scheduled', 'draft') then
    new.error_resolved_at := null;
    new.next_attempt_at := null;
    new.step := null;
    new.attempt_count := 0;
    new.locked_at := null;
    new.lock_token := null;
  end if;

  -- Jiný obsah = jiný příspěvek: rozpracovaný stav na platformě (kontejner, nahrané fotky)
  -- už neplatí a počítání pokusů začíná znovu.
  if (new.account_id, new.format, new.caption, new.link_url)
     is distinct from (old.account_id, old.format, old.caption, old.link_url) then
    new.remote_state := '{}';
    new.step := null;
    new.attempt_count := 0;
    new.next_attempt_at := null;
  end if;

  return new;
end;
$$;

create trigger posts_hlidac before insert or update or delete on public.posts
  for each row execute function public.posts_hlidac();

-- ---------------------------------------------------------------- post_media
create or replace function public.post_media_hlidac()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.je_klient() then
    if exists (
      select 1 from public.posts p
      where p.id in (
        case when tg_op <> 'INSERT' then old.post_id end,
        case when tg_op <> 'DELETE' then new.post_id end)
        and p.status in ('publishing', 'published')
    ) then
      raise exception 'Média příspěvku, který se publikuje nebo už vyšel, nelze měnit.'
        using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger post_media_hlidac before insert or update or delete on public.post_media
  for each row execute function public.post_media_hlidac();

-- Změna médií = jiný příspěvek: rozpracovaný stav na platformě neplatí a pokusy se počítají
-- znovu. Security definer, protože klient sám tyto sloupce měnit nesmí (hlídač by ho odmítl).
create or replace function public.post_media_zahod_rozpracovane()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts p
     set remote_state = '{}', step = null, attempt_count = 0, next_attempt_at = null
   where p.id in (
           case when tg_op <> 'INSERT' then old.post_id end,
           case when tg_op <> 'DELETE' then new.post_id end)
     and p.status in ('draft', 'scheduled', 'failed')
     and (p.remote_state <> '{}'::jsonb or p.step is not null
          or p.attempt_count <> 0 or p.next_attempt_at is not null);
  return null;
end;
$$;
revoke all on function public.post_media_zahod_rozpracovane() from public, anon, authenticated;

create trigger post_media_zahod_rozpracovane after insert or update or delete on public.post_media
  for each row execute function public.post_media_zahod_rozpracovane();

-- ---------------------------------------------------------------- social_accounts
create or replace function public.social_accounts_hlidac()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.je_klient() then
      raise exception 'Účty zakládá jen propojení s Metou (tlačítko Načíst účty).' using errcode = 'P0001';
    end if;
    return new;
  end if;

  new.updated_at := now();
  if public.je_klient()
     and (to_jsonb(new) - 'color' - 'timezone' - 'is_active' - 'updated_at')
         is distinct from (to_jsonb(old) - 'color' - 'timezone' - 'is_active' - 'updated_at') then
    raise exception 'U účtu jde měnit jen barvu, časové pásmo a zapnutí.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger social_accounts_hlidac before insert or update on public.social_accounts
  for each row execute function public.social_accounts_hlidac();

-- ---------------------------------------------------------------- post_series
-- Změna rozvrhu = generovat znovu od dneška (viz generated_until v 0001).
create or replace function public.post_series_zmena_rozvrhu()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.freq, new.interval_n, new.weekdays, new.month_day, new.time_of_day, new.timezone,
      new.starts_on, new.until_on, new.horizon_weeks, new.account_id)
     is distinct from
     (old.freq, old.interval_n, old.weekdays, old.month_day, old.time_of_day, old.timezone,
      old.starts_on, old.until_on, old.horizon_weeks, old.account_id) then
    new.generated_until := null;
  end if;
  return new;
end;
$$;

create trigger post_series_zmena_rozvrhu before update on public.post_series
  for each row execute function public.post_series_zmena_rozvrhu();

-- ---------------------------------------------------------------- audit
create or replace function public.posts_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'insert', 'posts', new.id,
            jsonb_build_object('status', new.status, 'scheduled_at', new.scheduled_at,
                               'account_id', new.account_id));
    return null;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'delete', 'posts', old.id,
            jsonb_build_object('status', old.status, 'scheduled_at', old.scheduled_at,
                               'account_id', old.account_id));
    return null;
  end if;

  if new.status is distinct from old.status or new.scheduled_at is distinct from old.scheduled_at then
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(),
            case when new.status is distinct from old.status then 'status_change' else 'reschedule' end,
            'posts', new.id,
            jsonb_build_object(
              'from_status', old.status, 'to_status', new.status,
              'from_scheduled_at', old.scheduled_at, 'to_scheduled_at', new.scheduled_at,
              'error_code', new.last_error_code));
  end if;
  return null;
end;
$$;
revoke all on function public.posts_audit() from public, anon, authenticated;

create trigger posts_audit after insert or update or delete on public.posts
  for each row execute function public.posts_audit();
