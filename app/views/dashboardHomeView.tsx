'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ModuleNavigation from '@/app/components/ModuleNavigation'
import { supabase } from '@/lib/supabase'
import { getAssignedStudents, getEvaluations } from '@/lib/tutorSeguimiento'

interface Perfil {
  nombre: string
  rol: string
}

interface Metric {
  label: string
  value: string
  detail: string
  accent: 'emerald' | 'blue' | 'violet'
}

const dashboardByRole: Record<string, { subtitle: string; metrics: Metric[] }> = {
  estudiante: {
    subtitle: 'Resumen de tus prácticas profesionales',
    metrics: [
      { label: 'Postulaciones activas', value: '—', detail: 'Se mostrará cuando se conecten tus postulaciones', accent: 'emerald' },
      { label: 'Entrevistas programadas', value: '—', detail: 'Se mostrará cuando se conecten tus entrevistas', accent: 'blue' },
      { label: 'Estado de práctica', value: '—', detail: 'Se actualizará desde tus seguimientos', accent: 'violet' },
    ],
  },
  empresa: {
    subtitle: 'Gestión de vacantes y candidatos',
    metrics: [
      { label: 'Ofertas activas', value: '—', detail: 'Se mostrará cuando se conecten tus ofertas', accent: 'emerald' },
      { label: 'Postulaciones por revisar', value: '—', detail: 'Se mostrará cuando se conecten tus postulaciones', accent: 'blue' },
      { label: 'Practicantes contratados', value: '—', detail: 'Se mostrará cuando se conecten tus contrataciones', accent: 'violet' },
    ],
  },
  tutor: {
    subtitle: 'Panel de seguimiento académico',
    metrics: [
      { label: 'Estudiantes asignados', value: '—', detail: 'Cargando tus seguimientos', accent: 'blue' },
      { label: 'Evaluaciones registradas', value: '—', detail: 'Cargando tu historial', accent: 'violet' },
    ],
  },
}

const accentStyles = {
  emerald: {
    icon: 'bg-emerald-400/10 text-emerald-300',
    glow: 'from-emerald-400/10',
    marker: 'bg-emerald-400',
  },
  blue: {
    icon: 'bg-blue-400/10 text-blue-300',
    glow: 'from-blue-400/10',
    marker: 'bg-blue-400',
  },
  violet: {
    icon: 'bg-violet-400/10 text-violet-300',
    glow: 'from-violet-400/10',
    marker: 'bg-violet-400',
  },
}

function MetricCard({ metric, index }: { metric: Metric; index: number }) {
  const styles = accentStyles[metric.accent]

  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:border-slate-600 sm:p-6">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${styles.glow} to-transparent`} />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">{metric.label}</p>
          <p className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">{metric.value}</p>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles.icon}`} aria-hidden="true">
          <span className="text-lg font-bold">{index + 1}</span>
        </span>
      </div>
      <div className="relative mt-5 flex items-center gap-2 border-t border-slate-700/80 pt-4">
        <span className={`h-1.5 w-1.5 rounded-full ${styles.marker}`} />
        <p className="text-xs leading-5 text-slate-400">{metric.detail}</p>
      </div>
    </article>
  )
}

function QuickAction({
  label,
  detail,
  href,
  primary = false,
}: {
  label: string
  detail: string
  href?: string
  primary?: boolean
}) {
  const className = `flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border px-5 py-4 text-left transition ${
    primary
      ? 'border-emerald-400 bg-emerald-400 text-slate-950 hover:bg-emerald-300'
      : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 hover:bg-slate-900'
  }`

  const content = (
    <>
      <span>
        <span className="block font-semibold">{label}</span>
        <span className={`mt-1 block text-xs ${primary ? 'text-slate-800/80' : 'text-slate-500'}`}>{detail}</span>
      </span>
      <span className="text-xl" aria-hidden="true">→</span>
    </>
  )

  if (href) {
    return <Link href={href} className={className}>{content}</Link>
  }

  return (
    <button type="button" disabled className={`${className} cursor-not-allowed opacity-70`}>
      <span>
        <span className="block font-semibold">{label}</span>
        <span className={`mt-1 block text-xs ${primary ? 'text-slate-800/80' : 'text-slate-500'}`}>
          {detail} · Próximamente
        </span>
      </span>
      <span className="text-xl" aria-hidden="true">→</span>
    </button>
  )
}

export default function DashboardHomeView() {
  const router = useRouter()
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tutorMetricError, setTutorMetricError] = useState('')
  const [tutorMetricValues, setTutorMetricValues] = useState<{ students: number; evaluations: number } | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError) {
        if (!cancelled) {
          setError(`No se pudo verificar la sesión: ${authError.message}`)
          setLoading(false)
        }
        return
      }

      if (!user) {
        router.replace('/login')
        return
      }

      const { data, error: profileError } = await supabase
        .from('perfiles')
        .select('nombre, rol')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (profileError) {
        setError(`No se pudo cargar tu perfil: ${profileError.message}`)
      } else if (!data) {
        setError('Tu cuenta no tiene un perfil asociado. Contacta al administrador para recibir ayuda.')
      } else {
        setPerfil(data)
        if (data.rol === 'tutor') {
          try {
            const assignedStudents = await getAssignedStudents(user.id)
            const evaluations = await getEvaluations(assignedStudents.map((student) => student.id))
            if (!cancelled) {
              setTutorMetricValues({ students: assignedStudents.length, evaluations: evaluations.length })
              setTutorMetricError('')
            }
          } catch (metricError) {
            if (!cancelled) {
              setTutorMetricError(metricError instanceof Error ? metricError.message : 'No se pudieron cargar tus indicadores.')
            }
          }
        }
      }

      if (!cancelled) setLoading(false)
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [router])

  async function handleSignOut() {
    setSigningOut(true)
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      setError(`No se pudo cerrar la sesión: ${signOutError.message}`)
      setSigningOut(false)
      return
    }

    router.replace('/login')
  }

  if (loading) {
    return (
      <>
        <ModuleNavigation />
        <main className="flex min-h-screen items-center justify-center bg-slate-900 px-4 text-slate-100">
          <p className="animate-pulse text-sm font-medium text-slate-400">Cargando tu panel...</p>
        </main>
      </>
    )
  }

  if (error || !perfil) {
    return (
      <>
        <ModuleNavigation />
        <main className="flex min-h-screen items-center justify-center bg-slate-900 px-4 text-slate-100">
          <section role="alert" className="w-full max-w-lg rounded-2xl border border-rose-400/20 bg-slate-800 p-6 text-center">
            <h1 className="text-xl font-bold text-white">No pudimos abrir tu panel</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">{error || 'No se encontró la información de tu perfil.'}</p>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="mt-6 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            >
              {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
            </button>
          </section>
        </main>
      </>
    )
  }

  const dashboard = dashboardByRole[perfil.rol]

  if (!dashboard) {
    return (
      <>
        <ModuleNavigation />
        <main className="flex min-h-screen items-center justify-center bg-slate-900 px-4 text-slate-100">
          <section role="alert" className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center">
            <h1 className="text-xl font-bold text-white">Perfil no disponible</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              El rol asociado a tu cuenta no tiene un panel configurado.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="mt-6 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            >
              {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
            </button>
          </section>
        </main>
      </>
    )
  }

  const metrics = perfil.rol === 'tutor' && tutorMetricValues
    ? dashboard.metrics.map((metric, index) => ({
      ...metric,
      value: String(index === 0 ? tutorMetricValues.students : tutorMetricValues.evaluations),
      detail: index === 0 ? 'Prácticas asignadas por ti' : 'Evaluaciones guardadas por ti',
    }))
    : dashboard.metrics

  return (
    <>
    <ModuleNavigation />
    <main className="min-h-screen bg-slate-900 px-4 py-6 text-slate-100 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · PANEL DE CONTROL</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Hola, {perfil.nombre || 'bienvenido'}
            </h1>
            <p className="mt-2 text-sm text-slate-400 sm:text-base">{dashboard.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="self-start rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
          >
            {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          </button>
        </header>

        <section aria-label="Resumen de métricas">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Tu resumen</h2>
            <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium capitalize text-slate-400">
              {perfil.rol}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {metrics.map((metric, index) => (
              <MetricCard key={metric.label} metric={metric} index={index} />
            ))}
          </div>
          {tutorMetricError && perfil.rol === 'tutor' && (
            <p role="alert" className="mt-4 text-sm text-rose-300">{tutorMetricError}</p>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:mt-10 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Acciones rápidas</h2>
            <p className="mt-1 text-sm text-slate-400">Continúa con lo que necesitas hacer hoy.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {perfil.rol === 'estudiante' && (
              <QuickAction
                label="Explorar ofertas"
                detail="Encuentra tu próxima oportunidad"
                href="/buscar-practicas"
                primary
              />
            )}
            {perfil.rol === 'empresa' && (
              <>
                <QuickAction label="Publicar nueva oferta" detail="Atrae talento a tu equipo" primary />
                <QuickAction label="Ver candidatos" detail="Revisa nuevas postulaciones" />
              </>
            )}
            {perfil.rol === 'tutor' && (
              <>
                <QuickAction
                  label="Ver estudiantes asignados"
                  detail="Registra aprendices y sigue sus prácticas"
                  href="/estudiantes"
                />
                <QuickAction
                  label="Revisar evaluaciones"
                  detail="Registra calificaciones y retroalimentación"
                  href="/evaluaciones"
                  primary
                />
              </>
            )}
          </div>
        </section>
      </div>
    </main>
    </>
  )
}
