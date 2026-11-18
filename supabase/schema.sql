-- =====================================================================
-- Twiin — schéma Supabase v0.2 : 4 tables
--   dictionnaire     logiciels (publics ou internes à une entreprise)
--   taches           une tâche observée (étapes, captures, transcription dedans)
--   tests            essais effectués sur une tâche (rejeu Holo, exécution n8n)
--   recommendations  recommandations de l'agent après les tests
--
-- L'entreprise et le rôle de l'utilisateur viennent de son jeton de connexion :
--   auth.jwt() -> 'app_metadata' ->> 'company_id'   (uuid de l'entreprise)
--   auth.jwt() -> 'app_metadata' ->> 'role'          ('admin' ou 'member')
-- app_metadata ne peut être modifié que côté serveur (service_role / dashboard),
-- JAMAIS user_metadata (modifiable par l'utilisateur).
-- =====================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.company_id() returns uuid
language sql stable set search_path = ''
as $$ select nullif((select auth.jwt()) -> 'app_metadata' ->> 'company_id', '')::uuid $$;

create function private.is_admin() returns boolean
language sql stable set search_path = ''
as $$ select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin', false) $$;

revoke all on function private.company_id() from public;
revoke all on function private.is_admin()   from public;
grant execute on function private.company_id() to authenticated;
grant execute on function private.is_admin()   to authenticated;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------
-- DICTIONNAIRE
--   company_id NULL  => logiciel public, visible par toutes les entreprises (Excel, Power BI…)
--   company_id = X   => logiciel interne, visible uniquement par l'entreprise X
-- ---------------------------------------------------------------------
create table public.dictionnaire (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid,
  name        text not null,
  has_api     boolean not null default false,   -- API/connecteur officiel => n8n ; sinon agent Holo
  connector   text,
  domains     text[] not null default '{}',     -- détection par URL
  app_names   text[] not null default '{}',     -- détection par nom d'appli
  created_at  timestamptz not null default now()
);
create unique index dictionnaire_name_public  on public.dictionnaire(lower(name)) where company_id is null;
create unique index dictionnaire_name_company on public.dictionnaire(company_id, lower(name)) where company_id is not null;

-- ---------------------------------------------------------------------
-- TACHES
-- ---------------------------------------------------------------------
create table public.taches (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  recorded_by        uuid not null default auth.uid() references auth.users(id),
  title              text not null,
  summary            text,
  context            text,
  status             text not null default 'recording'
                     check (status in ('recording', 'processing', 'analysed', 'tested', 'failed', 'archived')),
  frequency          text check (frequency in ('rare', 'monthly', 'weekly', 'daily', 'multiple_daily')),
  software_ids       uuid[] not null default '{}',  -- logiciels utilisés (ids du dictionnaire)
  steps              jsonb not null default '[]',   -- [{position, instruction, software_id, at_ms}]
  screenshots        jsonb not null default '[]',   -- [{storage_path, screen_index, at_ms, step, ocr_text}]
  transcript         text,                          -- transcription de l'audio
  audio_path         text,
  stats              jsonb not null default '{}',   -- mesures du journal d'actions
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_s         integer,
  source_session_id  text,                          -- id de la session locale du recorder
  expires_at         timestamptz,                   -- purge RGPD
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, source_session_id)
);
create index taches_company_idx     on public.taches(company_id);
create index taches_recorded_by_idx on public.taches(recorded_by);
create trigger taches_touch before update on public.taches
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- TESTS : récap des essais effectués sur une tâche
-- ---------------------------------------------------------------------
create table public.tests (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.taches(id) on delete cascade,
  kind          text not null check (kind in ('holo_replay', 'n8n_run')),
  status        text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'stopped')),
  success_rate  numeric check (success_rate between 0 and 1),
  summary       text,
  steps_log     jsonb not null default '[]',
  error         text,
  cost_usd      numeric,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index tests_task_idx on public.tests(task_id);

-- ---------------------------------------------------------------------
-- RECOMMENDATIONS
-- ---------------------------------------------------------------------
create table public.recommendations (
  id                            uuid primary key default gen_random_uuid(),
  task_id                       uuid not null references public.taches(id) on delete cascade,
  test_id                       uuid references public.tests(id) on delete set null,
  kind                          text not null check (kind in ('accelerate', 'automate')),
  confidence                    text check (confidence in ('high', 'medium', 'low')),
  summary                       text,
  reasons                       text[] not null default '{}',
  frequency_hint                text,
  time_saved_label              text,
  time_saved_minutes_per_month  integer,
  plan                          jsonb not null default '[]',  -- [{position, item_type: plan_step|advice, software_id, method: n8n_api|holo|manual, description}]
  status                        text not null default 'proposed'
                                check (status in ('proposed', 'accepted', 'rejected', 'implemented')),
  decided_by                    uuid references auth.users(id),
  decided_at                    timestamptz,
  deliverable_type              text check (deliverable_type in ('video_tuto', 'n8n_workflow')),
  deliverable_ref               text,
  model                         text,
  cost_usd                      numeric,
  created_at                    timestamptz not null default now()
);
create index recommendations_task_idx on public.recommendations(task_id);
create index recommendations_test_idx on public.recommendations(test_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.dictionnaire     enable row level security;
alter table public.taches           enable row level security;
alter table public.tests            enable row level security;
alter table public.recommendations  enable row level security;

create policy dictionnaire_select on public.dictionnaire for select to authenticated
  using (company_id is null or company_id = (select private.company_id()));
create policy dictionnaire_insert on public.dictionnaire for insert to authenticated
  with check (company_id = (select private.company_id()) and (select private.is_admin()));
create policy dictionnaire_update on public.dictionnaire for update to authenticated
  using      (company_id = (select private.company_id()) and (select private.is_admin()))
  with check (company_id = (select private.company_id()));
create policy dictionnaire_delete on public.dictionnaire for delete to authenticated
  using (company_id = (select private.company_id()) and (select private.is_admin()));

-- Un employé voit ses tâches ; un admin voit toutes celles de son entreprise.
create policy taches_select on public.taches for select to authenticated
  using (company_id = (select private.company_id())
         and (recorded_by = (select auth.uid()) or (select private.is_admin())));
create policy taches_insert on public.taches for insert to authenticated
  with check (company_id = (select private.company_id()) and recorded_by = (select auth.uid()));
create policy taches_update on public.taches for update to authenticated
  using      (company_id = (select private.company_id())
              and (recorded_by = (select auth.uid()) or (select private.is_admin())))
  with check (company_id = (select private.company_id()));
create policy taches_delete on public.taches for delete to authenticated
  using (company_id = (select private.company_id())
         and (recorded_by = (select auth.uid()) or (select private.is_admin())));

-- tests et recommendations héritent de la visibilité de la tâche
create policy tests_all on public.tests for all to authenticated
  using      (exists (select 1 from public.taches k where k.id = tests.task_id))
  with check (exists (select 1 from public.taches k where k.id = tests.task_id));
create policy recommendations_all on public.recommendations for all to authenticated
  using      (exists (select 1 from public.taches k where k.id = recommendations.task_id))
  with check (exists (select 1 from public.taches k where k.id = recommendations.task_id));

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- STORAGE : bucket privé, fichiers rangés par <company_id>/<task_id>/…
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('task-captures', 'task-captures', false)
on conflict (id) do nothing;

create policy task_captures_select on storage.objects for select to authenticated
  using (bucket_id = 'task-captures' and (storage.foldername(name))[1] = (select private.company_id())::text);
create policy task_captures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-captures' and (storage.foldername(name))[1] = (select private.company_id())::text);
create policy task_captures_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-captures' and (storage.foldername(name))[1] = (select private.company_id())::text);

-- ---------------------------------------------------------------------
-- Catalogue public de départ
-- ---------------------------------------------------------------------
insert into public.dictionnaire (name, has_api, connector) values
  ('Excel',         true,  'microsoft-graph'),
  ('Outlook',       true,  'microsoft-graph'),
  ('Word',          true,  'microsoft-graph'),
  ('Power BI',      true,  'microsoft-graph'),
  ('Google Sheets', true,  'google-workspace'),
  ('Gmail',         true,  'google-workspace'),
  ('LinkedIn',      false, null);
