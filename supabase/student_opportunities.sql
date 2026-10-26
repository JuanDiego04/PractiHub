-- Ejecutar después de empresa_module.sql para habilitar postulaciones desde el portal del aprendiz.

alter table public.postulaciones
  add column if not exists descripcion_perfil text,
  add column if not exists cv_path text;

grant select on public.ofertas to authenticated;

create or replace function public.is_current_user_student()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.perfiles
    where id = auth.uid()
      and rol = 'estudiante'
  );
$$;

create or replace function public.is_current_user_company()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.perfiles
    where id = auth.uid()
      and rol = 'empresa'
  );
$$;

create or replace function public.is_current_user_tutor()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.perfiles
    where id = auth.uid()
      and rol = 'tutor'
  );
$$;

create or replace function public.is_tutor_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.perfiles
    where id = $1
      and rol = 'tutor'
  );
$$;

revoke all on function public.is_current_user_student() from public;
revoke all on function public.is_current_user_company() from public;
revoke all on function public.is_current_user_tutor() from public;
revoke all on function public.is_tutor_profile(uuid) from public;
grant execute on function public.is_current_user_student() to authenticated;
grant execute on function public.is_current_user_company() to authenticated;
grant execute on function public.is_current_user_tutor() to authenticated;
grant execute on function public.is_tutor_profile(uuid) to authenticated;

create or replace function public.student_has_applied_to_offer(offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.postulaciones as application
    where application.oferta_id = $1
      and application.estudiante_id = auth.uid()
  );
$$;

revoke all on function public.student_has_applied_to_offer(uuid) from public;
grant execute on function public.student_has_applied_to_offer(uuid) to authenticated;

create or replace function public.student_can_submit_application(
  p_offer_id uuid,
  p_company_id uuid,
  p_cv_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.ofertas as offer
    where offer.id = p_offer_id
      and offer.empresa_id = p_company_id
      and offer.estado = 'activa'
  )
  and exists (
    select 1
    from storage.objects as file
    where file.bucket_id = 'hojas_vida'
      and file.name = p_cv_path
      and (storage.foldername(file.name))[1] = auth.uid()::text
  );
$$;

revoke all on function public.student_can_submit_application(uuid, uuid, text) from public;
grant execute on function public.student_can_submit_application(uuid, uuid, text) to authenticated;

create or replace function public.student_can_view_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select public.is_current_user_student()
    and exists (
      select 1
      from public.perfiles as company
      where company.id = p_company_id
        and company.rol = 'empresa'
    )
    and (
      exists (
        select 1
        from public.ofertas as offer
        where offer.empresa_id = p_company_id
          and offer.estado = 'activa'
      )
      or exists (
        select 1
        from public.postulaciones as application
        where application.empresa_id = p_company_id
          and application.estudiante_id = auth.uid()
      )
    );
$$;

revoke all on function public.student_can_view_company(uuid) from public;
grant execute on function public.student_can_view_company(uuid) to authenticated;

drop policy if exists ofertas_student_select_available on public.ofertas;
create policy ofertas_student_select_available
  on public.ofertas for select to authenticated
  using (
    public.is_current_user_student()
    and (
      estado = 'activa'
      or public.student_has_applied_to_offer(id)
    )
  );

drop policy if exists perfiles_student_select_offer_companies on public.perfiles;
create policy perfiles_student_select_offer_companies
  on public.perfiles for select to authenticated
  using (
    rol = 'empresa'
    and public.student_can_view_company(id)
  );

drop policy if exists postulaciones_student_insert_active on public.postulaciones;
create policy postulaciones_student_insert_active
  on public.postulaciones for insert to authenticated
  with check (
    estudiante_id = auth.uid()
    and public.is_current_user_student()
    and estado = 'pendiente'
    and tutor_id is null
    and char_length(trim(descripcion_perfil)) between 20 and 2000
    and cv_path like auth.uid()::text || '/%'
    and public.student_can_submit_application(oferta_id, empresa_id, cv_path)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hojas_vida',
  'hojas_vida',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists student_cv_upload_own on storage.objects;
create policy student_cv_upload_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hojas_vida'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_student()
  );

drop policy if exists student_cv_read_own on storage.objects;
create policy student_cv_read_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hojas_vida'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_student()
  );

drop policy if exists company_cv_read_applicants on storage.objects;
create policy company_cv_read_applicants
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hojas_vida'
    and public.is_current_user_company()
    and exists (
      select 1
      from public.postulaciones as application
      where application.cv_path = storage.objects.name
        and application.empresa_id = auth.uid()
    )
  );

drop policy if exists student_cv_delete_own on storage.objects;
create policy student_cv_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'hojas_vida'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_student()
  );

notify pgrst, 'reload schema';
