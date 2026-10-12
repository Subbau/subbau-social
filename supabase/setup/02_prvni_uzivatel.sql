-- 02 — zapsání majitele do app_users (bez toho po přihlášení neuvidí nic).
--
-- NÁVOD:
--   1. Dashboard → Authentication → Users → Add user → e-mail + heslo (Auto Confirm).
--   2. Dashboard → Authentication → Sign In / Providers: VYPNOUT „Allow new users to sign up“.
--      (Registrace by stejně nic neukázala — RLS pustí jen app_users — ale nemá být otevřená.)
--   3. Níže nahradit <<DOPLNIT …>> a pustit v SQL Editoru. Bez náhrady soubor skončí chybou.

do $$
declare
  v_email text := '<<DOPLNIT E-MAIL MAJITELE>>';
  v_jmeno text := '<<DOPLNIT JMÉNO>>';
  v_pocet int;
begin
  if v_email like '<<%' or v_jmeno like '<<%' then
    raise exception 'Nejdřív v souboru doplňte e-mail a jméno místo <<DOPLNIT …>>.';
  end if;

  insert into public.app_users (id, email, name, role)
  select u.id, u.email, v_jmeno, 'admin'
    from auth.users u
   where lower(u.email) = lower(v_email)
  on conflict (id) do update set email = excluded.email, name = excluded.name;

  get diagnostics v_pocet = row_count;
  if v_pocet = 0 then
    raise exception 'Uživatel % v Authentication → Users není. Nejdřív ho založte (krok 1).', v_email;
  end if;
end $$;

select id, email, name, role from public.app_users;
