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

La pestaña laboral muestra tareas, feedback y novedades solo si el instructor vincula la práctica a una cuenta de empresa registrada. Las tareas y comentarios pueden ser creados por la empresa a través de la base de datos; el estudiante puede completar tareas con un enlace de evidencia y reportar novedades.

El módulo de ofertas se encuentra pospuesto. Cuando se retome, ejecuta `supabase/student_module.sql` después de las migraciones de seguimiento; la tabla `ofertas` debe incluir `empresa_id` como clave foránea a `perfiles.id`, además de `titulo`, `descripcion`, `requisitos`, `estado` y `created_at`. Esta migración agrega postulaciones, integración con ofertas y permisos adicionales.

Ejecuta cada archivo completo, en una sola sesión del SQL Editor. Al final de `student_followup.sql`, verifica que `tabla_bitacoras` y `tabla_seguimientos` muestren nombres de tablas. Al final de `user_profile.sql`, el resultado debe mostrar las columnas `telefono` y `foto_perfil_path`; si no aparecen, confirma que abriste el mismo proyecto de Supabase indicado por `NEXT_PUBLIC_SUPABASE_URL` y vuelve a ejecutar el archivo. Las migraciones solicitan recargar el esquema de la API (`NOTIFY pgrst, 'reload schema';`).

Si aparece un error de columna o tabla inexistente en otros módulos, revisa sus migraciones: `tutor_module.sql` crea las tablas de asignaciones y evaluaciones, y `student_module.sql` crea postulaciones, evidencias y las columnas adicionales para el seguimiento.

Las empresas pueden aprobar o contratar postulaciones desde `/empresa/seguimiento`, donde también consultan los entregables laborales. Los estudiantes solo acceden al seguimiento cuando existe una asignación en `tutor_estudiantes`; la postulación aprobada por sí sola no desbloquea bitácoras ni evaluaciones. Si el tutor usa la asignación existente, la migración enlaza automáticamente una oferta aprobada cuando coinciden el nombre de empresa y el cargo; la contratación puede confirmarse antes de la asignación académica.

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
