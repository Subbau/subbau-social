-- 0007 — práva k souborům v bucketu `media` (jen app_user).
-- Samotný bucket (privátní, limit 1 GB, povolené typy) zakládá setup/01_bucket_media.sql.
-- Politiky jsou tady v migraci, protože jsou to práva: mají být verzované, testované
-- a platit od první chvíle, kdy bucket existuje (politika na neexistující bucket nic nepovolí).
-- Edge funkce (service_role) RLS obchází; podepsané URL pro Metu vytváří ona.

create policy media_app_user_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_app_user());

create policy media_app_user_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_app_user());

create policy media_app_user_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_app_user())
  with check (bucket_id = 'media' and public.is_app_user());

create policy media_app_user_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_app_user());
