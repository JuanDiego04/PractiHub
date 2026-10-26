-- Ejecutar después de empresa_module.sql y student_opportunities.sql.

alter table public.perfiles
  add column if not exists nombre_empresa text;

alter table public.tutor_estudiantes
  alter column tutor_id drop not null;

create or replace function public.update_own_company_name(p_nombre_empresa text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_company_name text := nullif(trim(p_nombre_empresa), '');
begin
  if auth.uid() is null or not public.is_current_user_company() then
    raise exception 'Solo una cuenta de empresa puede actualizar el nombre de la empresa.';
  end if;

  if v_company_name is null or length(v_company_name) < 2 or length(v_company_name) > 150 then
    raise exception 'El nombre de la empresa debe tener entre 2 y 150 caracteres.';
  end if;

  update public.perfiles
  set nombre_empresa = v_company_name
  where id = auth.uid()
    and rol = 'empresa';

  if not found then
    raise exception 'No encontramos el perfil de empresa.';
  end if;

  update public.tutor_estudiantes
  set empresa = v_company_name
  where empresa_id = auth.uid();
end;
$$;

revoke all on function public.update_own_company_name(text) from public;
grant execute on function public.update_own_company_name(text) to authenticated;

create or replace function public.company_has_registered_name()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.perfiles as company
    where company.id = auth.uid()
      and company.rol = 'empresa'
      and nullif(trim(company.nombre_empresa), '') is not null
  );
$$;

revoke all on function public.company_has_registered_name() from public;
grant execute on function public.company_has_registered_name() to authenticated;

drop policy if exists ofertas_company_insert_own on public.ofertas;
create policy ofertas_company_insert_own
  on public.ofertas for insert to authenticated
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and estado = 'activa'
    and public.company_has_registered_name()
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

  select nullif(trim(profile.nombre_empresa), '')
    into v_company_name
  from public.perfiles as profile
  where profile.id = v_company_id
    and profile.rol = 'empresa';

  select profile.nombre into v_student_name
  from public.perfiles as profile
  where profile.id = v_application.estudiante_id
    and profile.rol = 'estudiante';

  if v_company_name is null then
    raise exception 'Registra primero el nombre de la empresa desde Mi perfil.';
  end if;

  if v_student_name is null then
    raise exception 'No se encontró el perfil del estudiante.';
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
    select coalesce(nullif(trim(profile.nombre_empresa), ''), profile.nombre)
      into v_empresa
    from public.perfiles as profile
    where profile.id = p_empresa_id
      and profile.rol = 'empresa';

    if not found then
      raise exception 'La cuenta seleccionada no corresponde a una empresa.';
    end if;
  else
    v_empresa := trim(p_empresa);
  end if;

  select profile.id, profile.nombre
    into v_estudiante_id, v_nombre
  from public.perfiles as profile
  where lower(profile.email) = lower(trim(p_email))
    and profile.rol = 'estudiante';

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
    select (array_agg(company.id))[1] into v_company_id
    from public.perfiles as company
    where company.rol = 'empresa'
      and lower(trim(coalesce(nullif(company.nombre_empresa, ''), company.nombre))) = lower(trim(new.empresa))
    having count(*) = 1;
  end if;

  if v_company_id is not null then
    update public.tutor_estudiantes
    set empresa_id = v_company_id
    where id = new.id
      and empresa_id is distinct from v_company_id;
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
    and lower(trim(coalesce(nullif(company.nombre_empresa, ''), company.nombre))) = lower(trim(new.empresa))
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
set empresa = coalesce(nullif(trim(company.nombre_empresa), ''), company.nombre)
from public.perfiles as company
where assignment.empresa_id = company.id
  and company.rol = 'empresa'
  and nullif(trim(company.nombre_empresa), '') is not null
  and assignment.empresa is distinct from company.nombre_empresa;

update public.tutor_estudiantes as assignment
set empresa_id = company.id
from (
  select (array_agg(profile.id))[1] as id,
         lower(trim(coalesce(nullif(profile.nombre_empresa, ''), profile.nombre))) as normalized_name
  from public.perfiles as profile
  where profile.rol = 'empresa'
  group by lower(trim(coalesce(nullif(profile.nombre_empresa, ''), profile.nombre)))
  having count(*) = 1
) as company
where assignment.empresa_id is null
  and company.normalized_name = lower(trim(assignment.empresa));

notify pgrst, 'reload schema';
