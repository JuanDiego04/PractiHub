-- Ejecutar después de crear public.perfiles y antes de las migraciones de módulos.

alter table public.perfiles
  add column if not exists estado_cuenta text not null default 'activo',
  add column if not exists telefono text,
  add column if not exists documento_identidad text,
  add column if not exists centro_formacion text,
  add column if not exists nombre_empresa text,
  add column if not exists rol_solicitado text;

update public.perfiles
set rol = case rol
  when 'estudiante' then 'aprendiz'
  when 'tutor' then 'instructor'
  else rol
end;

update public.perfiles
set telefono = 'Sin registrar'
where telefono is null or length(trim(telefono)) = 0;

alter table public.perfiles
  alter column telefono set not null;

alter table public.perfiles
  drop constraint if exists perfiles_estado_cuenta_check,
  add constraint perfiles_estado_cuenta_check
    check (estado_cuenta in ('pendiente', 'activo', 'rechazado', 'suspendido')),
  drop constraint if exists perfiles_rol_check,
  add constraint perfiles_rol_check
    check (rol in ('aprendiz', 'instructor', 'empresa', 'admin')),
  drop constraint if exists perfiles_rol_solicitado_check,
  add constraint perfiles_rol_solicitado_check
    check (rol_solicitado is null or rol_solicitado in ('instructor', 'empresa'));

alter table public.perfiles enable row level security;

create or replace function public.is_current_user_admin()
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
      and rol = 'admin'
      and estado_cuenta = 'activo'
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

drop policy if exists perfiles_admin_select on public.perfiles;
create policy perfiles_admin_select
  on public.perfiles for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists perfiles_admin_insert on public.perfiles;
create policy perfiles_admin_insert
  on public.perfiles for insert to authenticated
  with check (public.is_current_user_admin());

drop policy if exists perfiles_admin_update on public.perfiles;
create policy perfiles_admin_update
  on public.perfiles for update to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists perfiles_admin_delete on public.perfiles;
create policy perfiles_admin_delete
  on public.perfiles for delete to authenticated
  using (public.is_current_user_admin());

create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_type text := coalesce(new.raw_user_meta_data ->> 'account_type', 'aprendiz');
  v_nombre text := nullif(trim(new.raw_user_meta_data ->> 'nombre'), '');
  v_telefono text := nullif(trim(new.raw_user_meta_data ->> 'telefono'), '');
  v_documento text := nullif(trim(new.raw_user_meta_data ->> 'documento_identidad'), '');
  v_centro text := nullif(trim(new.raw_user_meta_data ->> 'centro_formacion'), '');
  v_empresa text := nullif(trim(new.raw_user_meta_data ->> 'nombre_empresa'), '');
begin
  if new.email is null then
    raise exception 'Se requiere un correo electrónico para crear el perfil.';
  end if;

  if v_nombre is null or length(v_nombre) < 2 or length(v_nombre) > 100 then
    raise exception 'El nombre debe tener entre 2 y 100 caracteres.';
  end if;

  if v_telefono is null then
    raise exception 'El teléfono es obligatorio para crear el perfil.';
  end if;
  if v_telefono !~ '^[0-9]{10}$' then
    raise exception 'El teléfono debe tener exactamente 10 dígitos.';
  end if;

  if v_account_type not in ('aprendiz', 'instructor', 'empresa') then
    raise exception 'El tipo de cuenta solicitado no es válido.';
  end if;

  if v_account_type = 'instructor' and v_centro is null then
    raise exception 'El centro de formación es obligatorio para solicitar una cuenta de instructor.';
  end if;

  if v_account_type = 'empresa' and v_empresa is null then
    raise exception 'El nombre de la empresa es obligatorio para solicitar una cuenta empresarial.';
  end if;

  insert into public.perfiles (
    id,
    nombre,
    email,
    rol,
    estado_cuenta,
    telefono,
    documento_identidad,
    centro_formacion,
    nombre_empresa,
    rol_solicitado
  )
  values (
    new.id,
    v_nombre,
    new.email,
    'aprendiz',
    case
      when new.invited_at is not null then 'suspendido'
      when v_account_type = 'aprendiz' then 'activo'
      else 'pendiente'
    end,
    v_telefono,
    v_documento,
    v_centro,
    v_empresa,
    case when v_account_type = 'aprendiz' then null else v_account_type end
  );

  return new;
end;
$$;

revoke all on function public.create_profile_for_new_auth_user() from public;

drop trigger if exists create_profile_after_auth_signup on auth.users;
create trigger create_profile_after_auth_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();

notify pgrst, 'reload schema';
