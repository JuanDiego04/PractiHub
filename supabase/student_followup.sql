-- Seguimiento académico instructor-estudiante, independiente del módulo de ofertas.
-- Ejecutar después de tutor_module.sql en el SQL Editor del proyecto Supabase.

alter table public.tutor_estudiantes
  add column if not exists empresa_id uuid references public.perfiles(id) on delete set null,
  add column if not exists jefe_inmediato text,
  add column if not exists postulacion_id uuid;

create unique index if not exists tutor_estudiantes_postulacion_unique
  on public.tutor_estudiantes (postulacion_id)
  where postulacion_id is not null;

create or replace function public.is_current_user_student()
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
      and rol = 'estudiante'
  );
$$;

revoke all on function public.is_current_user_student() from public;
grant execute on function public.is_current_user_student() to authenticated;

create or replace function public.is_current_user_company()
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
      and rol = 'empresa'
  );
$$;

revoke all on function public.is_current_user_company() from public;
grant execute on function public.is_current_user_company() to authenticated;

drop function if exists public.tutor_assign_student(text, text, text, date, date);
create or replace function public.tutor_assign_student(
  p_email text,
  p_empresa text,
  p_cargo text,
  p_fecha_inicio date default null,
  p_fecha_fin date default null,
  p_empresa_id uuid default null,
  p_jefe_inmediato text default null
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
  v_empresa text;
begin
  if not public.is_current_user_tutor() then
    raise exception 'Solo un instructor puede asignar estudiantes.';
  end if;

  if nullif(trim(p_email), '') is null
    or nullif(trim(p_cargo), '') is null
    or (p_empresa_id is null and nullif(trim(p_empresa), '') is null) then
    raise exception 'Correo, empresa y cargo son obligatorios.';
  end if;

  if p_fecha_inicio is not null and p_fecha_fin is not null
    and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de finalización no puede ser anterior a la fecha de inicio.';
  end if;

  if p_empresa_id is not null then
    select perfil.nombre into v_empresa
    from public.perfiles as perfil
    where perfil.id = p_empresa_id
      and perfil.rol = 'empresa';

    if not found then
      raise exception 'La cuenta seleccionada no corresponde a una empresa.';
    end if;
  else
    v_empresa := trim(p_empresa);
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
    fecha_fin,
    empresa_id,
    jefe_inmediato
  )
  values (
    v_tutor_id,
    v_estudiante_id,
    v_empresa,
    trim(p_cargo),
    p_fecha_inicio,
    p_fecha_fin,
    p_empresa_id,
    nullif(trim(p_jefe_inmediato), '')
  );

  return query select v_estudiante_id, v_nombre;
end;
$$;

revoke all on function public.tutor_assign_student(text, text, text, date, date, uuid, text) from public;
grant execute on function public.tutor_assign_student(text, text, text, date, date, uuid, text) to authenticated;

drop policy if exists perfiles_tutor_select_companies on public.perfiles;
create policy perfiles_tutor_select_companies
  on public.perfiles for select to authenticated
  using (rol = 'empresa' and public.is_current_user_tutor());

drop policy if exists perfiles_student_select_linked_tutor on public.perfiles;
create policy perfiles_student_select_linked_tutor
  on public.perfiles for select to authenticated
  using (
    rol = 'tutor'
    and public.is_current_user_student()
    and exists (
      select 1
      from public.tutor_estudiantes
      where estudiante_id = auth.uid()
        and tutor_id = perfiles.id
    )
  );

drop policy if exists perfiles_student_select_linked_company on public.perfiles;
create policy perfiles_student_select_linked_company
  on public.perfiles for select to authenticated
  using (
    rol = 'empresa'
    and public.is_current_user_student()
    and exists (
      select 1
      from public.tutor_estudiantes
      where estudiante_id = auth.uid()
        and empresa_id = perfiles.id
    )
  );

drop policy if exists tutor_estudiantes_select_own_student on public.tutor_estudiantes;
create policy tutor_estudiantes_select_own_student
  on public.tutor_estudiantes for select to authenticated
  using (estudiante_id = auth.uid() and public.is_current_user_student());

drop policy if exists tutor_estudiantes_select_linked_company on public.tutor_estudiantes;
create policy tutor_estudiantes_select_linked_company
  on public.tutor_estudiantes for select to authenticated
  using (empresa_id = auth.uid() and public.is_current_user_company());

drop policy if exists tutor_evaluaciones_select_own_student on public.tutor_evaluaciones;
create policy tutor_evaluaciones_select_own_student
  on public.tutor_evaluaciones for select to authenticated
  using (
    public.is_current_user_student()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and estudiante_id = auth.uid()
    )
  );

create table if not exists public.evidencias_estudiantes (
  id uuid primary key default gen_random_uuid(),
  postulacion_id uuid,
  tutor_estudiante_id uuid not null references public.tutor_estudiantes(id) on delete cascade,
  estudiante_id uuid not null references public.perfiles(id) on delete cascade,
  empresa_id uuid references public.perfiles(id) on delete set null,
  tutor_id uuid references public.perfiles(id) on delete set null,
  tipo text not null check (tipo in ('academica', 'empresa')),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  descripcion text not null check (length(trim(descripcion)) >= 5),
  archivo_path text not null unique,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  )),
  tamanio_bytes bigint not null check (tamanio_bytes > 0 and tamanio_bytes <= 10485760),
  created_at timestamptz not null default now()
);

alter table public.evidencias_estudiantes
  add column if not exists postulacion_id uuid,
  add column if not exists tutor_estudiante_id uuid references public.tutor_estudiantes(id) on delete cascade,
  add column if not exists estudiante_id uuid references public.perfiles(id) on delete cascade,
  add column if not exists empresa_id uuid references public.perfiles(id) on delete set null,
  add column if not exists tutor_id uuid references public.perfiles(id) on delete set null,
  add column if not exists tipo text,
  add column if not exists titulo text,
  add column if not exists descripcion text,
  add column if not exists archivo_path text,
  add column if not exists mime_type text,
  add column if not exists tamanio_bytes bigint,
  add column if not exists created_at timestamptz not null default now();

alter table public.evidencias_estudiantes
  alter column postulacion_id drop not null,
  alter column empresa_id drop not null;

create index if not exists evidencias_estudiantes_assignment_created_idx
  on public.evidencias_estudiantes (tutor_estudiante_id, created_at desc);
create index if not exists evidencias_estudiantes_tutor_created_idx
  on public.evidencias_estudiantes (tutor_id, created_at desc)
  where tutor_id is not null;

grant select, insert on public.evidencias_estudiantes to authenticated;
alter table public.evidencias_estudiantes enable row level security;

alter table public.tutor_evaluaciones
  add column if not exists evidencia_path text;

grant select, insert, update, delete on public.tutor_evaluaciones to authenticated;

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

create or replace function public.tutor_delete_evaluation(
  p_evaluation_id uuid,
  p_assignment_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence_path text;
begin
  if not public.is_current_user_tutor() then
    raise exception 'Solo el instructor asignado puede eliminar esta evaluación.';
  end if;

  delete from public.tutor_evaluaciones as evaluation
  where evaluation.id = p_evaluation_id
    and evaluation.estudiante_asignado_id = p_assignment_id
    and exists (
      select 1
      from public.tutor_estudiantes as assignment
      where assignment.id = evaluation.estudiante_asignado_id
        and assignment.tutor_id = auth.uid()
    )
  returning evaluation.evidencia_path into v_evidence_path;

  if not found then
    raise exception 'No se encontró la evaluación o no pertenece a un seguimiento asignado a tu cuenta.';
  end if;

  return v_evidence_path;
end;
$$;

revoke all on function public.tutor_delete_evaluation(uuid, uuid) from public;
grant execute on function public.tutor_delete_evaluation(uuid, uuid) to authenticated;

drop policy if exists evidencias_estudiantes_student_select_own on public.evidencias_estudiantes;
create policy evidencias_estudiantes_student_select_own
  on public.evidencias_estudiantes for select to authenticated
  using (estudiante_id = auth.uid() and public.is_current_user_student());

drop policy if exists evidencias_estudiantes_student_insert_assigned on public.evidencias_estudiantes;
create policy evidencias_estudiantes_student_insert_assigned
  on public.evidencias_estudiantes for insert to authenticated
  with check (
    estudiante_id = auth.uid()
    and public.is_current_user_student()
    and exists (
      select 1
      from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.estudiante_id = auth.uid()
        and assignment.estado = 'en_curso'
        and assignment.tutor_id is not distinct from evidencias_estudiantes.tutor_id
        and assignment.empresa_id is not distinct from evidencias_estudiantes.empresa_id
        and assignment.postulacion_id is not distinct from evidencias_estudiantes.postulacion_id
        and (tipo = 'academica' or (tipo = 'empresa' and assignment.empresa_id is not null))
    )
  );

drop policy if exists evidencias_estudiantes_tutor_select_assigned on public.evidencias_estudiantes;
create policy evidencias_estudiantes_tutor_select_assigned
  on public.evidencias_estudiantes for select to authenticated
  using (
    tipo = 'academica'
    and tutor_id = auth.uid()
    and public.is_current_user_tutor()
    and exists (
      select 1
      from public.tutor_estudiantes
      where id = evidencias_estudiantes.tutor_estudiante_id
        and tutor_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidencias_estudiantes',
  'evidencias_estudiantes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists student_evidence_upload_own on storage.objects;
create policy student_evidence_upload_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias_estudiantes'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.tutor_estudiantes
      where id::text = (storage.foldername(name))[2]
        and estudiante_id = auth.uid()
        and estado = 'en_curso'
    )
  );

drop policy if exists student_evidence_read_related on storage.objects;
create policy student_evidence_read_related
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias_estudiantes'
    and exists (
      select 1
      from public.evidencias_estudiantes as evidence
      where evidence.archivo_path = name
        and (
          evidence.estudiante_id = auth.uid()
          or (evidence.tipo = 'academica' and evidence.tutor_id = auth.uid())
          or (evidence.tipo = 'empresa' and evidence.empresa_id = auth.uid())
        )
    )
  );

drop policy if exists student_evidence_delete_own on storage.objects;
create policy student_evidence_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidencias_estudiantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists student_read_tutor_evaluation_evidence on storage.objects;
create policy student_read_tutor_evaluation_evidence
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias_evaluaciones'
    and public.is_current_user_student()
    and exists (
      select 1
      from public.tutor_evaluaciones as evaluation
      join public.tutor_estudiantes as assignment
        on assignment.id = evaluation.estudiante_asignado_id
      where evaluation.evidencia_path = name
        and assignment.estudiante_id = auth.uid()
    )
  );

create unique index if not exists tutor_estudiantes_id_empresa_unique
  on public.tutor_estudiantes (id, empresa_id);

create table if not exists public.entregables_empresa (
  id uuid primary key default gen_random_uuid(),
  tutor_estudiante_id uuid not null references public.tutor_estudiantes(id) on delete cascade,
  postulacion_id uuid,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 150),
  descripcion text not null check (length(trim(descripcion)) between 1 and 3000),
  enlace_adjunto text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'completado')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint entregables_empresa_completion_consistent check (
    (estado = 'pendiente' and completed_at is null and enlace_adjunto is null)
    or (estado = 'completado' and completed_at is not null and enlace_adjunto ~ '^https?://')
  ),
  constraint entregables_empresa_assignment_company_fk
    foreign key (tutor_estudiante_id, empresa_id)
    references public.tutor_estudiantes(id, empresa_id)
    on delete cascade
);

create index if not exists entregables_empresa_assignment_created_idx
  on public.entregables_empresa (tutor_estudiante_id, created_at desc);

alter table public.entregables_empresa enable row level security;
grant select on public.entregables_empresa to authenticated;
grant insert, update, delete on public.entregables_empresa to authenticated;
revoke update on public.entregables_empresa from authenticated;
grant update (estado, enlace_adjunto, completed_at) on public.entregables_empresa to authenticated;

drop policy if exists entregables_empresa_select_related on public.entregables_empresa;
create policy entregables_empresa_select_related
  on public.entregables_empresa for select to authenticated
  using (
    exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and (
          assignment.estudiante_id = auth.uid()
          or (assignment.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
  );

drop policy if exists entregables_empresa_company_insert on public.entregables_empresa;
create policy entregables_empresa_company_insert
  on public.entregables_empresa for insert to authenticated
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and estado = 'pendiente'
    and enlace_adjunto is null
    and completed_at is null
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.empresa_id = auth.uid()
        and assignment.estado = 'en_curso'
    )
  );

drop policy if exists entregables_empresa_student_complete on public.entregables_empresa;
create policy entregables_empresa_student_complete
  on public.entregables_empresa for update to authenticated
  using (
    estado = 'pendiente'
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.estudiante_id = auth.uid()
        and assignment.estado = 'en_curso'
    )
  )
  with check (
    estado = 'completado'
    and completed_at is not null
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.estudiante_id = auth.uid()
        and assignment.estado = 'en_curso'
    )
  );

create table if not exists public.novedades_practica (
  id uuid primary key default gen_random_uuid(),
  tutor_estudiante_id uuid not null references public.tutor_estudiantes(id) on delete cascade,
  postulacion_id uuid,
  estudiante_id uuid not null references public.perfiles(id) on delete cascade,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('retraso', 'ausencia_salud', 'permiso_personal')),
  justificacion text not null check (length(trim(justificacion)) between 5 and 2000),
  estado text not null default 'enviado' check (estado in ('enviado', 'leido')),
  created_at timestamptz not null default now(),
  constraint novedades_practica_assignment_company_fk
    foreign key (tutor_estudiante_id, empresa_id)
    references public.tutor_estudiantes(id, empresa_id)
    on delete cascade
);

create index if not exists novedades_practica_assignment_created_idx
  on public.novedades_practica (tutor_estudiante_id, created_at desc);

alter table public.novedades_practica enable row level security;
grant select, insert, update on public.novedades_practica to authenticated;
revoke update on public.novedades_practica from authenticated;
grant update (estado) on public.novedades_practica to authenticated;

drop policy if exists novedades_practica_select_related on public.novedades_practica;
create policy novedades_practica_select_related
  on public.novedades_practica for select to authenticated
  using (
    estudiante_id = auth.uid()
    or (empresa_id = auth.uid() and public.is_current_user_company())
  );

drop policy if exists novedades_practica_student_insert on public.novedades_practica;
create policy novedades_practica_student_insert
  on public.novedades_practica for insert to authenticated
  with check (
    estudiante_id = auth.uid()
    and estado = 'enviado'
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.estudiante_id = auth.uid()
        and assignment.empresa_id = novedades_practica.empresa_id
        and assignment.estado = 'en_curso'
    )
  );

drop policy if exists novedades_practica_company_mark_read on public.novedades_practica;
create policy novedades_practica_company_mark_read
  on public.novedades_practica for update to authenticated
  using (empresa_id = auth.uid() and public.is_current_user_company())
  with check (empresa_id = auth.uid() and public.is_current_user_company() and estado = 'leido');

create table if not exists public.feedback_empresa (
  id uuid primary key default gen_random_uuid(),
  tutor_estudiante_id uuid not null references public.tutor_estudiantes(id) on delete cascade,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  comentario text not null check (length(trim(comentario)) between 5 and 3000),
  created_at timestamptz not null default now(),
  constraint feedback_empresa_assignment_company_fk
    foreign key (tutor_estudiante_id, empresa_id)
    references public.tutor_estudiantes(id, empresa_id)
    on delete cascade
);

create index if not exists feedback_empresa_assignment_created_idx
  on public.feedback_empresa (tutor_estudiante_id, created_at desc);

alter table public.feedback_empresa enable row level security;
grant select, insert, update on public.feedback_empresa to authenticated;

drop policy if exists feedback_empresa_select_related on public.feedback_empresa;
create policy feedback_empresa_select_related
  on public.feedback_empresa for select to authenticated
  using (
    exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and (
          assignment.estudiante_id = auth.uid()
          or (assignment.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
  );

drop policy if exists feedback_empresa_company_manage on public.feedback_empresa;
create policy feedback_empresa_company_manage
  on public.feedback_empresa for all to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.empresa_id = auth.uid()
    )
  )
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1 from public.tutor_estudiantes as assignment
      where assignment.id = tutor_estudiante_id
        and assignment.empresa_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

select to_regclass('public.evidencias_estudiantes') as tabla_bitacoras,
       to_regclass('public.tutor_estudiantes') as tabla_seguimientos,
       to_regclass('public.entregables_empresa') as tabla_entregables_empresa,
       to_regclass('public.novedades_practica') as tabla_novedades,
       to_regclass('public.feedback_empresa') as tabla_feedback_empresa;
