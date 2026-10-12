-- 04 — plánované úlohy (pg_cron + pg_net).
--
-- NÁVOD (pořadí):
--   1. Proběhly migrace a 03_cron_secret.sql.
--   2. Nasazené Edge funkce publisher, check-accounts (s --no-verify-jwt, viz supabase/config.toml)
--      a meta-sync; v Edge Functions → Secrets je CRON_SECRET (a volitelně GRAPH_API_VERSION).
--   3. Nahradit VŠECHNY výskyty <<DOPLNIT PROJECT_REF>> (Dashboard → Project Settings → General → Reference ID;
--      Najít a nahradit) a pustit v SQL Editoru. Jde pustit znovu (úlohy se přepíší podle jména).
--
-- Úlohy:
--   subbau-publisher       každou minutu   POST …/functions/v1/publisher
--   subbau-extend-series   denně 02:15 UTC  public.extend_all_series()
--   subbau-check-accounts  denně 02:30 UTC  POST …/functions/v1/check-accounts
--   subbau-cron-uklid      denně 03:00 UTC  smaže historii běhů cronu starší 7 dní
-- CRON_SECRET se čte z Vaultu až při běhu — v cron.job ani v logu není.
--
-- Vypnutí publikování:  select cron.unschedule('subbau-publisher');
-- Kontrola běhů:        select * from cron.job_run_details order by start_time desc limit 20;
--                       select * from net._http_response order by created desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'subbau_cron_secret') then
    raise exception 'Ve Vaultu chybí subbau_cron_secret — nejdřív pusťte 03_cron_secret.sql.';
  end if;
  if 'https://<<DOPLNIT PROJECT_REF>>.supabase.co' like '%<<%' then
    raise exception 'Doplňte PROJECT_REF (Najít a nahradit všechny výskyty).';
  end if;
end $$;

select cron.schedule(
  'subbau-publisher',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://<<DOPLNIT PROJECT_REF>>.supabase.co/functions/v1/publisher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'subbau_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

select cron.schedule(
  'subbau-extend-series',
  '15 2 * * *',
  $job$ select public.extend_all_series(); $job$
);

select cron.schedule(
  'subbau-check-accounts',
  '30 2 * * *',
  $job$
  select net.http_post(
    url := 'https://<<DOPLNIT PROJECT_REF>>.supabase.co/functions/v1/check-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'subbau_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

select cron.schedule(
  'subbau-cron-uklid',
  '0 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $job$
);

select jobname, schedule, active from cron.job where jobname like 'subbau-%' order by jobname;
