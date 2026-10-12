-- 0006 — klíče k platformám. Token leží JEN ve Vaultu, v secure.credentials je odkaz.
-- Všechny funkce: security definer, EXECUTE jen service_role (a vlastník postgres,
-- tedy i SQL editor — přes něj majitel klíč ukládá, viz setup/05_meta_klic.sql).

create or replace function public.admin_set_credential(p_provider text, p_label text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cred secure.credentials;
  v_secret uuid;
begin
  if p_provider is null or p_provider not in ('meta', 'tiktok') then
    raise exception 'Neznámý poskytovatel %.', p_provider using errcode = '22023';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Klíč je prázdný.' using errcode = '22023';
  end if;

  select * into v_cred
    from secure.credentials
   where provider = p_provider and label is not distinct from p_label
   for update;

  if found then
    perform vault.update_secret(v_cred.vault_secret_id, btrim(p_token));
    return v_cred.id;
  end if;

  v_secret := vault.create_secret(
    btrim(p_token),
    'credential_' || p_provider || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Klíč ' || p_provider || coalesce(' — ' || p_label, ''));
  insert into secure.credentials (provider, label, vault_secret_id)
  values (p_provider, p_label, v_secret)
  returning id into v_cred.id;
  return v_cred.id;
end;
$$;
revoke all on function public.admin_set_credential(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_credential(text, text, text) to service_role;

create or replace function public.publisher_get_token(p_credential_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from secure.credentials c
    join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
   where c.id = p_credential_id;
$$;
revoke all on function public.publisher_get_token(uuid) from public, anon, authenticated;
grant execute on function public.publisher_get_token(uuid) to service_role;

-- Pro meta-sync: id té jedné Meta credential (nejnovější, kdyby jich bylo víc).
create or replace function public.publisher_meta_credential()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from secure.credentials c
   where c.provider = 'meta'
   order by c.created_at desc, c.id
   limit 1;
$$;
revoke all on function public.publisher_meta_credential() from public, anon, authenticated;
grant execute on function public.publisher_meta_credential() to service_role;
