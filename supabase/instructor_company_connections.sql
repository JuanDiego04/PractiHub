-- Ejecuta este archivo después de company_registry.sql.
-- Crea conexiones privadas, colaboración documental y seguimiento compartido.

do $$
begin
  if to_regclass('public.perfiles') is null then
    raise exception 'No existe public.perfiles. Ejecuta primero governed_accounts.sql.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'estado_cuenta'
  ) then
    raise exception 'public.perfiles debe tener la columna estado_cuenta. Ejecuta primero governed_accounts.sql.';
  end if;

  if to_regclass('public.tutor_estudiantes') is null
    or to_regprocedure('public.tutor_assign_student(text,text,text,date,date,uuid,text)') is null then
    raise exception 'Ejecuta primero tutor_module.sql, student_followup.sql y company_registry.sql.';
  end if;
end;
$$;

alter table public.perfiles
  add column if not exists nombre_empresa text;

create table if not exists public.conexiones_instructor_empresa (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.perfiles(id) on delete cascade,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  solicitante_id uuid not null references public.perfiles(id) on delete cascade,
  mensaje text check (mensaje is null or char_length(trim(mensaje)) <= 500),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada', 'cancelada', 'desvinculada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  respondida_at timestamptz,
  constraint conexiones_roles_distintos check (instructor_id <> empresa_id),
  constraint conexiones_solicitante_participante
    check (solicitante_id = instructor_id or solicitante_id = empresa_id)
);

create table if not exists public.conexiones_mensajes (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.conexiones_instructor_empresa(id) on delete cascade,
  sender_id uuid not null references public.perfiles(id) on delete cascade,
  contenido text not null default '' check (char_length(trim(contenido)) <= 2000),
  archivo_path text,
  archivo_nombre text,
  archivo_mime text,
  archivo_tamano bigint,
  created_at timestamptz not null default now(),
  constraint conexiones_mensajes_has_content
    check (nullif(trim(contenido), '') is not null or archivo_path is not null),
  constraint conexiones_mensajes_file_metadata
    check (
      (archivo_path is null and archivo_nombre is null and archivo_mime is null and archivo_tamano is null)
      or (
        archivo_path is not null
        and archivo_nombre is not null
        and archivo_mime is not null
        and archivo_tamano is not null
        and archivo_mime in (
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'text/csv',
          'image/jpeg',
          'image/png'
        )
        and archivo_tamano between 1 and 10485760
      )
    ),
  constraint conexiones_mensajes_file_path
    check (
      archivo_path is null
      or archivo_path like connection_id::text || '/' || sender_id::text || '/%'
    )
);

create unique index if not exists conexiones_instructor_empresa_active_unique
  on public.conexiones_instructor_empresa (instructor_id, empresa_id)
  where estado in ('pendiente', 'aceptada');

create index if not exists conexiones_instructor_empresa_instructor_idx
  on public.conexiones_instructor_empresa (instructor_id, created_at desc);

create index if not exists conexiones_instructor_empresa_empresa_idx
  on public.conexiones_instructor_empresa (empresa_id, created_at desc);

create index if not exists conexiones_mensajes_connection_created_idx
  on public.conexiones_mensajes (connection_id, created_at);

revoke all on public.conexiones_instructor_empresa from public, anon, authenticated;
grant select on public.conexiones_instructor_empresa to authenticated;
revoke all on public.conexiones_mensajes from public, anon, authenticated;
grant select, insert on public.conexiones_mensajes to authenticated;

alter table public.conexiones_instructor_empresa enable row level security;
alter table public.conexiones_mensajes enable row level security;

drop policy if exists conexiones_instructor_empresa_select_participant
  on public.conexiones_instructor_empresa;
create policy conexiones_instructor_empresa_select_participant
  on public.conexiones_instructor_empresa for select to authenticated
  using (instructor_id = auth.uid() or empresa_id = auth.uid());

drop policy if exists conexiones_mensajes_select_connected_participants
  on public.conexiones_mensajes;
create policy conexiones_mensajes_select_connected_participants
  on public.conexiones_mensajes for select to authenticated
  using (
    exists (
      select 1
      from public.conexiones_instructor_empresa as connection
      where connection.id = conexiones_mensajes.connection_id
        and connection.estado = 'aceptada'
        and (
          (connection.instructor_id = auth.uid() and public.is_current_user_tutor())
          or (connection.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
  );

drop policy if exists conexiones_mensajes_insert_connected_sender
  on public.conexiones_mensajes;
create policy conexiones_mensajes_insert_connected_sender
  on public.conexiones_mensajes for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (nullif(trim(contenido), '') is not null or archivo_path is not null)
    and exists (
      select 1
      from public.conexiones_instructor_empresa as connection
      where connection.id = conexiones_mensajes.connection_id
        and connection.estado = 'aceptada'
        and (
          (connection.instructor_id = auth.uid() and public.is_current_user_tutor())
          or (connection.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos_conexiones',
  'documentos_conexiones',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists conexiones_documentos_select_participant on storage.objects;
create policy conexiones_documentos_select_participant
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos_conexiones'
    and exists (
      select 1
      from public.conexiones_instructor_empresa as connection
      where connection.id::text = (storage.foldername(name))[1]
        and connection.estado = 'aceptada'
        and (
          (connection.instructor_id = auth.uid() and public.is_current_user_tutor())
          or (connection.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
    and exists (
      select 1
      from public.conexiones_mensajes as message
      where message.archivo_path = storage.objects.name
    )
  );

drop policy if exists conexiones_documentos_insert_participant on storage.objects;
create policy conexiones_documentos_insert_participant
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos_conexiones'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
      from public.conexiones_instructor_empresa as connection
      where connection.id::text = (storage.foldername(name))[1]
        and connection.estado = 'aceptada'
        and (
          (connection.instructor_id = auth.uid() and public.is_current_user_tutor())
          or (connection.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
  );

drop policy if exists conexiones_documentos_delete_unregistered_upload
  on storage.objects;
create policy conexiones_documentos_delete_unregistered_upload
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documentos_conexiones'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
      from public.conexiones_instructor_empresa as connection
      where connection.id::text = (storage.foldername(name))[1]
        and connection.estado = 'aceptada'
        and (
          (connection.instructor_id = auth.uid() and public.is_current_user_tutor())
          or (connection.empresa_id = auth.uid() and public.is_current_user_company())
        )
    )
    and not exists (
      select 1
      from public.conexiones_mensajes as message
      where message.archivo_path = storage.objects.name
    )
  );

create or replace function public.list_instructor_company_candidates(p_search text default null)
returns table (profile_id uuid, display_name text, profile_role text)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role text;
  v_search text := nullif(trim(p_search), '');
begin
  select profile.rol
    into v_role
  from public.perfiles as profile
  where profile.id = auth.uid()
    and profile.estado_cuenta = 'activo'
    and profile.rol in ('instructor', 'empresa');

  if not found then
    raise exception 'Esta sección está disponible para instructores y empresas activas.';
  end if;

  return query
  select
    profile.id,
    case
      when profile.rol = 'empresa'
        then coalesce(nullif(trim(profile.nombre_empresa), ''), profile.nombre)
      else profile.nombre
    end::text,
    profile.rol::text
  from public.perfiles as profile
  where profile.estado_cuenta = 'activo'
    and profile.rol = case when v_role = 'instructor' then 'empresa' else 'instructor' end
    and profile.id <> auth.uid()
    and (
      v_search is null
      or profile.nombre ilike '%' || v_search || '%'
      or coalesce(profile.nombre_empresa, '') ilike '%' || v_search || '%'
    )
  order by
    case
      when profile.rol = 'empresa'
        then coalesce(nullif(trim(profile.nombre_empresa), ''), profile.nombre)
      else profile.nombre
    end;
end;
$$;

create or replace function public.list_instructor_company_connections()
returns table (
  connection_id uuid,
  other_profile_id uuid,
  other_name text,
  other_email text,
  other_role text,
  status text,
  requester_id uuid,
  message text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role text;
begin
  select profile.rol
    into v_role
  from public.perfiles as profile
  where profile.id = auth.uid()
    and profile.estado_cuenta = 'activo'
    and profile.rol in ('instructor', 'empresa');

  if not found then
    raise exception 'Esta sección está disponible para instructores y empresas activas.';
  end if;

  return query
  select
    connection.id,
    other_profile.id,
    case
      when other_profile.rol = 'empresa'
        then coalesce(nullif(trim(other_profile.nombre_empresa), ''), other_profile.nombre)
      else other_profile.nombre
    end::text,
    case when connection.estado = 'aceptada' then other_profile.email::text else null end,
    other_profile.rol::text,
    connection.estado::text,
    connection.solicitante_id,
    connection.mensaje,
    connection.created_at,
    connection.updated_at
  from public.conexiones_instructor_empresa as connection
  join public.perfiles as other_profile
    on other_profile.id = case
      when connection.instructor_id = auth.uid() then connection.empresa_id
      else connection.instructor_id
    end
  where (connection.instructor_id = auth.uid() and v_role = 'instructor')
     or (connection.empresa_id = auth.uid() and v_role = 'empresa')
  order by connection.created_at desc;
end;
$$;

create or replace function public.request_instructor_company_connection(
  p_target_profile_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_target_role text;
  v_instructor_id uuid;
  v_empresa_id uuid;
  v_connection_id uuid;
  v_message text := nullif(trim(p_message), '');
begin
  select profile.rol
    into v_role
  from public.perfiles as profile
  where profile.id = v_user_id
    and profile.estado_cuenta = 'activo'
    and profile.rol in ('instructor', 'empresa');

  if not found then
    raise exception 'Solo instructores y empresas activas pueden solicitar conexiones.';
  end if;

  if p_target_profile_id is null or p_target_profile_id = v_user_id then
    raise exception 'Selecciona una cuenta válida para conectar.';
  end if;

  select profile.rol
    into v_target_role
  from public.perfiles as profile
  where profile.id = p_target_profile_id
    and profile.estado_cuenta = 'activo'
    and profile.rol in ('instructor', 'empresa');

  if not found or v_target_role = v_role then
    raise exception 'Las conexiones solo se permiten entre un instructor y una empresa activa.';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'El mensaje no puede superar los 500 caracteres.';
  end if;

  if v_role = 'instructor' then
    v_instructor_id := v_user_id;
    v_empresa_id := p_target_profile_id;
  else
    v_instructor_id := p_target_profile_id;
    v_empresa_id := v_user_id;
  end if;

  begin
    insert into public.conexiones_instructor_empresa (
      instructor_id,
      empresa_id,
      solicitante_id,
      mensaje
    )
    values (
      v_instructor_id,
      v_empresa_id,
      v_user_id,
      v_message
    )
    returning id into v_connection_id;
  exception
    when unique_violation then
      raise exception 'Ya existe una solicitud pendiente o una conexión activa con esta cuenta.';
  end;

  return v_connection_id;
end;
$$;

create or replace function public.respond_instructor_company_connection(
  p_connection_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_connection public.conexiones_instructor_empresa%rowtype;
  v_new_status text;
begin
  select profile.rol
    into v_role
  from public.perfiles as profile
  where profile.id = v_user_id
    and profile.estado_cuenta = 'activo'
    and profile.rol in ('instructor', 'empresa');

  if not found then
    raise exception 'Solo instructores y empresas activas pueden gestionar conexiones.';
  end if;

  if p_action is null or p_action not in ('aceptar', 'rechazar', 'cancelar', 'desvincular') then
    raise exception 'La acción solicitada no es válida.';
  end if;

  select connection.*
    into v_connection
  from public.conexiones_instructor_empresa as connection
  where connection.id = p_connection_id
    and (connection.instructor_id = v_user_id or connection.empresa_id = v_user_id)
    and (
      (v_role = 'instructor' and connection.instructor_id = v_user_id)
      or (v_role = 'empresa' and connection.empresa_id = v_user_id)
    )
  for update;

  if not found then
    raise exception 'No encontramos una conexión disponible para tu cuenta.';
  end if;

  if p_action in ('aceptar', 'rechazar') then
    if v_connection.estado <> 'pendiente' or v_connection.solicitante_id = v_user_id then
      raise exception 'Solo puedes responder solicitudes pendientes recibidas.';
    end if;
    v_new_status := case when p_action = 'aceptar' then 'aceptada' else 'rechazada' end;
  elsif p_action = 'cancelar' then
    if v_connection.estado <> 'pendiente' or v_connection.solicitante_id <> v_user_id then
      raise exception 'Solo puedes cancelar tus propias solicitudes pendientes.';
    end if;
    v_new_status := 'cancelada';
  else
    if v_connection.estado <> 'aceptada' then
      raise exception 'Solo puedes desvincular una conexión aceptada.';
    end if;
    v_new_status := 'desvinculada';
  end if;

  update public.conexiones_instructor_empresa
  set estado = v_new_status,
      updated_at = now(),
      respondida_at = now()
  where id = v_connection.id;
end;
$$;

create or replace function public.link_instructor_company_student(
  p_connection_id uuid,
  p_student_email text,
  p_position text,
  p_start_date date default null,
  p_end_date date default null,
  p_supervisor text default null
)
returns table (student_id uuid, student_name text)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_student_id uuid;
begin
  if not public.is_current_user_tutor() then
    raise exception 'Solo el instructor conectado puede vincular un aprendiz.';
  end if;

  if nullif(trim(p_student_email), '') is null
    or nullif(trim(p_position), '') is null then
    raise exception 'El correo del aprendiz y el cargo son obligatorios.';
  end if;
  if char_length(trim(p_position)) > 120
    or char_length(coalesce(trim(p_supervisor), '')) > 120 then
    raise exception 'El cargo y el supervisor no pueden superar los 120 caracteres.';
  end if;

  select connection.empresa_id
    into v_company_id
  from public.conexiones_instructor_empresa as connection
  where connection.id = p_connection_id
    and connection.instructor_id = v_user_id
    and connection.estado = 'aceptada'
  for update;

  if not found then
    raise exception 'La conexión no existe o ya no está activa.';
  end if;

  select profile.id
    into v_student_id
  from public.perfiles as profile
  where lower(profile.email) = lower(trim(p_student_email))
    and profile.rol = 'aprendiz'
    and profile.estado_cuenta = 'activo';

  if not found then
    raise exception 'No encontramos un perfil activo de aprendiz con ese correo.';
  end if;

  if exists (
    select 1
    from public.tutor_estudiantes as assignment
    where assignment.tutor_id = v_user_id
      and assignment.empresa_id = v_company_id
      and assignment.estudiante_id = v_student_id
      and assignment.estado = 'en_curso'
      and lower(trim(assignment.cargo)) = lower(trim(p_position))
  ) then
    raise exception 'Este aprendiz ya está vinculado a esta conexión con ese cargo.';
  end if;

  return query
  select assignment.estudiante_id, assignment.nombre
  from public.tutor_assign_student(
    trim(p_student_email),
    null,
    trim(p_position),
    p_start_date,
    p_end_date,
    v_company_id,
    nullif(trim(p_supervisor), '')
  ) as assignment;
end;
$$;

revoke all on function public.list_instructor_company_candidates(text) from public, anon;
revoke all on function public.list_instructor_company_connections() from public, anon;
revoke all on function public.request_instructor_company_connection(uuid, text) from public, anon;
revoke all on function public.respond_instructor_company_connection(uuid, text) from public, anon;
revoke all on function public.link_instructor_company_student(uuid, text, text, date, date, text) from public, anon;

grant execute on function public.list_instructor_company_candidates(text) to authenticated;
grant execute on function public.list_instructor_company_connections() to authenticated;
grant execute on function public.request_instructor_company_connection(uuid, text) to authenticated;
grant execute on function public.respond_instructor_company_connection(uuid, text) to authenticated;
grant execute on function public.link_instructor_company_student(uuid, text, text, date, date, text) to authenticated;

notify pgrst, 'reload schema';
