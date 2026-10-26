This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Módulo del estudiante

Para habilitar el seguimiento académico y laboral entre instructor, practicante y empresa, ejecuta `supabase/tutor_module.sql` y luego `supabase/student_followup.sql` en el SQL Editor del proyecto de Supabase que usa la aplicación. La segunda migración crea bitácoras privadas, tareas laborales, novedades, feedback de empresa y permisos de acceso; no requiere el módulo de ofertas. Para habilitar la edición de perfiles, fotos, cambio de correo y contraseña, ejecuta también `supabase/user_profile.sql`.

La pestaña laboral muestra tareas, feedback y novedades cuando la práctica está vinculada a una empresa registrada. La empresa puede crear tareas desde su módulo; el estudiante puede completar tareas con un enlace de evidencia y reportar novedades.

Para habilitar el módulo de empresa y el portal de ofertas para aprendices, ejecuta en este orden `supabase/tutor_module.sql`, `supabase/student_followup.sql`, `supabase/student_module.sql`, `supabase/empresa_module.sql`, `supabase/student_opportunities.sql` y `supabase/company_registry.sql`. Si ya ejecutaste las migraciones, vuelve a ejecutar completos `student_opportunities.sql` y `company_registry.sql` cuando se actualicen: son idempotentes y aplican también las correcciones de RLS. La migración de postulaciones agrega las columnas que pueden faltar en instalaciones previas (`empresa_id`, `tutor_id` y `updated_at`) y completa `empresa_id` a partir de cada oferta. `student_opportunities.sql` agrega la descripción del perfil y el CV privado por postulación, permite al aprendiz ver ofertas activas, evita la recursión de RLS en las políticas de postulaciones y restringe la lectura de cada CV al propietario y a la empresa de la vacante. `company_registry.sql` agrega el nombre empresarial, permite que cada empresa registre el nombre que aparecerá en las ofertas y el selector del instructor, y garantiza que `tutor_estudiantes.tutor_id` permita valores nulos para registrar una práctica antes de asignar instructor. Las políticas de postulaciones limitan la lectura y actualización a la empresa propietaria identificada por `empresa_id`, y la inserción valida que el propietario coincida con la oferta. La tabla `ofertas` debe incluir `empresa_id` como clave foránea a `perfiles.id`, además de `titulo`, `descripcion`, `estado` y `created_at`; la migración de empresa agrega `requisitos` si hace falta y permite que cada organización gestione únicamente sus ofertas. Desde `/mis-ofertas` se publican, editan y cierran vacantes, `/postulaciones` permite aceptar o rechazar candidatos y `/mis-practicantes` registra al candidato aceptado, asigna tareas, consulta los archivos enviados por el aprendiz y permite marcar novedades como leídas. Los aprendices sin seguimiento ven una bienvenida y el catálogo de ofertas en su panel principal; al quedar asignados, se oculta el acceso a ofertas y la ruta redirige a Mi práctica.

Ejecuta cada archivo completo, en una sola sesión del SQL Editor del proyecto configurado en `NEXT_PUBLIC_SUPABASE_URL`. Al final de `student_followup.sql`, verifica que `tabla_bitacoras`, `tabla_seguimientos`, `tabla_entregables_empresa`, `tabla_novedades` y `tabla_feedback_empresa` muestren nombres de tablas. Si alguno aparece como `NULL`, la migración no terminó correctamente o se ejecutó en otro proyecto; vuelve a ejecutar el archivo completo y revisa el primer error del SQL Editor. Si las tablas existen pero PostgREST indica que no están en el schema cache, ejecuta `NOTIFY pgrst, 'reload schema';` y vuelve a cargar la aplicación. Al final de `user_profile.sql`, el resultado debe mostrar las columnas `telefono` y `foto_perfil_path`; si no aparecen, confirma que abriste el mismo proyecto de Supabase y vuelve a ejecutar el archivo.

Si aparece un error de columna o tabla inexistente en otros módulos, revisa sus migraciones: `tutor_module.sql` crea las tablas de asignaciones y evaluaciones, y `student_module.sql` crea postulaciones, evidencias y las columnas adicionales para el seguimiento.

La empresa puede aceptar o rechazar candidatos desde `/postulaciones` (la aceptación se almacena como `aprobada`, según los estados permitidos por el esquema actual) y registrar la práctica laboral desde `/mis-practicantes`. Esa práctica habilita al aprendiz para consultar tareas, enviar archivos a la empresa y reportar novedades, incluso antes de asignar un instructor. Después, el instructor puede vincular el registro existente desde su módulo usando el mismo correo de estudiante, empresa y cargo; así conserva los entregables y los archivos previos. El antiguo `/empresa/seguimiento` sigue disponible como ruta alternativa a las postulaciones.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
