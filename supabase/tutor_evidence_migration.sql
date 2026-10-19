-- Ejecuta este archivo en Supabase SQL Editor para habilitar las evidencias.
-- Requiere que tutor_module.sql ya haya creado tutor_estudiantes y
-- public.is_current_user_tutor().

alter table public.tutor_evaluaciones
  add column if not exists evidencia_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidencias_evaluaciones',
  'evidencias_evaluaciones',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tutor_evidence_select_own on storage.objects;
create policy tutor_evidence_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias_evaluaciones'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and tutor_id = auth.uid()
    )
  );

drop policy if exists tutor_evidence_insert_own on storage.objects;
create policy tutor_evidence_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias_evaluaciones'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and tutor_id = auth.uid()
    )
  );

drop policy if exists tutor_evidence_update_own on storage.objects;
create policy tutor_evidence_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'evidencias_evaluaciones'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and tutor_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'evidencias_evaluaciones'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and tutor_id = auth.uid()
    )
  );

drop policy if exists tutor_evidence_delete_own on storage.objects;
create policy tutor_evidence_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidencias_evaluaciones'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and tutor_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
