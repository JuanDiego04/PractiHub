# PractiHub

Plataforma web **Software as a Service (SaaS) B2B** diseñada para centralizar, automatizar y auditar la gestión de prácticas formativas (**etapa productiva SENA**), articulando la vinculación laboral, la trazabilidad documental y el seguimiento académico entre **Aprendices**, **Supervisores de Empresa** e **Instructores de Seguimiento**.

Elaborado bajo los lineamientos metodológicos de **ISO/IEC/IEEE 29148:2018**, **IEEE Std 830-1998** y la normatividad colombiana de protección de datos (**Ley 1581 de 2012** y **Ley 1273 de 2009**).

---

## Tabla de Contenidos

1. [Arquitectura y Stack Tecnológico](#arquitectura-y-stack-tecnológico)
2. [Estructura del Proyecto y Rutas Principales](#estructura-del-proyecto-y-rutas-principales)
3. [Requisitos Previos e Instalación Local](#requisitos-previos-e-instalación-local)
4. [Configuración de Seguridad y Almacenamiento](#configuración-de-seguridad-y-almacenamiento)
5. [Base de Datos y Migraciones SQL (Supabase)](#base-de-datos-y-migraciones-sql-supabase)
6. [Flujos Operativos por Rol](#flujos-operativos-por-rol)
7. [Despliegue en Producción y Continuidad (Vercel)](#despliegue-en-producción-y-continuidad-vercel)
8. [Autoría y Contexto Académico](#autoría-y-contexto-académico)

---

## Arquitectura y Stack Tecnológico

**PractiHub** implementa una arquitectura cliente-servidor desacoplada en la nube (*Cloud-Native / BaaS*), garantizando aislamiento multi-inquilino (*multi-tenancy*) mediante políticas *Row Level Security* (RLS) en PostgreSQL y protección de rutas en servidor mediante Next.js Middleware.

| Capa | Tecnología | Función en el Sistema |
| :--- | :--- | :--- |
| **Frontend & SSR** | Next.js (App Router), React, TypeScript | Renderizado híbrido (SSR/CSR), tipado estático estricto y enrutamiento protegido (`middleware.ts`). |
| **Estilos & UI/UX** | Tailwind CSS, `next/font` (Geist) | Diseño responsivo *Mobile-First* (`360px` a `1920px`) con cumplimiento de contraste WCAG 2.1 AA. |
| **Base de Datos** | Supabase PostgreSQL | Persistencia relacional con llaves primarias `UUID`, integridad referencial ACID, índices B-Tree y RLS. |
| **Autenticación** | Supabase Auth (GoTrue) + `@supabase/ssr` | Gestión de sesiones JWT en cookies seguras `HttpOnly` y cifrado `bcrypt` (*cost factor* $\ge 10$). |
| **Almacenamiento** | Supabase Storage | Buckets privados para hojas de vida y bitácoras en PDF con acceso temporal mediante `createSignedUrl()`. |
| **Seguridad Perimetral** | Cloudflare Turnstile | Verificación CAPTCHA no intrusiva integrada directamente en los endpoints de autenticación de Supabase. |
| **Infraestructura CI/CD** | Vercel & GitHub | Despliegue continuo desde rama `main`, certificados SSL/TLS automáticos y distribución Edge. |

---

## Estructura del Proyecto y Rutas Principales

### Organización del Repositorio

```text
practihub/
├── app/                          # Rutas, páginas y layouts (Next.js App Router)
│   ├── login/                    # Inicio de sesión con validación Cloudflare Turnstile
│   ├── register/                 # Registro por rol (Aprendiz / Empresa) con consentimiento legal
│   ├── dashboard/                # Paneles principales e indicadores por rol
│   ├── mis-ofertas/              # Creación, edición y cierre de convocatorias (Empresa)
│   ├── postulaciones/            # Evaluación de postulantes, estado 'aprobada' y entrevistas (Empresa)
│   ├── mis-practicantes/         # Registro de práctica, tareas laborales y novedades (Empresa)
│   └── empresa/seguimiento/      # Ruta alternativa heredada de seguimiento empresarial
├── components/                   # Componentes UI reutilizables, formularios y modales
├── lib/                          # Clientes Supabase (browser/server), utilidades y validaciones
├── supabase/                     # Scripts DDL y migraciones SQL modulares e idempotentes
│   ├── tutor_module.sql
│   ├── student_followup.sql
│   ├── user_profile.sql
│   ├── student_module.sql
│   ├── empresa_module.sql
│   ├── student_opportunities.sql
│   ├── company_registry.sql
│   └── company_interviews.sql
├── middleware.ts                 # Intercepción en servidor para validación de sesión JWT y roles
├── .env.example                  # Plantilla de variables de entorno públicas requeridas
└── .gitignore                    # Exclusión de .env.local, node_modules/ y .next/
```

---

## Requisitos Previos e Instalación Local

* **Node.js** v18.18 o superior (recomendado v20 LTS).
* **Gestor de paquetes:** `npm`, `yarn`, `pnpm` o `bun`.
* **Cuenta activa en Supabase** (proyecto PostgreSQL provisionado) y **Cloudflare** (widget Turnstile).

### Pasos de Instalación

1. **Clonar el repositorio e instalar dependencias:**

```bash
git clone [https://github.com/juandiegodelaossa/practihub.git](https://github.com/juandiegodelaossa/practihub.git)
cd practihub
npm install
```

2. **Configurar las variables de entorno:**

Toma `.env.example` como referencia y crea un archivo `.env.local` en la raíz del proyecto:

```env
NEXT_PUBLIC_SUPABASE_URL=[https://tu-proyecto.supabase.co](https://tu-proyecto.supabase.co)
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key_publica
NEXT_PUBLIC_TURNSTILE_SITE_KEY=tu_cloudflare_turnstile_site_key_publica
```

> **Importante:** Nunca expongas ni subas al repositorio las claves privadas (`SUPABASE_SERVICE_ROLE_KEY` o la *Secret Key* de Cloudflare Turnstile). El archivo `.env.local` está excluido automáticamente en `.gitignore`.

3. **Iniciar el servidor de desarrollo:**

```bash
npm run dev
# Alternativas: yarn dev | pnpm dev | bun dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador para acceder al aplicativo.

---

## Configuración de Seguridad y Almacenamiento

### 1. Protección CAPTCHA con Cloudflare Turnstile en Supabase Auth

Supabase Auth valida los tokens CAPTCHA de forma nativa en sus propios endpoints, protegiendo tanto los formularios web como las llamadas directas a la API de autenticación:

1. En el panel de **Cloudflare Turnstile**, crea un widget y agrega los dominios autorizados de la aplicación (incluyendo `localhost` para desarrollo local y el dominio de Vercel para producción).
2. Copia la **Site Key pública completa** en `.env.local` bajo `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
3. Ingresa al **Dashboard de Supabase > Authentication > Bot and Abuse Protection**, activa **Enable CAPTCHA protection**, selecciona **Cloudflare Turnstile** y pega la **Secret Key** de Cloudflare.
4. Reinicia el servidor de Next.js (`npm run dev`) cada vez que modifiques `.env.local`.

> **Diagnóstico de error `110200`:** Si el widget muestra el código de error Turnstile `110200`, significa que Cloudflare rechazó la *Site Key* configurada (verifica que no esté truncada y que el dominio/puerto actual esté permitido en Cloudflare).

### 2. Buckets Privados y Gestión Documental (Supabase Storage)

* **Buckets requeridos:** Configura los buckets de almacenamiento de **Hojas de Vida (CV)** y **Bitácoras** en modo **Private** (nunca públicos).
* **Validación de archivos:** Solo se admiten archivos con tipo MIME `application/pdf` y peso máximo de **5 MB por archivo**, validados tanto en el frontend como en las reglas del bucket.
* **Nomenclatura física de bitácoras:** Los archivos cargados siguen el patrón `{id_aprendiz}/bitacora_{quincena_num}_{timestamp}.pdf` para evitar colisiones y preservar historial de versiones.
* **Acceso temporal controlado:** La visualización y descarga de PDFs se realiza exclusivamente mediante `createSignedUrl(path, 3600)`, generando enlaces dinámicos con expiración estricta de **60 minutos (3600 segundos)** autorizados por políticas RLS.

---

## Base de Datos y Migraciones SQL (Supabase)

Las migraciones ubicadas en `supabase/` deben ejecutarse **completas en una sola sesión** dentro del **SQL Editor** del proyecto de Supabase correspondiente a `NEXT_PUBLIC_SUPABASE_URL`.

### 1. Orden de Ejecución (Ecosistema Completo: Empresa, Ofertas y Seguimiento)

| Orden | Archivo SQL | Descripción técnica y tablas/columnas afectadas |
| :---: | :--- | :--- |
| **1** | `supabase/tutor_module.sql` | Crea las tablas base de asignaciones (`tutor_estudiantes`) y evaluaciones institucionales. |
| **2** | `supabase/student_followup.sql` | Crea `bitacoras`, `seguimientos`, `entregables_empresa`, `novedades`, `feedback_empresa` y políticas RLS de acceso privado. |
| **3** | `supabase/user_profile.sql` | Habilita actualización de perfil, columnas `telefono` y `foto_perfil_path`, cambio de correo y contraseña. |
| **4** | `supabase/student_module.sql` | Crea `postulaciones`, evidencias y columnas relacionales (`empresa_id`, `tutor_id`, `updated_at`), poblando `empresa_id` desde cada oferta. |
| **5** | `supabase/empresa_module.sql` | Configura `ofertas` (`empresa_id` FK a `perfiles.id`, `titulo`, `descripcion`, `requisitos`, `estado`, `created_at`) y RLS por organización. |
| **6** | `supabase/student_opportunities.sql` | Añade descripción del perfil, CV privado por postulación, lectura de ofertas activas y políticas RLS sin recursión. |
| **7** | `supabase/company_registry.sql` | Habilita el registro del nombre comercial empresarial y permite `tutor_estudiantes.tutor_id` nulo (`NULL`) para iniciar prácticas antes de asignar instructor. |
| **8** | `supabase/company_interviews.sql` | Crea la agenda privada de entrevistas (`fecha`, `modalidad`, `enlace` o `lugar` e `indicaciones`) accesible solo por la empresa y el aprendiz aceptado. |

> **Instalación modular (solo seguimiento sin portal de ofertas):** Si únicamente deseas habilitar el seguimiento académico y laboral entre instructor, practicante y empresa, ejecuta únicamente los archivos **1, 2 y 3** (`tutor_module.sql`, `student_followup.sql` y `user_profile.sql`).
>
> **Idempotencia:** Los scripts `student_opportunities.sql`, `company_registry.sql` y `company_interviews.sql` son **idempotentes**; pueden volver a ejecutarse completos cuando se actualicen para aplicar correcciones en las políticas RLS.

### 2. Verificación Post-Migración y Recarga de Caché PostgREST

1. **Verificación de `student_followup.sql`:** Confirma en la tabla de resultados final que `tabla_bitacoras`, `tabla_seguimientos`, `tabla_entregables_empresa`, `tabla_novedades` y `tabla_feedback_empresa` muestren el nombre de cada tabla. Si alguno retorna `NULL`, vuelve a ejecutar el script completo y revisa el primer error reportado.
2. **Verificación de `user_profile.sql`:** Confirma que la salida retorne las columnas `telefono` y `foto_perfil_path`.
3. **Recarga del esquema de la API (PostgREST):** Si las tablas existen en PostgreSQL pero la aplicación reporta que no se encuentran en el *schema cache*, ejecuta:

```sql
NOTIFY pgrst, 'reload schema';
```

---

## Flujos Operativos por Rol

### 1. Aprendiz
* **Etapa de búsqueda (sin seguimiento activo):** Visualiza una bienvenida y el catálogo de ofertas activas en su panel principal, pudiendo postularse adjuntando su perfil y hoja de vida privada en PDF.
* **Etapa productiva vinculada (con práctica asignada):** El sistema oculta automáticamente el acceso al catálogo de ofertas y redirige hacia **Mi práctica**. Desde la pestaña laboral puede:
  * Consultar tareas asignadas por la empresa y marcarlas como completadas adjuntando enlaces o archivos de evidencia.
  * Cargar periódicamente sus bitácoras quincenales en formato PDF y consultar su estado (`Pendiente`, `Aprobado`, `Con Correcciones`).
  * Consultar detalles de entrevistas agendadas por la empresa y reportar novedades operativas.

### 2. Supervisor de Empresa
* **Gestión de vacantes (`/mis-ofertas`):** Publicación, edición y cierre de ofertas de práctica vinculadas exclusivamente a su organización (`empresa_id`).
* **Selección y entrevistas (`/postulaciones`):** Consulta de postulantes, visualización segura de hojas de vida PDF, aceptación (almacenada con estado `aprobada` conforme a las restricciones del esquema) o rechazo de candidatos, y programación/reprogramación de entrevistas privadas *(ruta alternativa disponible: `/empresa/seguimiento`)*.
* **Seguimiento laboral (`/mis-practicantes`):** Registro formal de la práctica del candidato aceptado, asignación de tareas (`entregables_empresa`), revisión de archivos enviados por el aprendiz, emisión de retroalimentación (`feedback_empresa`) y gestión de novedades.

### 3. Instructor de Seguimiento (SENA)
* **Vinculación flexible sin pérdida de trazabilidad:** Si una empresa registró previamente la práctica de un aprendiz (`tutor_id` nulo), el instructor puede vincular ese registro existente desde su módulo ingresando el mismo correo del estudiante, empresa y cargo, conservando íntegramente los entregables, novedades y archivos previos.
* **Auditoría académica y cierre:** Monitoreo consolidado de aprendices asignados, auditoría de bitácoras con aval institucional, generación de reportes en PDF/Excel y emisión del aval final de cumplimiento de etapa productiva.

---

## Despliegue en Producción y Continuidad (Vercel)

1. Importa el repositorio de GitHub en [Vercel](https://vercel.com/new) apuntando a la rama `main`.
2. Configura en **Project Settings > Environment Variables** las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
3. Añade la URL asignada por Vercel (`*.vercel.app` o dominio personalizado) tanto en **Cloudflare Turnstile (Allowed Domains)** como en **Supabase > Authentication > URL Configuration (Site URL y Redirect URLs)**.
4. **Continuidad operativa:** Respaldos automáticos diarios de PostgreSQL en Supabase Cloud ($\text{RPO} < 24\text{ horas}$) complementados con migraciones versionadas en GitHub y respaldos SQL por hito ($\text{RTO} < 2\text{ horas}$).

---

## Autoría y Contexto Académico

* **Autor:** Juan Diego de la Ossa Carmona
* **Programa:** Tecnólogo en Análisis y Desarrollo de Software (ADSO) — Ficha `2721453`
* **Institución:** Servicio Nacional de Aprendizaje – **SENA** (Regional Dosquebradas – Risaralda)