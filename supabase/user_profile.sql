-- Ejecuta este archivo en Supabase SQL Editor después de tutor_module.sql
-- y student_module.sql.

alter table public.perfiles
  add column if not exists telefono text,
  add column if not exists foto_perfil_path text;

drop policy if exists perfiles_select_own on public.perfiles;
create policy perfiles_select_own
  on public.perfiles for select to authenticated
  using (id = auth.uid());

create or replace function public.update_own_profile(
  p_nombre text,
  p_telefono text,
  p_foto_perfil_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para actualizar tu perfil.';
  end if;

  if nullif(trim(p_nombre), '') is null or length(trim(p_nombre)) < 2 or length(trim(p_nombre)) > 100 then
    raise exception 'El nombre debe tener entre 2 y 100 caracteres.';
  end if;

  if nullif(trim(p_telefono), '') is not null and trim(p_telefono) !~ '^[0-9]{10}$' then
    raise exception 'El teléfono debe tener exactamente 10 dígitos.';
  end if;

  if p_foto_perfil_path is not null
    and p_foto_perfil_path not like auth.uid()::text || '/%'
  then
    raise exception 'La foto debe pertenecer a tu cuenta.';
  end if;

  update public.perfiles
  set nombre = trim(p_nombre),
      telefono = nullif(trim(p_telefono), ''),
      foto_perfil_path = p_foto_perfil_path
  where id = auth.uid();

  if not found then
    raise exception 'No encontramos tu perfil.';
  end if;
end;
$$;

revoke all on function public.update_own_profile(text, text, text) from public;
grant execute on function public.update_own_profile(text, text, text) to authenticated;

create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.perfiles
  set email = new.email
  where id = new.id
    and email is distinct from new.email;
  return new;
end;
$$;

revoke all on function public.sync_profile_email_from_auth() from public;

drop trigger if exists sync_profile_email_after_auth_update on auth.users;
create trigger sync_profile_email_after_auth_update
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email_from_auth();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos_perfil',
  'fotos_perfil',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_photo_select_own on storage.objects;
create policy profile_photo_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fotos_perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_photo_insert_own on storage.objects;
create policy profile_photo_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos_perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_photo_delete_own on storage.objects;
create policy profile_photo_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fotos_perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'perfiles'
  and column_name in ('telefono', 'foto_perfil_path')
order by column_name;
