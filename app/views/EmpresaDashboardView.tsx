'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CompanyInterviewScheduler from '@/app/components/CompanyInterviewScheduler'
import { supabase } from '@/lib/supabase'
import { interviewSchemaError, isInterviewSchemaUnavailable, type CompanyInterview } from '@/lib/companyInterviews'

type ApplicationState = 'pendiente' | 'aprobada' | 'contratada' | 'rechazada'

interface CompanyOffer {
  id: string
  titulo: string
  estado: 'activa' | 'cerrada'
  created_at: string
}

interface CompanyApplication {
  id: string
  oferta_id: string
  estudiante_id: string
  estado: ApplicationState
  created_at: string
}

interface CompanyPractice {
  id: string
  cargo: string
  estado: 'en_curso' | 'finalizada'
}

interface RecentApplication extends CompanyApplication {
  studentName: string
  interview: CompanyInterview | null
}

const applicationLabels: Record<ApplicationState, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aceptada',
  contratada: 'Contratada',
  rechazada: 'No seleccionada',
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function NavigationIcon({ name }: { name: 'home' | 'plus' | 'briefcase' | 'users' | 'profile' | 'logout' | 'bell' }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6M23 11h-6" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
      {paths[name]}
    </svg>
  )
}

function StatusBadge({ state }: { state: ApplicationState }) {
  const styles: Record<ApplicationState, string> = {
    pendiente: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    aprobada: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    contratada: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
    rechazada: 'border-slate-600 bg-slate-700/60 text-slate-300',
  }

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${styles[state]}`}>{applicationLabels[state]}</span>
}

export default function EmpresaDashboardView({
  companyUserId,
  accountName,
}: {
  companyUserId: string
  accountName: string
}) {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [offers, setOffers] = useState<CompanyOffer[]>([])
  const [applications, setApplications] = useState<RecentApplication[]>([])
  const [practices, setPractices] = useState<CompanyPractice[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [interviewSetupError, setInterviewSetupError] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setInterviewSetupError('')
    try {
      const [profileResult, offersResult, applicationsResult, practicesResult] = await Promise.all([
        supabase.from('perfiles').select('nombre_empresa').eq('id', companyUserId).maybeSingle(),
        supabase.from('ofertas').select('id, titulo, estado, created_at').eq('empresa_id', companyUserId).order('created_at', { ascending: false }),
        supabase.from('postulaciones').select('id, oferta_id, estudiante_id, estado, created_at').eq('empresa_id', companyUserId).order('created_at', { ascending: false }),
        supabase.from('tutor_estudiantes').select('id, cargo, estado').eq('empresa_id', companyUserId).order('created_at', { ascending: false }),
      ])

      if (profileResult.error) throw new Error(`No se pudo cargar el perfil de la empresa: ${profileResult.error.message}`)
      if (offersResult.error) throw new Error(`No se pudieron cargar las ofertas: ${offersResult.error.message}`)
      if (applicationsResult.error) throw new Error(`No se pudieron cargar las postulaciones: ${applicationsResult.error.message}`)
      if (practicesResult.error) throw new Error(`No se pudieron cargar las prácticas: ${practicesResult.error.message}`)

      const applicationRows = (applicationsResult.data || []) as CompanyApplication[]
      const studentIds = [...new Set(applicationRows.map((application) => application.estudiante_id))]
      const acceptedApplicationIds = applicationRows
        .filter((application) => application.estado === 'aprobada')
        .map((application) => application.id)
      const [studentsResult, interviewsResult] = await Promise.all([
        studentIds.length
          ? supabase.from('perfiles').select('id, nombre').in('id', studentIds)
          : Promise.resolve({ data: [], error: null }),
        acceptedApplicationIds.length
          ? supabase
            .from('entrevistas_postulacion')
            .select('id, postulacion_id, empresa_id, estudiante_id, fecha_hora, modalidad, ubicacion, notas, created_at, updated_at')
            .in('postulacion_id', acceptedApplicationIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (studentsResult.error) throw new Error(`No se pudieron cargar los nombres de los candidatos: ${studentsResult.error.message}`)
      if (interviewsResult.error) {
        if (isInterviewSchemaUnavailable(interviewsResult.error.message, interviewsResult.error.code)) {
          setInterviewSetupError(interviewSchemaError(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`, interviewsResult.error.code))
        } else {
          throw new Error(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`)
        }
      }

      const students = new Map((studentsResult.data || []).map((student) => [student.id, student.nombre]))
      const interviewByApplication = new Map(
        (interviewsResult.data || []).map((interview) => [interview.postulacion_id, interview as CompanyInterview]),
      )
      setCompanyName(profileResult.data?.nombre_empresa?.trim() || '')
      setOffers((offersResult.data || []) as CompanyOffer[])
      setApplications(applicationRows.map((application) => ({
        ...application,
        studentName: students.get(application.estudiante_id) || 'Candidato',
        interview: interviewByApplication.get(application.id) || null,
      })))
      setPractices((practicesResult.data || []) as CompanyPractice[])
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : 'No se pudo cargar el panel de empresa.')
    } finally {
      setLoading(false)
    }
  }, [companyUserId])

  useEffect(() => {
    // Load company data after the dashboard has mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard()
  }, [loadDashboard])

  const filteredOffers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es')
    if (!normalizedSearch) return offers
    return offers.filter((offer) => offer.titulo.toLocaleLowerCase('es').includes(normalizedSearch))
  }, [offers, search])

  const activeOfferCount = offers.filter((offer) => offer.estado === 'activa').length
  const pendingApplicationCount = applications.filter((application) => application.estado === 'pendiente').length
  const currentPracticeCount = practices.filter((practice) => practice.estado === 'en_curso').length
  const offerApplicationCounts = new Map<string, number>()
  for (const application of applications) {
    offerApplicationCounts.set(application.oferta_id, (offerApplicationCounts.get(application.oferta_id) || 0) + 1)
  }

  async function signOut() {
    setSigningOut(true)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setLoadError(`No se pudo cerrar la sesión: ${signOutError.message}`)
      setSigningOut(false)
      return
    }
    router.replace('/login')
  }

  const companyInitial = (companyName || accountName || 'E').trim().slice(0, 1).toUpperCase()

  return (
    <div className="min-h-screen bg-[#0b1220] text-slate-100 lg:flex">
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-[#0a1020] px-4 py-4 lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r lg:px-4 lg:py-7">
        <Link href="/" className="mb-5 text-2xl font-extrabold tracking-tight text-emerald-400 lg:mb-12 lg:px-3">PractiHub</Link>
        <nav aria-label="Navegación de empresa" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-1 lg:flex-col lg:gap-2">
          <Link href="/empresa/dashboard" aria-current="page" className="flex items-center gap-3 rounded-xl bg-slate-800/80 px-3 py-3 text-sm font-medium text-emerald-300">
            <NavigationIcon name="home" /> Inicio
          </Link>
          <Link href="/mis-ofertas" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <NavigationIcon name="plus" /> Publicar oferta
          </Link>
          <Link href="/mis-ofertas" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <NavigationIcon name="briefcase" /> Gestionar vacantes
          </Link>
          <Link href="/postulaciones" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <NavigationIcon name="users" /> Candidatos
            {!loading && pendingApplicationCount > 0 && <span className="ml-auto rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-300">{pendingApplicationCount}</span>}
          </Link>
          <Link href="/perfil" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <NavigationIcon name="profile" /> Perfil de empresa
          </Link>
          <Link href="/mis-practicantes" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white lg:mt-auto">
            <NavigationIcon name="briefcase" /> Seguimiento laboral
          </Link>
          <button type="button" disabled={signingOut} onClick={() => void signOut()} className="col-span-2 flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-60 sm:col-span-1 lg:col-span-1">
            <NavigationIcon name="logout" /> {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[1500px]">
          <header className="mb-6 flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-400/10 text-lg font-bold text-emerald-300">{companyInitial}</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Panel de empresa</p>
                <h1 className="mt-1 text-xl font-bold text-white sm:text-2xl">{companyName || accountName || 'Tu empresa'}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <span className="sr-only">Buscar ofertas</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ofertas..." className="w-full rounded-xl border border-slate-700 bg-slate-900/80 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400" />
              </label>
              <Link href="/postulaciones" aria-label={`${pendingApplicationCount} postulaciones pendientes`} title="Ver postulaciones" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-300">
                <NavigationIcon name="bell" />
                {!loading && pendingApplicationCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-slate-950">{pendingApplicationCount}</span>}
              </Link>
            </div>
          </header>

          {loadError && (
            <section role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200 sm:flex-row sm:items-center sm:justify-between">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadDashboard()} className="shrink-0 rounded-lg border border-rose-300/30 px-3 py-2 font-semibold transition hover:bg-rose-400/10">Reintentar</button>
            </section>
          )}
          {interviewSetupError && (
            <p role="alert" className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">{interviewSetupError}</p>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,0.9fr)]">
            <div className="space-y-5">
              <section aria-labelledby="activity-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10 sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id="activity-heading" className="text-lg font-semibold text-white">Resumen de actividad</h2>
                    <p className="mt-1 text-sm text-slate-400">Estado actual de tus procesos de selección y práctica.</p>
                  </div>
                  <Link href="/perfil" className="text-sm font-medium text-emerald-300 hover:text-emerald-200">Perfil de empresa →</Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Ofertas activas', value: activeOfferCount, color: 'text-emerald-300' },
                    { label: 'Postulados por revisar', value: pendingApplicationCount, color: 'text-blue-300' },
                    { label: 'Prácticas en curso', value: currentPracticeCount, color: 'text-violet-300' },
                  ].map((metric) => (
                    <article key={metric.label} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 text-center">
                      <p className={`text-3xl font-bold ${metric.color}`}>{loading ? '—' : metric.value}</p>
                      <p className="mt-1 text-xs font-medium text-slate-400">{metric.label}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section aria-labelledby="offers-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10 sm:p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id="offers-heading" className="text-lg font-semibold text-white">Gestión de vacantes y postulados</h2>
                    <p className="mt-1 text-sm text-slate-400">Consulta tus ofertas y accede a sus candidatos.</p>
                  </div>
                  <Link href="/mis-ofertas" className="rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300">+ Publicar oferta</Link>
                </div>
                {loading ? (
                  <p role="status" className="rounded-xl border border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-400">Cargando tus ofertas...</p>
                ) : filteredOffers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-6 text-center">
                    <p className="font-medium text-slate-200">{search ? 'No hay ofertas que coincidan con la búsqueda.' : 'Aún no tienes ofertas publicadas.'}</p>
                    {!search && <p className="mt-2 text-sm text-slate-400">Publica una vacante para empezar a recibir postulaciones.</p>}
                    {!search && <Link href="/mis-ofertas" className="mt-4 inline-flex rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300">Crear primera oferta</Link>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredOffers.slice(0, 5).map((offer) => (
                      <article key={offer.id} className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-white">{offer.titulo}</h3>
                          <p className="mt-1 text-sm text-slate-400">{offerApplicationCounts.get(offer.id) || 0} postulaciones · Publicada {formatDate(offer.created_at)}</p>
                          <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${offer.estado === 'activa' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-slate-600 bg-slate-700/60 text-slate-300'}`}>
                            {offer.estado === 'activa' ? 'Activa' : 'Cerrada'}
                          </span>
                        </div>
                        <Link href="/postulaciones" className="shrink-0 rounded-lg border border-emerald-400/50 px-3.5 py-2 text-center text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10">Ver candidatos</Link>
                      </article>
                    ))}
                    {filteredOffers.length > 5 && <Link href="/mis-ofertas" className="inline-flex pt-1 text-sm font-semibold text-emerald-300 hover:text-emerald-200">Ver todas las ofertas →</Link>}
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-5">
              <section aria-labelledby="applications-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="applications-heading" className="text-lg font-semibold text-white">Postulaciones recientes</h2>
                  <Link href="/postulaciones" className="text-xs font-semibold text-emerald-300 hover:text-emerald-200">Ver todas</Link>
                </div>
                {loading ? (
                  <p role="status" className="mt-4 text-sm text-slate-400">Cargando postulaciones...</p>
                ) : applications.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm leading-6 text-slate-400">Cuando alguien se postule a una de tus ofertas, verás su perfil aquí.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {applications.slice(0, 4).map((application) => {
                      const offerTitle = offers.find((offer) => offer.id === application.oferta_id)?.titulo || 'Oferta'
                      return (
                        <article key={application.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h3 className="font-semibold text-white">{application.studentName}</h3>
                              <p className="mt-0.5 text-xs text-slate-400">Postulado a {offerTitle}</p>
                            </div>
                            <StatusBadge state={application.estado} />
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500">{formatDate(application.created_at)}</span>
                            <Link href="/postulaciones" className="text-xs font-semibold text-emerald-300 hover:text-emerald-200">Revisar perfil →</Link>
                          </div>
                          {application.estado === 'aprobada' && (
                            <CompanyInterviewScheduler
                              applicationId={application.id}
                              companyId={companyUserId}
                              studentId={application.estudiante_id}
                              interview={application.interview}
                              onScheduled={(interview) => setApplications((current) => current.map((item) => item.id === application.id ? { ...item, interview } : item))}
                            />
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>

              <section aria-labelledby="practice-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="practice-heading" className="text-lg font-semibold text-white">Seguimiento de prácticas</h2>
                  <Link href="/mis-practicantes" className="text-xs font-semibold text-emerald-300 hover:text-emerald-200">Gestionar</Link>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">Administra entregables y novedades de tus practicantes desde el módulo de seguimiento laboral.</p>
                {!loading && practices.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {practices.filter((practice) => practice.estado === 'en_curso').slice(0, 3).map((practice) => (
                      <li key={practice.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2.5">
                        <span className="truncate text-sm text-slate-200">{practice.cargo}</span>
                        <span className="shrink-0 text-xs font-medium text-emerald-300">En curso</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/mis-practicantes" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-200">
                  Abrir seguimiento laboral
                </Link>
              </section>

              <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
                <h2 className="font-semibold text-emerald-100">Convenio SENA</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">La información de convenios y entrevistas aún no se gestiona en el módulo. Consulta el estado con tu administrador.</p>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}
