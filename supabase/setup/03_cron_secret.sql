-- 03 — CRON_SECRET do Vaultu (heslo, kterým pg_cron volá Edge funkce publisher a check-accounts).
--
-- NÁVOD:
--   1. Vygenerovat náhodný řetězec aspoň 32 znaků, např. v Terminálu:  openssl rand -hex 32
--   2. Ten SAMÝ řetězec uložit jako secret Edge funkcí:
--        Dashboard → Edge Functions → Secrets → CRON_SECRET = <řetězec>
--      (nebo `supabase secrets set CRON_SECRET=<řetězec>`). Kratší než 24 znaků funkce odmítnou.
--   3. Níže nahradit <<DOPLNIT …>> a pustit v SQL Editoru. Jde pustit znovu (secret se přepíše).
-- Do textu cron jobu se secret NEPÍŠE — job si ho čte z Vaultu při každém spuštění (04_cron.sql).
-- Pozor: SQL Editor si pamatuje historii dotazů; po uložení dotaz z historie smažte.

do $$
declare
  v_secret text := '<<DOPLNIT CRON_SECRET (min. 32 znaků)>>';
  v_id uuid;
begin
  if v_secret like '<<%' or length(v_secret) < 32 then
    raise exception 'Doplňte CRON_SECRET (aspoň 32 znaků) místo <<DOPLNIT …>>.';
  end if;
  select id into v_id from vault.decrypted_secrets where name = 'subbau_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'subbau_cron_secret', 'Bearer pro Edge funkce publisher a check-accounts');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end $$;

-- Kontrola (secret samotný nevypisuje):
select name, length(decrypted_secret) as delka from vault.decrypted_secrets where name = 'subbau_cron_secret';
