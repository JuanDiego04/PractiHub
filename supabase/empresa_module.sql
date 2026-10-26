-- Ejecutar después de student_module.sql y student_followup.sql.
-- El RLS limita la gestión de ofertas a la empresa propietaria.

alter table public.ofertas
  add column if not exists requisitos text;

alter table public.tutor_estudiantes
  alter column tutor_id drop not null;

grant select, insert, update on public.ofertas to authenticated;
alter table public.ofertas enable row level security;

drop policy if exists ofertas_company_select_own on public.ofertas;
create policy ofertas_company_select_own
  on public.ofertas for select to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
  );

drop policy if exists ofertas_company_insert_own on public.ofertas;
create policy ofertas_company_insert_own
  on public.ofertas for insert to authenticated
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and estado = 'activa'
  );

drop policy if exists ofertas_company_update_own on public.ofertas;
create policy ofertas_company_update_own
  on public.ofertas for update to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
  )
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
  );

drop policy if exists perfiles_company_select_linked_students on public.perfiles;
create policy perfiles_company_select_linked_students
  on public.perfiles for select to authenticated
  using (
    rol = 'estudiante'
    and public.is_current_user_company()
    and exists (
      select 1
      from public.tutor_estudiantes as assignment
      where assignment.estudiante_id = perfiles.id
        and assignment.empresa_id = auth.uid()
    )
  );

create or replace function public.company_register_practitioner(
  p_postulacion_id uuid,
  p_fecha_inicio date default null,
  p_fecha_fin date default null,
  p_jefe_inmediato text default null
)
returns table (assignment_id uuid, estudiante_id uuid, nombre text, cargo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := auth.uid();
  v_application public.postulaciones%rowtype;
  v_company_name text;
  v_student_name text;
  v_assignment_id uuid;
begin
  if not public.is_current_user_company() then
    raise exception 'Solo una cuenta de empresa puede registrar practicantes.';
  end if;

  if p_fecha_inicio is not null and p_fecha_fin is not null
    and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de finalización no puede ser anterior a la fecha de inicio.';
  end if;

  select application.*
    into v_application
  from public.postulaciones as application
  where application.id = p_postulacion_id
    and application.empresa_id = v_company_id
    and application.estado in ('aprobada', 'contratada')
  for update;

  if not found then
    raise exception 'Solo puedes registrar candidatos aceptados por tu empresa.';
  end if;

  select profile.nombre into v_company_name
  from public.perfiles as profile
  where profile.id = v_company_id
    and profile.rol = 'empresa';

  select profile.nombre into v_student_name
  from public.perfiles as profile
  where profile.id = v_application.estudiante_id
    and profile.rol = 'estudiante';

  if v_company_name is null or v_student_name is null then
    raise exception 'No se encontró el perfil de la empresa o del estudiante.';
  end if;

  select assignment.id into v_assignment_id
  from public.tutor_estudiantes as assignment
  where assignment.postulacion_id = p_postulacion_id
  for update;

  if v_assignment_id is not null then
    raise exception 'Este candidato ya tiene una práctica registrada o vinculada.';
  end if;

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
  select
    null,
    v_application.estudiante_id,
    v_company_name,
    offer.titulo,
    p_fecha_inicio,
    p_fecha_fin,
    'en_curso',
    v_application.id,
    v_company_id,
    nullif(trim(p_jefe_inmediato), '')
  from public.ofertas as offer
  where offer.id = v_application.oferta_id
  returning id into v_assignment_id;

  return query
  select v_assignment_id, v_application.estudiante_id, v_student_name, offer.titulo
  from public.ofertas as offer
  where offer.id = v_application.oferta_id;
end;
$$;

revoke all on function public.company_register_practitioner(uuid, date, date, text) from public;
grant execute on function public.company_register_practitioner(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';
