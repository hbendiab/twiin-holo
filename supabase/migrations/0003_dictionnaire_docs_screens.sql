-- Migration 0003 : le dictionnaire devient une banque de connaissances par outil
--   docs        : documentation collectée (liens, extraits, parcours-type) -- jsonb
--   screens     : captures de l'outil (chemins Storage, libellé d'écran, OCR, source) -- jsonb
--   audited_at  : dernière exploration par l'audit (shadow agent) pour les outils internes
-- Bucket Storage privé « tool-screens » :
--   public/<outil_id>/<fichier>         -> outils connus : lisible par tous, écrit par service_role seulement
--   <company_id>/<outil_id>/<fichier>   -> outils internes : lisible par l'entreprise, écrit par un admin
-- À appliquer par le propriétaire du projet (SQL Editor). Non rejouable tel quel : voir les « if not exists ».

alter table public.dictionnaire
  add column if not exists docs       jsonb not null default '[]',
  add column if not exists screens    jsonb not null default '[]',
  add column if not exists audited_at timestamptz;

comment on column public.dictionnaire.docs    is '[{ "url": "...", "title": "...", "excerpt": "...", "kind": "doc|tutorial|flow", "fetched_at": "..." }]';
comment on column public.dictionnaire.screens is '[{ "storage_path": "public/<id>/home.png", "label": "Accueil", "ocr_text": "...", "source": "web|audit", "captured_at": "..." }]';

insert into storage.buckets (id, name, public)
values ('tool-screens', 'tool-screens', false)
on conflict (id) do nothing;

create policy tool_screens_select on storage.objects for select to authenticated
  using (bucket_id = 'tool-screens' and (
    (storage.foldername(name))[1] = 'public'
    or (storage.foldername(name))[1] = (select private.company_id())::text));

create policy tool_screens_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-screens' and (select private.is_admin())
    and (storage.foldername(name))[1] = (select private.company_id())::text);

create policy tool_screens_update on storage.objects for update to authenticated
  using (bucket_id = 'tool-screens' and (select private.is_admin())
    and (storage.foldername(name))[1] = (select private.company_id())::text);

create policy tool_screens_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tool-screens' and (select private.is_admin())
    and (storage.foldername(name))[1] = (select private.company_id())::text);
