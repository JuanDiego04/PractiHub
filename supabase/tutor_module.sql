-- Ejecuta este archivo en Supabase SQL Editor.
-- Requiere public.perfiles(id uuid, nombre, email, rol) y auth.uid().

create or replace function public.is_current_user_tutor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles
    where id = auth.uid()
      and rol = 'tutor'
  );
$$;

create or replace function public.is_student_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles
    where id = profile_id
      and rol = 'estudiante'
  );
$$;

revoke all on function public.is_current_user_tutor() from public;
revoke all on function public.is_student_profile(uuid) from public;
grant execute on function public.is_current_user_tutor() to authenticated;
grant execute on function public.is_student_profile(uuid) to authenticated;

create table if not exists public.tutor_estudiantes (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.perfiles(id) on delete cascade,
  estudiante_id uuid not null references public.perfiles(id) on delete cascade,
  empresa text not null check (length(trim(empresa)) > 0),
  cargo text not null check (length(trim(cargo)) > 0),
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'en_curso'
    check (estado in ('en_curso', 'finalizada')),
  created_at timestamptz not null default now(),
  constraint tutor_estudiantes_fechas_validas
    check (fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio),
  constraint tutor_estudiantes_no_autoasignacion
    check (tutor_id <> estudiante_id)
);

create index if not exists tutor_estudiantes_tutor_created_idx
  on public.tutor_estudiantes (tutor_id, created_at desc);
create index if not exists tutor_estudiantes_estudiante_idx
  on public.tutor_estudiantes (estudiante_id);

create table if not exists public.tutor_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  estudiante_asignado_id uuid not null
    references public.tutor_estudiantes(id) on delete cascade,
  calificacion numeric(5, 2) not null check (calificacion >= 0 and calificacion <= 100),
  retroalimentacion text not null check (length(trim(retroalimentacion)) >= 5),
  resultado text not null check (resultado in ('aprobada', 'reprobada')),
  evidencia_path text,
  created_at timestamptz not null default now()
);

create index if not exists tutor_evaluaciones_asignacion_created_idx
  on public.tutor_evaluaciones (estudiante_asignado_id, created_at desc);

grant select, insert, update, delete on public.tutor_estudiantes to authenticated;
grant select, insert on public.tutor_evaluaciones to authenticated;

alter table public.tutor_estudiantes enable row level security;
alter table public.tutor_evaluaciones enable row level security;

drop policy if exists tutor_estudiantes_select_own on public.tutor_estudiantes;
create policy tutor_estudiantes_select_own
  on public.tutor_estudiantes for select to authenticated
  using (tutor_id = auth.uid() and public.is_current_user_tutor());

drop policy if exists tutor_estudiantes_insert_own on public.tutor_estudiantes;
create policy tutor_estudiantes_insert_own
  on public.tutor_estudiantes for insert to authenticated
  with check (
    tutor_id = auth.uid()
    and public.is_current_user_tutor()
    and public.is_student_profile(estudiante_id)
  );

drop policy if exists tutor_estudiantes_update_own on public.tutor_estudiantes;
create policy tutor_estudiantes_update_own
  on public.tutor_estudiantes for update to authenticated
  using (tutor_id = auth.uid() and public.is_current_user_tutor())
  with check (
    tutor_id = auth.uid()
    and public.is_current_user_tutor()
    and public.is_student_profile(estudiante_id)
  );

drop policy if exists tutor_estudiantes_delete_own on public.tutor_estudiantes;
create policy tutor_estudiantes_delete_own
  on public.tutor_estudiantes for delete to authenticated
  using (tutor_id = auth.uid() and public.is_current_user_tutor());

drop policy if exists tutor_evaluaciones_select_own on public.tutor_evaluaciones;
create policy tutor_evaluaciones_select_own
  on public.tutor_evaluaciones for select to authenticated
  using (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and tutor_id = auth.uid()
    )
  );

drop policy if exists tutor_evaluaciones_insert_own on public.tutor_evaluaciones;
create policy tutor_evaluaciones_insert_own
  on public.tutor_evaluaciones for insert to authenticated
  with check (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and tutor_id = auth.uid()
    )
  );

drop policy if exists perfiles_tutor_assigned_students_select on public.perfiles;
create policy perfiles_tutor_assigned_students_select
  on public.perfiles for select to authenticated
  using (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where estudiante_id = perfiles.id
        and tutor_id = auth.uid()
    )
  );

create or replace function public.tutor_assign_student(
  p_email text,
  p_empresa text,
  p_cargo text,
  p_fecha_inicio date default null,
  p_fecha_fin date default null
)
returns table (estudiante_id uuid, nombre text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor_id uuid := auth.uid();
  v_estudiante_id uuid;
  v_nombre text;
begin
  if not public.is_current_user_tutor() then
    raise exception 'Solo un perfil tutor puede asignar estudiantes.';
  end if;

  if nullif(trim(p_email), '') is null
    or nullif(trim(p_empresa), '') is null
    or nullif(trim(p_cargo), '') is null then
    raise exception 'Correo, empresa y cargo son obligatorios.';
  end if;

  if p_fecha_inicio is not null and p_fecha_fin is not null
    and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de finalización no puede ser anterior a la fecha de inicio.';
  end if;

  select perfil.id, perfil.nombre
    into v_estudiante_id, v_nombre
  from public.perfiles as perfil
  where lower(perfil.email) = lower(trim(p_email))
    and perfil.rol = 'estudiante';

  if not found then
    raise exception 'No encontramos un perfil de estudiante con ese correo.';
  end if;

  if v_estudiante_id = v_tutor_id then
    raise exception 'No puedes asignarte a ti mismo como estudiante.';
  end if;

  insert into public.tutor_estudiantes (
    tutor_id,
    estudiante_id,
    empresa,
    cargo,
    fecha_inicio,
    fecha_fin
  )
  values (
    v_tutor_id,
    v_estudiante_id,
    trim(p_empresa),
    trim(p_cargo),
    p_fecha_inicio,
    p_fecha_fin
  );

  return query select v_estudiante_id, v_nombre;
end;
$$;

revoke all on function public.tutor_assign_student(text, text, text, date, date) from public;
grant execute on function public.tutor_assign_student(text, text, text, date, date) to authenticated;

-- Migración para evidencias privadas y CRUD de evaluaciones.
alter table public.tutor_evaluaciones
  add column if not exists evidencia_path text;

grant update, delete on public.tutor_evaluaciones to authenticated;

drop policy if exists tutor_evaluaciones_update_own on public.tutor_evaluaciones;
create policy tutor_evaluaciones_update_own
  on public.tutor_evaluaciones for update to authenticated
  using (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and tutor_id = auth.uid()
    )
  )
  with check (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and tutor_id = auth.uid()
    )
  );

drop policy if exists tutor_evaluaciones_delete_own on public.tutor_evaluaciones;
create policy tutor_evaluaciones_delete_own
  on public.tutor_evaluaciones for delete to authenticated
  using (
    public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and tutor_id = auth.uid()
    )
  );

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
