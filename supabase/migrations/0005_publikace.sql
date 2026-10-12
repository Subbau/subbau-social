-- 0005 — publikační smyčka (EXECUTE jen service_role).
--
-- claim_due_posts(n)             vezme splatné příspěvky (for update skip locked),
--                                rovnou odmítne zmeškané (missed) a podezřelé duplicity
--                                (duplicate_suspected)
-- release_stale_posts()          uvolní zaseknuté publikování → failed / unknown_outcome
-- publisher_save_progress(...)   uloží krok a remote_state po každém kroku na platformě
-- publisher_finish(...)          zapíše výsledek běhu
-- publisher_return_claim(...)    vrátí vzatý příspěvek do fronty (běh nestihl termín)
-- Oba zápisy ověřují lock_token: když mezitím příspěvek převzal jiný běh nebo ho
-- release_stale_posts uvolnil, zápis se neprovede a funkce vrátí false.

-- Kontrola duplicity je tady (ne v Edge funkci), aby dvě kopie téhož obsahu nemohly
-- projít ani ve stejné dávce, ani ve dvou souběžných bězích, ani když jedna čeká v backoffu:
--   naplánovaný příspěvek s content_hash (bez allow_duplicate) je duplicita, když na stejném
--   účtu existuje JINÝ příspěvek se stejným content_hash, který
--     - je publishing, nebo
--     - je published za posledních 30 dní, nebo
--     - skončil nejistě (last_error_code = 'unknown_outcome', stav scheduled nebo failed,
--       změněný za posledních 30 dní) — mohl ve skutečnosti vyjít (IG v backoffu po nejistém
--       media_publish, FB failed / unknown_outcome).
--   Výjimka: výskyty téže série.
-- Zámek pg_try_advisory_xact_lock na (account_id, content_hash) serializuje rozhodování:
--   - ve stejné transakci (stejná dávka) je zámek re-entrantní → druhá kopie vidí první jako
--     publishing a rovnou skončí failed;
--   - drží-li zámek souběžný claim, kopie se v tomto běhu přeskočí (zůstane scheduled, pokus
--     se nepočítá) a rozhodne se v dalším běhu. Blokující pg_advisory_xact_lock se nepoužívá:
--     dvě transakce s různými obsahy by se mohly zablokovat navzájem (deadlock).
-- Zmeškané příspěvky se samy pozdě nezveřejní (uspaný projekt na Free plánu, výpadek cronu):
--   naplánovaný příspěvek, který ještě nebyl zahájen (attempt_count = 0, bez next_attempt_at,
--   prázdný remote_state) a jehož scheduled_at je víc než c_zmeskano (2 h) v minulosti →
--   failed / missed. Navíc musí být i poslední úprava příspěvku (updated_at) starší než 2 h:
--   ruční „zkusit znovu“ nebo přeplánování na minulý čas je výslovné přání zveřejnit hned
--   a nesmí hned skončit jako zmeškané. Backoff a pokračování kontejneru mají vlastní pravidla.
create or replace function public.claim_due_posts(p_limit int default 5)
returns setof public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant int := greatest(coalesce(p_limit, 5), 0);
  -- Jediné místo s hranicí zmeškání.
  c_zmeskano constant interval := interval '2 hours';
  v_vzato int := 0;
  -- Explicitní kurzor a FETCH po jednom řádku: smyčka FOR v plpgsql si přednačítá po 10
  -- řádcích, a tím by zamkla víc příspěvků, než vezme (souběžný běh by je musel přeskočit).
  c refcursor;
  k record;
  v_jiny public.posts;
  v_post public.posts;
  v_zprava text;
begin
  if v_limit = 0 then
    return;
  end if;

  open c for
    select p.id, p.status, p.account_id, p.content_hash, p.series_id, p.platform_options,
           p.attempt_count, p.next_attempt_at, p.remote_state, p.scheduled_at, p.updated_at,
           (select a.timezone from public.social_accounts a where a.id = p.account_id) as tz
      from public.posts p
     where (p.status = 'scheduled'
            and p.scheduled_at <= now()
            and (p.next_attempt_at is null or p.next_attempt_at <= now()))
        or (p.status = 'publishing'
            and p.step = 'container_processing'
            and p.locked_at < now() - interval '45 seconds')
     order by coalesce(p.next_attempt_at, p.scheduled_at), p.id
     for update skip locked;

  while v_vzato < v_limit loop
    fetch c into k;
    exit when not found;

    if k.status = 'scheduled'
       and k.attempt_count = 0
       and k.next_attempt_at is null
       and k.remote_state = '{}'::jsonb
       and k.scheduled_at < now() - c_zmeskano
       and k.updated_at < now() - c_zmeskano then
      v_zprava := 'Příspěvek nevyšel včas (plánovaný čas '
        || to_char(k.scheduled_at at time zone coalesce(k.tz, 'Europe/Prague'), 'DD. MM. HH24:MI')
        || ') — server v tu dobu neběžel. Pokud ho chcete zveřejnit, naplánujte ho znovu.';
      update public.posts
         set status = 'failed',
             last_error_code = 'missed',
             last_error_message = v_zprava,
             error_resolved_at = null
       where id = k.id;
      insert into public.publish_attempts
        (post_id, started_at, finished_at, step, outcome, error_code, error_message_cs, remote_ids)
      values (k.id, now(), now(), 'claim', 'fatal_error', 'missed', v_zprava,
              jsonb_build_object('scheduled_at', k.scheduled_at));
      continue;
    end if;

    if k.status = 'scheduled'
       and k.content_hash is not null
       and (k.platform_options -> 'allow_duplicate') is distinct from 'true'::jsonb then
      if not pg_try_advisory_xact_lock(hashtextextended(k.account_id::text || '|' || k.content_hash, 0)) then
        continue; -- stejný obsah právě rozhoduje souběžný běh → příště
      end if;

      select o.* into v_jiny
        from public.posts o
       where o.account_id = k.account_id
         and o.content_hash = k.content_hash
         and o.id <> k.id
         and (o.status = 'publishing'
              or (o.status = 'published' and o.published_at >= now() - interval '30 days')
              or (o.last_error_code = 'unknown_outcome'
                  and o.status in ('scheduled', 'failed')
                  and o.updated_at >= now() - interval '30 days'))
         and not (k.series_id is not null and o.series_id is not distinct from k.series_id)
       order by (o.status = 'publishing') desc, (o.status = 'published') desc,
                o.published_at desc nulls last, o.updated_at desc
       limit 1;

      if found then
        v_zprava := case
          when v_jiny.status = 'publishing'
            then 'Stejný příspěvek se na tomto účtu právě zveřejňuje (příspěvek ' || v_jiny.id || ').'
          when v_jiny.status = 'published'
            then 'Stejný příspěvek na tomto účtu vyšel '
                 || to_char(v_jiny.published_at at time zone 'Europe/Prague', 'DD. MM. YYYY HH24:MI')
                 || ' (příspěvek ' || v_jiny.id || ').'
          else 'Stejný příspěvek na tomto účtu možná už vyšel — předchozí pokus (příspěvek '
               || v_jiny.id || ') skončil nejistě. Zkontrolujte stránku.'
        end || ' Pokud ho chcete opravdu zveřejnit znovu, povolte duplicitu a naplánujte ho znovu.';
        update public.posts
           set status = 'failed',
               last_error_code = 'duplicate_suspected',
               last_error_message = v_zprava,
               error_resolved_at = null,
               next_attempt_at = null
         where id = k.id;
        insert into public.publish_attempts
          (post_id, started_at, finished_at, step, outcome, error_code, error_message_cs, remote_ids)
        values (k.id, now(), now(), 'claim', 'fatal_error', 'duplicate_suspected', v_zprava,
                jsonb_build_object('duplicate_of', v_jiny.id,
                                   'duplicate_status', case when v_jiny.status in ('scheduled', 'failed')
                                                            then 'unknown_outcome' else v_jiny.status::text end));
        continue;
      end if;
    end if;

    update public.posts p
       set attempt_count = case when p.status = 'scheduled' then p.attempt_count + 1 else p.attempt_count end,
           status = 'publishing',
           locked_at = now(),
           lock_token = gen_random_uuid()
     where p.id = k.id
    returning p.* into v_post;
    v_vzato := v_vzato + 1;
    return next v_post;
  end loop;
  close c;
end;
$$;
revoke all on function public.claim_due_posts(int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(int) to service_role;

create or replace function public.release_stale_posts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pocet int;
  v_zprava constant text := 'Nevíme, jestli příspěvek vyšel — zkontrolujte stránku, než ho pustíte znovu.';
begin
  with uvolnene as (
    update public.posts p
       set status = 'failed',
           last_error_code = 'unknown_outcome',
           last_error_message = v_zprava,
           error_resolved_at = null,
           next_attempt_at = null,
           locked_at = null,
           lock_token = null
     where p.status = 'publishing'
       and p.locked_at < now() - interval '20 minutes'
    returning p.id, p.step, p.remote_state
  ), zapsane as (
    insert into public.publish_attempts
      (post_id, started_at, finished_at, step, outcome, error_code, error_message_cs, remote_ids)
    select u.id, now(), now(), u.step, 'unknown', 'unknown_outcome', v_zprava, u.remote_state
      from uvolnene u
    returning 1
  )
  select count(*) into v_pocet from zapsane;
  return v_pocet;
end;
$$;
revoke all on function public.release_stale_posts() from public, anon, authenticated;
grant execute on function public.release_stale_posts() to service_role;

create or replace function public.publisher_save_progress(
  p_post_id uuid,
  p_lock_token uuid,
  p_step text,
  p_remote_state jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
     set step = p_step,
         remote_state = coalesce(p_remote_state, '{}'::jsonb)
   where id = p_post_id
     and status = 'publishing'
     and lock_token = p_lock_token;
  return found;
end;
$$;
revoke all on function public.publisher_save_progress(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.publisher_save_progress(uuid, uuid, text, jsonb) to service_role;

-- p_result: {"status": "...", další klíče volitelné}. Přítomný klíč = nastavit (i na null),
-- chybějící klíč = nechat. Klíče: step, remote_state, external_id, external_url,
-- published_at, next_attempt_at, last_error_code, last_error_message.
-- Stav 'publishing' = běh pokračuje později (IG kontejner se zpracovává); zámek zůstává.
create or replace function public.publisher_finish(
  p_post_id uuid,
  p_lock_token uuid,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stav public.post_status := (p_result ->> 'status')::public.post_status;
begin
  if v_stav is null or v_stav = 'draft' then
    raise exception 'publisher_finish: neplatný stav %', p_result ->> 'status';
  end if;

  update public.posts p
     set status = v_stav,
         step = case when p_result ? 'step' then p_result ->> 'step' else p.step end,
         remote_state = case when p_result ? 'remote_state'
                             then coalesce(p_result -> 'remote_state', '{}'::jsonb) else p.remote_state end,
         external_id = case when p_result ? 'external_id' then p_result ->> 'external_id' else p.external_id end,
         external_url = case when p_result ? 'external_url' then p_result ->> 'external_url' else p.external_url end,
         published_at = case
                          when v_stav = 'published'
                            then coalesce((p_result ->> 'published_at')::timestamptz, p.published_at, now())
                          else p.published_at end,
         next_attempt_at = case when p_result ? 'next_attempt_at'
                                then (p_result ->> 'next_attempt_at')::timestamptz else p.next_attempt_at end,
         last_error_code = case when p_result ? 'last_error_code'
                                then p_result ->> 'last_error_code' else p.last_error_code end,
         last_error_message = case when p_result ? 'last_error_message'
                                   then p_result ->> 'last_error_message' else p.last_error_message end,
         -- nová chyba = znovu nevyřešená (jinak by zmizela ze stránky Chyby)
         error_resolved_at = case when v_stav = 'failed' then null else p.error_resolved_at end,
         locked_at = case when v_stav = 'publishing' then p.locked_at end,
         lock_token = case when v_stav = 'publishing' then p.lock_token end
   where p.id = p_post_id
     and p.status = 'publishing'
     and p.lock_token = p_lock_token;
  return found;
end;
$$;
revoke all on function public.publisher_finish(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.publisher_finish(uuid, uuid, jsonb) to service_role;

-- Běh nestihl příspěvek začít (nebo dlouhý krok) do svého termínu → vrátit do fronty
-- bez započítání pokusu. Pokračování kontejneru (step container_processing) zůstává
-- publishing a claim (b) ho vezme znovu po 45 s; ostatní → scheduled, attempt_count − 1
-- (claim (a) ho zvýšil). remote_state zůstává, další běh naváže.
create or replace function public.publisher_return_claim(p_post_id uuid, p_lock_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts p
     set status = case when p.step = 'container_processing' then 'publishing'::public.post_status
                       else 'scheduled'::public.post_status end,
         attempt_count = case when p.step = 'container_processing' then p.attempt_count
                              else greatest(p.attempt_count - 1, 0) end,
         locked_at = case when p.step = 'container_processing' then p.locked_at end,
         lock_token = case when p.step = 'container_processing' then p.lock_token end
   where p.id = p_post_id
     and p.status = 'publishing'
     and p.lock_token = p_lock_token;
  return found;
end;
$$;
revoke all on function public.publisher_return_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publisher_return_claim(uuid, uuid) to service_role;
