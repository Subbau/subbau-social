-- 01 — privátní bucket `media` pro fotky a videa.
--
-- NÁVOD: Supabase → SQL Editor → vložit celý soubor → Run. Jde pustit opakovaně
-- (podruhé jen srovná nastavení). Práva k souborům (jen app_user) přidávají migrace
-- (0007_storage.sql) — ty musí proběhnout PŘED tímto souborem nebo hned po něm.
--
-- LIMIT SOUBORU 50 MB — projekt běží na plánu Free, kde Supabase víc nepovolí
-- (globální strop Free plánu je 50 MB na soubor).
-- Po přechodu na Pro se dá zvednout, např. na 1 GB:
--   1. Dashboard → Storage → Settings → Upload file size limit → 1 GB (globální limit projektu),
--   2. v SQL Editoru:
--        update storage.buckets set file_size_limit = 1073741824 where id = 'media';
--   3. a TADY v souboru přepsat 52428800 na 1073741824 — jinak by opakované puštění
--      tohoto souboru limit vrátilo na 50 MB.
-- Soubory nad ~6 MB má UI nahrávat obnovitelně (TUS / resumable upload).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  52428800, -- 50 MB (plán Free); na Pro viz návod nahoře
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Kontrola: má vrátit jeden řádek s public = false.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'media';
