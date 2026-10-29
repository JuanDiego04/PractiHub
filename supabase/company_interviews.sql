-- Ejecutar después de student_module.sql y company_registry.sql.
-- Agenda de entrevistas entre la empresa y el aprendiz postulante.

create table if not exists public.entrevistas_postulacion (
  id uuid primary key default gen_random_uuid(),
  postulacion_id uuid not null unique references public.postulaciones(id) on delete cascade,
  empresa_id uuid not null references public.perfiles(id) on delete cascade,
  estudiante_id uuid not null references public.perfiles(id) on delete cascade,
  fecha_hora timestamptz not null,
  modalidad text not null check (modalidad in ('virtual', 'presencial')),
  ubicacion text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entrevistas_postulacion_notas_validas check (notas is null or char_length(notas) <= 1000)
);

create index if not exists entrevistas_postulacion_estudiante_fecha_idx
  on public.entrevistas_postulacion (estudiante_id, fecha_hora);

grant select, insert, update on public.entrevistas_postulacion to authenticated;
alter table public.entrevistas_postulacion enable row level security;

drop policy if exists entrevistas_postulacion_select_participants on public.entrevistas_postulacion;
create policy entrevistas_postulacion_select_participants
  on public.entrevistas_postulacion for select to authenticated
  using (
    (empresa_id = auth.uid() and public.is_current_user_company())
    or (estudiante_id = auth.uid() and public.is_current_user_student())
  );

drop policy if exists entrevistas_postulacion_insert_accepted_company on public.entrevistas_postulacion;
create policy entrevistas_postulacion_insert_accepted_company
  on public.entrevistas_postulacion for insert to authenticated
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1
      from public.postulaciones as application
      where application.id = entrevistas_postulacion.postulacion_id
        and application.empresa_id = auth.uid()
        and application.estudiante_id = entrevistas_postulacion.estudiante_id
        and application.estado = 'aprobada'
    )
  );

drop policy if exists entrevistas_postulacion_update_accepted_company on public.entrevistas_postulacion;
create policy entrevistas_postulacion_update_accepted_company
  on public.entrevistas_postulacion for update to authenticated
  using (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1
      from public.postulaciones as application
      where application.id = entrevistas_postulacion.postulacion_id
        and application.empresa_id = auth.uid()
        and application.estado = 'aprobada'
    )
  )
  with check (
    empresa_id = auth.uid()
    and public.is_current_user_company()
    and exists (
      select 1
      from public.postulaciones as application
      where application.id = entrevistas_postulacion.postulacion_id
        and application.empresa_id = auth.uid()
        and application.estudiante_id = entrevistas_postulacion.estudiante_id
        and application.estado = 'aprobada'
    )
  );

revoke delete on public.entrevistas_postulacion from authenticated;

notify pgrst, 'reload schema';
