-- Ejecuta este archivo en Supabase SQL Editor después de tutor_module.sql.
-- ofertas debe tener empresa_id como FK a perfiles(id), como usa el catálogo de ofertas.

do $$
begin
  if to_regclass('public.ofertas') is null then
    raise exception 'No existe public.ofertas. Crea el catálogo de ofertas antes de ejecutar student_module.sql.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ofertas'
      and column_name = 'empresa_id'
  ) then
    raise exception 'public.ofertas debe tener empresa_id (FK a perfiles.id) para relacionar las postulaciones con la empresa.';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_row
    join pg_attribute as offer_company
      on offer_company.attrelid = constraint_row.conrelid
      and offer_company.attname = 'empresa_id'
      and not offer_company.attisdropped
    join pg_attribute as profile_id
      on profile_id.attrelid = constraint_row.confrelid
      and profile_id.attname = 'id'
      and not profile_id.attisdropped
    where constraint_row.contype = 'f'
      and constraint_row.conrelid = 'public.ofertas'::regclass
      and constraint_row.confrelid = 'public.perfiles'::regclass
      and constraint_row.conkey = array[offer_company.attnum]::smallint[]
      and constraint_row.confkey = array[profile_id.attnum]::smallint[]
  ) then
    raise exception 'public.ofertas.empresa_id debe tener una clave foránea a public.perfiles(id).';
  end if;
end;
$$;

alter table public.ofertas
  add column if not exists fecha_inicio date,
  add column if not exists fecha_fin date,
  add column if not exists jefe_inmediato text;

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

create or replace function public.is_tutor_profile(profile_id uuid)
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
      and rol = 'tutor'
  );
$$;

revoke all on function public.is_current_user_company() from public;
revoke all on function public.is_tutor_profile(uuid) from public;
grant execute on function public.is_current_user_company() to authenticated;
grant execute on function public.is_tutor_profile(uuid) to authenticated;

create table if not exists public.postulaciones (
  id uuid primary key default gen_random_uuid(),
  oferta_id uuid not null references public.ofertas(id) on delete cascade,
  estudiante_id uuid not null references public.perfiles(id) on delete cascade,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  tutor_id uuid references public.perfiles(id) on delete set null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'contratada', 'rechazada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint postulaciones_oferta_estudiante_unique unique (oferta_id, estudiante_id),
  constraint postulaciones_tutor_distinto_estudiante check (tutor_id is null or tutor_id <> estudiante_id)
);

alter table public.postulaciones
  add column if not exists empresa_id uuid references public.perfiles(id) on delete cascade,
  add column if not exists tutor_id uuid references public.perfiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.postulaciones as application
set empresa_id = offer.empresa_id
from public.ofertas as offer
where offer.id = application.oferta_id
  and application.empresa_id is null;

do $$
begin
  if exists (
    select 1
    from public.postulaciones
    where empresa_id is null
  ) then
    raise exception 'No se pudo completar empresa_id en postulaciones. Verifica que cada postulación apunte a una oferta con empresa_id antes de volver a ejecutar student_module.sql.';
  end if;
end;
$$;

alter table public.postulaciones
  alter column empresa_id set not null;

create index if not exists postulaciones_estudiante_created_idx
  on public.postulaciones (estudiante_id, created_at desc);
create index if not exists postulaciones_empresa_estado_idx
  on public.postulaciones (empresa_id, estado, created_at desc);
create index if not exists postulaciones_tutor_idx
  on public.postulaciones (tutor_id)
  where tutor_id is not null;

grant select, insert, update on public.postulaciones to authenticated;
revoke update on public.postulaciones from authenticated;
grant update (estado, tutor_id, updated_at) on public.postulaciones to authenticated;
alter table public.postulaciones enable row level security;

drop policy if exists postulaciones_student_select_own on public.postulaciones;
create policy postulaciones_student_select_own
  on public.postulaciones for select to authenticated
  using (estudiante_id = auth.uid() and public.is_current_user_student());

drop policy if exists postulaciones_student_insert_active on public.postulaciones;
create policy postulaciones_student_insert_active
  on public.postulaciones for insert to authenticated
  with check (
    estudiante_id = auth.uid()
    and public.is_current_user_student()
    and estado = 'pendiente'
    and tutor_id is null
    and exists (
      select 1
      from public.ofertas
      where id = oferta_id
        and empresa_id = postulaciones.empresa_id
        and estado = 'activa'
    )
  );

drop policy if exists postulaciones_company_select_own on public.postulaciones;
create policy postulaciones_company_select_own
  on public.postulaciones for select to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
  );

drop policy if exists postulaciones_company_update_own on public.postulaciones;
create policy postulaciones_company_update_own
  on public.postulaciones for update to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
  )
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and (tutor_id is null or public.is_tutor_profile(tutor_id))
  );

drop policy if exists postulaciones_tutor_select_assigned on public.postulaciones;
create policy postulaciones_tutor_select_assigned
  on public.postulaciones for select to authenticated
  using (tutor_id = auth.uid() and public.is_current_user_tutor());

drop policy if exists perfiles_company_select_applicants on public.perfiles;
create policy perfiles_company_select_applicants
  on public.perfiles for select to authenticated
  using (
    rol = 'estudiante'
    and exists (
      select 1
      from public.postulaciones
      where estudiante_id = perfiles.id
        and empresa_id = auth.uid()
    )
    and public.is_current_user_company()
  );

alter table public.tutor_estudiantes
  add column if not exists postulacion_id uuid references public.postulaciones(id) on delete set null,
  add column if not exists empresa_id uuid references public.perfiles(id) on delete set null,
  add column if not exists jefe_inmediato text;

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

create unique index if not exists tutor_estudiantes_postulacion_unique
  on public.tutor_estudiantes (postulacion_id)
  where postulacion_id is not null;

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
  v_existing_assignment_id uuid;
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

  if p_empresa_id is not null then
    select assignment.id into v_existing_assignment_id
    from public.tutor_estudiantes as assignment
    where assignment.estudiante_id = v_estudiante_id
      and assignment.empresa_id = p_empresa_id
      and assignment.tutor_id is null
      and assignment.estado = 'en_curso'
      and lower(trim(assignment.cargo)) = lower(trim(p_cargo))
    order by assignment.created_at desc
    limit 1
    for update;
  end if;

  if v_existing_assignment_id is not null then
    update public.tutor_estudiantes
    set tutor_id = v_tutor_id,
        empresa = v_empresa,
        cargo = trim(p_cargo),
        fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        jefe_inmediato = nullif(trim(p_jefe_inmediato), '')
    where id = v_existing_assignment_id;
  else
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
  end if;

  return query select v_estudiante_id, v_nombre;
end;
$$;

revoke all on function public.tutor_assign_student(text, text, text, date, date, uuid, text) from public;
grant execute on function public.tutor_assign_student(text, text, text, date, date, uuid, text) to authenticated;

create or replace function public.link_tutor_assignment_to_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_company_id uuid;
  v_supervisor text;
begin
  if new.postulacion_id is not null then
    if new.tutor_id is not null then
      update public.postulaciones
      set tutor_id = new.tutor_id,
          updated_at = now()
      where id = new.postulacion_id
        and tutor_id is distinct from new.tutor_id;

      update public.evidencias_estudiantes
      set tutor_id = new.tutor_id
      where postulacion_id = new.postulacion_id
        and tipo = 'academica'
        and tutor_id is distinct from new.tutor_id;
    end if;
    return new;
  end if;

  v_company_id := new.empresa_id;
  if v_company_id is null then
    select (array_agg(id))[1] into v_company_id
    from public.perfiles
    where rol = 'empresa'
      and lower(trim(nombre)) = lower(trim(new.empresa))
    having count(*) = 1;
  end if;

  if v_company_id is not null then
    update public.tutor_estudiantes
    set empresa_id = v_company_id
    where id = new.id;
  end if;

  select application.id, application.empresa_id, offer.jefe_inmediato
    into v_application_id, v_company_id, v_supervisor
  from public.postulaciones as application
  join public.ofertas as offer on offer.id = application.oferta_id
  join public.perfiles as company on company.id = application.empresa_id
  where application.estudiante_id = new.estudiante_id
    and application.estado in ('aprobada', 'contratada')
    and (application.tutor_id is null or application.tutor_id = new.tutor_id)
    and (v_company_id is null or application.empresa_id = v_company_id)
    and lower(trim(company.nombre)) = lower(trim(new.empresa))
    and lower(trim(offer.titulo)) = lower(trim(new.cargo))
  order by application.created_at desc
  limit 1;

  if v_application_id is not null then
    update public.tutor_estudiantes
    set postulacion_id = v_application_id,
        empresa_id = v_company_id,
        jefe_inmediato = v_supervisor
    where id = new.id;

    update public.postulaciones
    set tutor_id = new.tutor_id,
        updated_at = now()
    where id = v_application_id;
  end if;

  return new;
end;
$$;

update public.tutor_estudiantes as assignment
set empresa_id = company.id
from (
  select (array_agg(id))[1] as id, lower(trim(nombre)) as normalized_name
  from public.perfiles
  where rol = 'empresa'
  group by lower(trim(nombre))
  having count(*) = 1
) as company
where assignment.empresa_id is null
  and company.normalized_name = lower(trim(assignment.empresa));

drop trigger if exists tutor_assignment_link_application on public.tutor_estudiantes;
create trigger tutor_assignment_link_application
  after insert or update of tutor_id, postulacion_id on public.tutor_estudiantes
  for each row
  execute function public.link_tutor_assignment_to_application();

drop policy if exists tutor_estudiantes_select_own_student on public.tutor_estudiantes;
create policy tutor_estudiantes_select_own_student
  on public.tutor_estudiantes for select to authenticated
  using (estudiante_id = auth.uid() and public.is_current_user_student());

drop policy if exists tutor_evaluaciones_select_own_student on public.tutor_evaluaciones;
create policy tutor_evaluaciones_select_own_student
  on public.tutor_evaluaciones for select to authenticated
  using (
    exists (
      select 1
      from public.tutor_estudiantes
      where id = estudiante_asignado_id
        and estudiante_id = auth.uid()
    )
    and public.is_current_user_student()
  );

create or replace function public.sync_contracted_student_practice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ofertas%rowtype;
  v_company_name text;
begin
  if new.tutor_id is not null then
    update public.evidencias_estudiantes
    set tutor_id = new.tutor_id
    where postulacion_id = new.id
      and tipo = 'academica'
      and tutor_id is distinct from new.tutor_id;
  end if;

  if new.estado <> 'contratada' or new.tutor_id is null then
    return new;
  end if;

  select * into v_offer
  from public.ofertas
  where id = new.oferta_id;

  select nombre into v_company_name
  from public.perfiles
  where id = new.empresa_id;

  insert into public.tutor_estudiantes (
    tutor_id,
    estudiante_id,
    empresa,
    cargo,
    fecha_inicio,
    fecha_fin,
    estado,
    postulacion_id,
    empresa_id,
    jefe_inmediato
  )
  values (
    new.tutor_id,
    new.estudiante_id,
    coalesce(v_company_name, 'Empresa'),
    v_offer.titulo,
    v_offer.fecha_inicio,
    v_offer.fecha_fin,
    'en_curso',
    new.id,
    new.empresa_id,
    v_offer.jefe_inmediato
  )
  on conflict (postulacion_id) where postulacion_id is not null
  do update set
    tutor_id = excluded.tutor_id,
    empresa = excluded.empresa,
    cargo = excluded.cargo,
    fecha_inicio = excluded.fecha_inicio,
    fecha_fin = excluded.fecha_fin,
    empresa_id = excluded.empresa_id,
    jefe_inmediato = excluded.jefe_inmediato;

  return new;
end;
$$;

drop trigger if exists postulaciones_sync_contracted_practice on public.postulaciones;
create trigger postulaciones_sync_contracted_practice
  after insert or update of estado, tutor_id on public.postulaciones
  for each row
  when (new.estado = 'contratada' and new.tutor_id is not null)
  execute function public.sync_contracted_student_practice();

create table if not exists public.evidencias_estudiantes (
  id uuid primary key default gen_random_uuid(),
  postulacion_id uuid references public.postulaciones(id) on delete cascade,
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
  add column if not exists tutor_estudiante_id uuid references public.tutor_estudiantes(id) on delete cascade;
alter table public.evidencias_estudiantes
  alter column postulacion_id drop not null,
  alter column empresa_id drop not null;

update public.evidencias_estudiantes as evidence
set tutor_estudiante_id = assignment.id
from public.tutor_estudiantes as assignment
where evidence.tutor_estudiante_id is null
  and assignment.postulacion_id = evidence.postulacion_id
  and assignment.estudiante_id = evidence.estudiante_id;

create index if not exists evidencias_estudiantes_postulacion_created_idx
  on public.evidencias_estudiantes (postulacion_id, created_at desc);
create index if not exists evidencias_estudiantes_assignment_created_idx
  on public.evidencias_estudiantes (tutor_estudiante_id, created_at desc);
create index if not exists evidencias_estudiantes_tutor_created_idx
  on public.evidencias_estudiantes (tutor_id, created_at desc)
  where tutor_id is not null;
create index if not exists evidencias_estudiantes_empresa_created_idx
  on public.evidencias_estudiantes (empresa_id, created_at desc)
  where tipo = 'empresa';

grant select, insert on public.evidencias_estudiantes to authenticated;
alter table public.evidencias_estudiantes enable row level security;

drop policy if exists evidencias_estudiantes_student_select_own on public.evidencias_estudiantes;
create policy evidencias_estudiantes_student_select_own
  on public.evidencias_estudiantes for select to authenticated
  using (estudiante_id = auth.uid() and public.is_current_user_student());

drop policy if exists evidencias_estudiantes_student_insert_active on public.evidencias_estudiantes;
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
      select 1 from public.tutor_estudiantes
      where id = evidencias_estudiantes.tutor_estudiante_id
        and tutor_id = auth.uid()
    )
  );

drop policy if exists evidencias_estudiantes_company_select_own on public.evidencias_estudiantes;
create policy evidencias_estudiantes_company_select_own
  on public.evidencias_estudiantes for select to authenticated
  using (
    tipo = 'empresa'
    and empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1 from public.tutor_estudiantes
      where id = evidencias_estudiantes.tutor_estudiante_id
        and empresa_id = auth.uid()
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
      select 1 from public.tutor_estudiantes
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
      from public.evidencias_estudiantes evidence
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

notify pgrst, 'reload schema';
