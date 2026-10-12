-- 05 — uložení klíče Meta (token systémového uživatele z Meta Business Suite).
--
-- NÁVOD:
--   1. Meta Business Suite → Nastavení firmy → Uživatelé → Systémoví uživatelé → (admin)
--      → Přiřadit aktiva: 3 FB stránky + Instagram (plná kontrola) → Vygenerovat token
--      s oprávněními: pages_show_list, pages_read_engagement, pages_manage_posts,
--      business_management, instagram_basic, instagram_content_publish. Platnost: nikdy.
--   2. Níže nahradit <<DOPLNIT …>> a pustit v SQL Editoru.
--      Token se uloží JEN do Vaultu; v tabulkách zůstane jen odkaz (secure.credentials).
--      Jde pustit znovu se stejným popiskem — klíč se přepíše, id zůstane.
--   3. V aplikaci na stránce Účty kliknout „Načíst účty“ (Edge funkce meta-sync).
-- Pozor: SQL Editor si pamatuje historii dotazů; po uložení dotaz z historie smažte.

do $$
declare
  v_token text := '<<DOPLNIT TOKEN SYSTÉMOVÉHO UŽIVATELE META>>';
  v_id uuid;
begin
  if v_token like '<<%' then
    raise exception 'Doplňte token místo <<DOPLNIT …>>.';
  end if;
  v_id := public.admin_set_credential('meta', 'SubBau systémový uživatel', v_token);
  raise notice 'Klíč Meta uložen, credential id = %', v_id;
end $$;

-- Kontrola (token samotný nevypisuje):
select id, provider, label, created_at from secure.credentials;
