-- 06 — upozornění na dávky skupin: pg_cron každou minutu → Vercel route /api/cron/skupiny.
--
-- NÁVOD (pořadí):
--   1. Proběhla migrace 0008_skupiny.sql.
--   2. Vygenerovat náhodný řetězec aspoň 32 znaků (Terminál: openssl rand -hex 32) a ten SAMÝ
--      uložit na Vercelu jako proměnnou prostředí VERCEL_CRON_SECRET (Settings → Environment
--      Variables, Production) a nasadit appku znovu.
--   3. Níže nahradit <<DOPLNIT VERCEL_CRON_SECRET …>> tím řetězcem a VŠECHNY výskyty
--      <<DOPLNIT VERCEL DOMÉNA>> doménou appky bez https:// a bez lomítka na konci
--      (např. subbau-social.vercel.app). Pustit v SQL Editoru.
--   4. Jde pustit znovu: úloha se přepíše podle jména. Kdo už secret uložil a nechce ho
--      měnit, nechá <<DOPLNIT VERCEL_CRON_SECRET …>> beze změny — ve Vaultu zůstane starý.
-- Secret se do textu úlohy NEPÍŠE — úloha si ho čte z Vaultu ('subbau_vercel_cron_secret').
-- Pozor: SQL Editor si pamatuje historii dotazů; po uložení dotaz z historie smažte.
--
-- Vypnutí:  select cron.unschedule('subbau-skupiny');
-- Kontrola: select * from net._http_response order by created desc limit 10;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_secret text := '<<DOPLNIT VERCEL_CRON_SECRET (min. 32 znaků)>>';
  v_id uuid;
begin
  if 'https://<<DOPLNIT VERCEL DOMÉNA>>/api/cron/skupiny' like '%<<%' then
    raise exception 'Doplňte doménu appky (Najít a nahradit všechny výskyty <<DOPLNIT VERCEL DOMÉNA>>).';
  end if;
  if 'https://<<DOPLNIT VERCEL DOMÉNA>>/api/cron/skupiny' !~ '^https://[a-z0-9.-]+\.[a-z]{2,}/api/cron/skupiny$' then
    raise exception 'Doménu zadejte bez https:// a bez lomítka, např. subbau-social.vercel.app.';
  end if;

  select id into v_id from vault.decrypted_secrets where name = 'subbau_vercel_cron_secret';
  if v_secret like '<<%' then
    if v_id is null then
      raise exception 'Doplňte VERCEL_CRON_SECRET (aspoň 32 znaků) místo <<DOPLNIT …>>.';
    end if;
    -- secret už ve Vaultu je a nemění se
  elsif length(v_secret) < 32 then
    raise exception 'VERCEL_CRON_SECRET musí mít aspoň 32 znaků.';
  elsif v_id is null then
    perform vault.create_secret(v_secret, 'subbau_vercel_cron_secret', 'Bearer pro Vercel route /api/cron/skupiny');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end $$;

select cron.schedule(
  'subbau-skupiny',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://<<DOPLNIT VERCEL DOMÉNA>>/api/cron/skupiny',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'subbau_vercel_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

select jobname, schedule, active from cron.job where jobname = 'subbau-skupiny';
