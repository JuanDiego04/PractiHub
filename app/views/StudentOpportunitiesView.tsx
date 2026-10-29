'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'
import { formatInterviewDate, interviewSchemaError, isInterviewSchemaUnavailable, type CompanyInterview } from '@/lib/companyInterviews'

const MAX_CV_SIZE = 10 * 1024 * 1024
const ALLOWED_CV_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

type ApplicationStatus = 'pendiente' | 'aprobada' | 'contratada' | 'rechazada'
type OpportunityTab = 'ofertas' | 'postulaciones'
type StudentNavIcon = 'home' | 'search' | 'applications' | 'profile'

interface OfertaDisponible {
  id: string
  empresa_id: string
  titulo: string
  descripcion: string
  requisitos: string
  estado: string
  created_at: string
  fecha_inicio: string | null
  fecha_fin: string | null
  empresa: string
}

interface StudentApplication {
  id: string
  oferta_id: string
  estado: ApplicationStatus
  descripcion_perfil: string
  cv_path: string
  created_at: string
  oferta: string
  interview: CompanyInterview | null
}

interface ApplicationDraft {
  profileDescription: string
  cv: File | null
}

function StudentNavIcon({ name }: { name: StudentNavIcon }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
    applications: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v6h6M9 13h6M9 17h6" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
      {paths[name]}
    </svg>
  )
}

const statusLabels: Record<ApplicationStatus, string> = {
  pendiente: 'En revisión',
  aprobada: 'Aceptada',
  contratada: 'Contratada',
  rechazada: 'No seleccionada',
}

export default function StudentOpportunitiesView({
  studentName,
  dashboardMode = false,
  practiceError = '',
}: {
  studentName?: string
  dashboardMode?: boolean
  practiceError?: string
}) {
  const router = useRouter()
  const [offers, setOffers] = useState<OfertaDisponible[]>([])
  const [applications, setApplications] = useState<StudentApplication[]>([])
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({})
  const [search, setSearch] = useState('')
  const [interviewReferenceTime, setInterviewReferenceTime] = useState(0)
  const [activeTab, setActiveTab] = useState<OpportunityTab>('ofertas')
  const [loading, setLoading] = useState(true)
  const [redirectingToPractice, setRedirectingToPractice] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [interviewSetupError, setInterviewSetupError] = useState('')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const appliedOfferIds = useMemo(
    () => new Set(applications.map((application) => application.oferta_id)),
    [applications],
  )
  const filteredOffers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    if (!query) return offers
    return offers.filter((offer) => `${offer.titulo} ${offer.empresa} ${offer.descripcion} ${offer.requisitos}`.toLocaleLowerCase('es').includes(query))
  }, [offers, search])
  const activeApplicationsCount = applications.filter((application) => application.estado !== 'rechazada').length
  const applicationsInReviewCount = applications.filter((application) => application.estado === 'pendiente').length
  const upcomingInterviews = applications
    .filter((application) => application.estado === 'aprobada' && application.interview && interviewReferenceTime > 0 && new Date(application.interview.fecha_hora).getTime() >= interviewReferenceTime)
    .sort((first, second) => new Date(first.interview!.fecha_hora).getTime() - new Date(second.interview!.fecha_hora).getTime())

  const loadOpportunities = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setInterviewSetupError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión con tu cuenta de aprendiz para consultar las ofertas.')

      const { data: profile, error: profileError } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', user.id)
        .maybeSingle()
      if (profileError) throw new Error(`No se pudo verificar tu perfil: ${profileError.message}`)
      if (profile?.rol !== 'estudiante') throw new Error('Esta sección está disponible para cuentas de aprendiz.')

      const { data: assignments, error: assignmentError } = await supabase
        .from('tutor_estudiantes')
        .select('id')
        .eq('estudiante_id', user.id)
        .limit(1)
      if (assignmentError) throw new Error(`No se pudo comprobar tu seguimiento: ${assignmentError.message}`)
      if (assignments?.length) {
        setRedirectingToPractice(true)
        router.replace('/mi-practica')
        return
      }

      const [offersResult, applicationsResult] = await Promise.all([
        supabase
          .from('ofertas')
          .select('id, empresa_id, titulo, descripcion, requisitos, estado, created_at, fecha_inicio, fecha_fin')
          .eq('estado', 'activa')
          .order('created_at', { ascending: false }),
        supabase
          .from('postulaciones')
          .select('id, oferta_id, estado, descripcion_perfil, cv_path, created_at')
          .eq('estudiante_id', user.id)
          .order('created_at', { ascending: false }),
      ])
      if (offersResult.error) throw new Error(`No se pudieron cargar las ofertas: ${offersResult.error.message}`)
      if (applicationsResult.error) throw new Error(`No se pudieron cargar tus postulaciones: ${applicationsResult.error.message}`)

      const offerRows = offersResult.data || []
      const applicationRows = applicationsResult.data || []
      const acceptedApplicationIds = applicationRows
        .filter((application) => application.estado === 'aprobada')
        .map((application) => application.id)
      const offerIds = [...new Set([
        ...offerRows.map((offer) => offer.id),
        ...applicationRows.map((application) => application.oferta_id),
      ])]
      const companyIds = [...new Set(offerRows.map((offer) => offer.empresa_id))]
      const [companyResult, appliedOffersResult, interviewsResult] = await Promise.all([
        companyIds.length
          ? supabase.from('perfiles').select('id, nombre, nombre_empresa').in('id', companyIds)
          : Promise.resolve({ data: [], error: null }),
        offerIds.length
          ? supabase.from('ofertas').select('id, titulo').in('id', offerIds)
          : Promise.resolve({ data: [], error: null }),
        acceptedApplicationIds.length
          ? supabase
            .from('entrevistas_postulacion')
            .select('id, postulacion_id, empresa_id, estudiante_id, fecha_hora, modalidad, ubicacion, notas, created_at, updated_at')
            .in('postulacion_id', acceptedApplicationIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (companyResult.error) throw new Error(`No se pudieron cargar las empresas: ${companyResult.error.message}`)
      if (appliedOffersResult.error) throw new Error(`No se pudieron cargar los datos de tus ofertas: ${appliedOffersResult.error.message}`)
      if (interviewsResult.error) {
        if (isInterviewSchemaUnavailable(interviewsResult.error.message, interviewsResult.error.code)) {
          setInterviewSetupError(interviewSchemaError(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`, interviewsResult.error.code))
        } else {
          throw new Error(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`)
        }
      }

      setInterviewReferenceTime(Date.now())
      const companies = new Map((companyResult.data || []).map((company) => [company.id, company.nombre_empresa || company.nombre]))
      const offerTitles = new Map((appliedOffersResult.data || []).map((offer) => [offer.id, offer.titulo]))
      const interviewByApplication = new Map(
        (interviewsResult.data || []).map((interview) => [interview.postulacion_id, interview as CompanyInterview]),
      )
      const hiredOfferIds = new Set(applicationRows
        .filter((application) => application.estado === 'contratada')
        .map((application) => application.oferta_id))
      setOffers(offerRows.filter((offer) => !hiredOfferIds.has(offer.id)).map((offer) => ({
        ...offer,
        empresa: companies.get(offer.empresa_id) || 'Empresa',
      })) as OfertaDisponible[])
      setApplications(applicationRows.map((application) => ({
        ...application,
        descripcion_perfil: application.descripcion_perfil || '',
        cv_path: application.cv_path || '',
        oferta: offerTitles.get(application.oferta_id) || 'Oferta',
        interview: interviewByApplication.get(application.id) || null,
      })) as StudentApplication[])
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudieron cargar las ofertas.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    // State updates happen after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOpportunities()
  }, [loadOpportunities])

  function updateDraft(offerId: string, patch: Partial<ApplicationDraft>) {
    setDrafts((current) => ({
      ...current,
      [offerId]: {
        profileDescription: current[offerId]?.profileDescription || '',
        cv: current[offerId]?.cv || null,
        ...patch,
      },
    }))
  }

  async function applyToOffer(event: FormEvent<HTMLFormElement>, offer: OfertaDisponible) {
    event.preventDefault()
    const draft = drafts[offer.id]
    if (!draft?.cv) {
      setError('Adjunta tu hoja de vida en formato PDF o Word.')
      return
    }
    if (draft.cv.size > MAX_CV_SIZE) {
      setError('La hoja de vida supera el límite de 10 MB.')
      return
    }
    if (!ALLOWED_CV_TYPES.has(draft.cv.type)) {
      setError('La hoja de vida debe ser un archivo PDF o Word.')
      return
    }
    const profileDescription = draft.profileDescription.trim()
    if (profileDescription.length < 20 || profileDescription.length > 2000) {
      setError('Describe tu perfil en entre 20 y 2000 caracteres.')
      return
    }

    setSubmittingId(offer.id)
    setError('')
    setMessage('')
    let cvPath: string | null = null
    let fileUploaded = false
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión nuevamente para postularte.')

      const safeName = draft.cv.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
      cvPath = `${user.id}/${crypto.randomUUID()}-${safeName}`
      const applicationId = crypto.randomUUID()
      const { error: uploadError } = await supabase.storage
        .from('hojas_vida')
        .upload(cvPath, draft.cv, { contentType: draft.cv.type, upsert: false })
      if (uploadError) throw new Error(`No se pudo subir tu hoja de vida: ${uploadError.message}`)
      fileUploaded = true

      const { error: insertError } = await supabase
        .from('postulaciones')
        .insert({
          id: applicationId,
          oferta_id: offer.id,
          estudiante_id: user.id,
          empresa_id: offer.empresa_id,
          estado: 'pendiente',
          tutor_id: null,
          descripcion_perfil: profileDescription,
          cv_path: cvPath,
        })
      if (insertError) throw new Error(`No se pudo guardar tu postulación: ${insertError.message}`)

      setApplications((current) => [{
        id: applicationId,
        oferta_id: offer.id,
        estado: 'pendiente',
        descripcion_perfil: profileDescription,
        cv_path: cvPath || '',
        created_at: new Date().toISOString(),
        oferta: offer.titulo,
        interview: null,
      }, ...current])
      setDrafts((current) => ({ ...current, [offer.id]: { profileDescription: '', cv: null } }))
      setOpenApplicationId(null)
      setActiveTab('postulaciones')
      setMessage(`Tu postulación a «${offer.titulo}» se envió correctamente.`)
    } catch (submitFailure) {
      if (cvPath && fileUploaded) {
        const { error: cleanupError } = await supabase.storage.from('hojas_vida').remove([cvPath])
        if (cleanupError) {
          setError(`${submitFailure instanceof Error ? submitFailure.message : 'No se pudo enviar la postulación.'} Además, no se pudo retirar la hoja de vida temporal: ${cleanupError.message}`)
          return
        }
      }
      setError(submitFailure instanceof Error ? submitFailure.message : 'No se pudo enviar la postulación.')
    } finally {
      setSubmittingId(null)
    }
  }

  if (redirectingToPractice) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center bg-slate-900 px-4 text-slate-100">
        <p role="status" className="text-sm text-slate-400">Tu seguimiento ya está habilitado. Abriendo Mi práctica...</p>
      </main>
    )
  }

  if (dashboardMode) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-slate-100 lg:flex">
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-[#0a1020] px-4 py-4 lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r lg:px-4 lg:py-7">
          <Link href="/" className="mb-5 text-2xl font-extrabold tracking-tight text-emerald-400 lg:mb-12 lg:px-3">PractiHub</Link>
          <nav aria-label="Navegación del aprendiz" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-1 lg:flex-col lg:gap-2">
            <button type="button" onClick={() => setActiveTab('ofertas')} className="flex items-center gap-3 rounded-xl bg-slate-800/80 px-3 py-3 text-left text-sm font-medium text-emerald-300">
              <StudentNavIcon name="home" /> Inicio
            </button>
            <button type="button" onClick={() => setActiveTab('ofertas')} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
              <StudentNavIcon name="search" /> Buscar ofertas
            </button>
            <button type="button" onClick={() => setActiveTab('postulaciones')} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
              <StudentNavIcon name="applications" /> Mis postulaciones
              {applicationsInReviewCount > 0 && <span className="ml-auto rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-300">{applicationsInReviewCount}</span>}
            </button>
            <Link href="/perfil" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
              <StudentNavIcon name="profile" /> Mi perfil
            </Link>
          </nav>
          <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/70 p-4 lg:mt-auto">
            <p className="text-sm font-semibold text-slate-200">¿Necesitas ayuda?</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">Mantén tu perfil y hoja de vida actualizados para postularte.</p>
            <Link href="/perfil" className="mt-3 inline-flex text-xs font-semibold text-emerald-300 hover:text-emerald-200">Revisar mi perfil →</Link>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1500px]">
            <header className="mb-6 flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Panel del aprendiz</p>
                <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">¡Hola, {studentName || 'aprendiz'}!</h1>
              </div>
              <div className="flex items-center gap-3">
                <label className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
                  <span className="sr-only">Buscar ofertas o empresas</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
                  <input value={search} onChange={(event) => { setSearch(event.target.value); setActiveTab('ofertas') }} placeholder="Buscar ofertas o empresas..." className="w-full rounded-xl border border-slate-700 bg-slate-900/80 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400" />
                </label>
                <Link href="/perfil" className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 p-2 transition hover:border-emerald-400/40">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-bold text-emerald-300">{(studentName || 'A').trim().slice(0, 1).toUpperCase()}</span>
                  <span className="hidden max-w-36 sm:block">
                    <span className="block truncate text-sm font-semibold text-white">{studentName || 'Aprendiz'}</span>
                    <span className="block text-xs text-slate-400">Aprendiz</span>
                  </span>
                </Link>
              </div>
            </header>

            {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
            {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
            {practiceError && <p role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">{practiceError}</p>}
            {loadError && (
              <section role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-slate-800 p-4">
                <p className="text-sm text-rose-200">{loadError}</p>
                <button type="button" onClick={() => void loadOpportunities()} className="mt-3 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
              </section>
            )}
            {interviewSetupError && <p role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">{interviewSetupError}</p>}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
              <div className="space-y-5">
                <section aria-labelledby="student-summary-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10 sm:p-6">
                  <div className="mb-4">
                    <h2 id="student-summary-heading" className="text-lg font-semibold text-white">Resumen de postulaciones</h2>
                    <p className="mt-1 text-sm text-slate-400">Consulta el avance de tus procesos de selección.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: 'Postulaciones activas', value: activeApplicationsCount, color: 'text-emerald-300' },
                      { label: 'En revisión', value: applicationsInReviewCount, color: 'text-blue-300' },
                      { label: 'Entrevistas agendadas', value: upcomingInterviews.length, color: 'text-violet-300' },
                    ].map((metric) => (
                      <article key={metric.label} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 text-center">
                        <p className={`text-3xl font-bold ${loading ? 'text-slate-500' : metric.color}`}>{loading ? '—' : metric.value}</p>
                        <p className="mt-1 text-xs font-medium text-slate-400">{metric.label}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section id="student-offers" aria-labelledby="student-offers-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10 sm:p-6">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 id="student-offers-heading" className="text-lg font-semibold text-white">
                        {activeTab === 'postulaciones' ? 'Mis postulaciones' : 'Ofertas de práctica disponibles'}
                      </h2>
                      <p className="mt-1 text-sm text-slate-400">
                        {activeTab === 'postulaciones' ? 'Sigue el estado de tus procesos y consulta las entrevistas.' : 'Explora oportunidades y postúlate a las que se ajusten a tu perfil.'}
                      </p>
                    </div>
                    {activeTab === 'postulaciones' ? (
                      <button type="button" onClick={() => setActiveTab('ofertas')} className="rounded-lg border border-slate-600 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-200">Ver ofertas</button>
                    ) : (
                      <button type="button" onClick={() => setActiveTab('postulaciones')} className="rounded-lg border border-slate-600 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-200">Mis postulaciones ({applications.length})</button>
                    )}
                  </div>

                  {loading ? (
                    <p role="status" className="rounded-xl border border-slate-700 bg-slate-950/40 p-6 text-center text-sm text-slate-400">Cargando oportunidades...</p>
                  ) : activeTab === 'ofertas' ? (
                    filteredOffers.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-7 text-center">
                        <p className="font-medium text-slate-200">{search ? 'No encontramos ofertas que coincidan con tu búsqueda.' : 'Aún no hay ofertas disponibles.'}</p>
                        <p className="mt-2 text-sm text-slate-400">{search ? 'Prueba con otro cargo o nombre de empresa.' : 'Vuelve pronto para descubrir nuevas oportunidades de práctica.'}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredOffers.map((offer) => {
                          const applied = appliedOfferIds.has(offer.id)
                          const draft = drafts[offer.id]
                          return (
                            <article key={offer.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 sm:p-5">
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-emerald-300">{offer.empresa}</p>
                                  <h3 className="mt-1 text-lg font-semibold text-white">{offer.titulo}</h3>
                                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-400">{offer.descripcion}</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">Vacante activa</span>
                                    {(offer.fecha_inicio || offer.fecha_fin) && (
                                      <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                                        {offer.fecha_inicio && offer.fecha_fin ? `${readableDate(offer.fecha_inicio)} – ${readableDate(offer.fecha_fin)}` : `Inicio ${readableDate(offer.fecha_inicio || offer.fecha_fin)}`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {applied ? (
                                  <span className="shrink-0 rounded-lg border border-slate-700 px-3.5 py-2 text-center text-sm font-semibold text-slate-400">Postulación enviada</span>
                                ) : (
                                  <button type="button" onClick={() => { setOpenApplicationId((current) => current === offer.id ? null : offer.id); setError('') }} className="shrink-0 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300">
                                    {openApplicationId === offer.id ? 'Cerrar' : 'Postularme'}
                                  </button>
                                )}
                              </div>
                              {openApplicationId === offer.id && !applied && (
                                <form onSubmit={(event) => void applyToOffer(event, offer)} className="mt-4 space-y-4 border-t border-slate-700 pt-4">
                                  <p className="text-sm text-slate-300">Requisitos: <span className="whitespace-pre-wrap text-slate-400">{offer.requisitos || 'Consulta los detalles con la empresa.'}</span></p>
                                  <label className="block text-sm font-medium text-slate-300">
                                    Cuéntale a la empresa sobre tu perfil
                                    <textarea required minLength={20} maxLength={2000} rows={3} value={draft?.profileDescription || ''} onChange={(event) => updateDraft(offer.id, { profileDescription: event.target.value })} placeholder="Resume tu formación, habilidades y por qué te interesa esta práctica." className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400" />
                                    <span className="mt-1 block text-right text-xs text-slate-500">{draft?.profileDescription.length || 0}/2000</span>
                                  </label>
                                  <label className="block text-sm font-medium text-slate-300">
                                    Hoja de vida (PDF o Word, máximo 10 MB)
                                    <input required type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => updateDraft(offer.id, { cv: event.target.files?.[0] || null })} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-300 file:mr-4 file:rounded-l-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2.5 file:font-semibold file:text-white" />
                                  </label>
                                  <button type="submit" disabled={submittingId === offer.id} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                                    {submittingId === offer.id ? 'Enviando postulación...' : 'Enviar postulación'}
                                  </button>
                                </form>
                              )}
                            </article>
                          )
                        })}
                      </div>
                    )
                  ) : applications.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-7 text-center">
                      <p className="font-medium text-slate-200">Aún no tienes postulaciones.</p>
                      <p className="mt-2 text-sm text-slate-400">Explora las ofertas y envía tu perfil y hoja de vida para iniciar un proceso.</p>
                      <button type="button" onClick={() => setActiveTab('ofertas')} className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300">Explorar ofertas</button>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {applications.map((application) => (
                        <li key={application.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-white">{application.oferta}</h3>
                              <p className="mt-1 text-xs text-slate-500">Enviada {readableDate(application.created_at.slice(0, 10))}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${application.estado === 'rechazada' ? 'bg-rose-400/10 text-rose-300' : application.estado === 'pendiente' ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{statusLabels[application.estado]}</span>
                          </div>
                          {application.estado === 'aprobada' && (
                            <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3 text-sm text-emerald-100">
                              <p className="font-semibold">La empresa aceptó tu perfil y quiere continuar contigo.</p>
                              {application.interview ? (
                                <div className="mt-2 border-t border-emerald-300/20 pt-2">
                                  <p className="font-medium">Entrevista · {formatInterviewDate(application.interview.fecha_hora)}</p>
                                  <p className="mt-1">{application.interview.modalidad === 'virtual' ? 'Virtual' : 'Presencial'}</p>
                                  {application.interview.ubicacion && <p className="mt-1">{application.interview.modalidad === 'virtual' ? <a href={application.interview.ubicacion} target="_blank" rel="noreferrer" className="underline">Unirse a la entrevista</a> : application.interview.ubicacion}</p>}
                                  {application.interview.notas && <p className="mt-2 whitespace-pre-wrap text-slate-300">{application.interview.notas}</p>}
                                </div>
                              ) : <p className="mt-1 text-emerald-100/80">La empresa todavía no ha agendado una entrevista.</p>}
                            </div>
                          )}
                          {application.estado === 'contratada' && <p className="mt-3 text-sm text-blue-200">La empresa te vinculó a contrato.</p>}
                          {application.estado === 'contratada' && <Link href="/mi-practica" className="mt-2 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir seguimiento de práctica →</Link>}
                          <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-slate-400">{application.descripcion_perfil}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <aside className="space-y-5">
                <section aria-labelledby="student-events-heading" className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/95 to-slate-900/90 p-5 shadow-xl shadow-black/10">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 id="student-events-heading" className="text-lg font-semibold text-white">Próximos eventos</h2>
                      <p className="mt-1 text-sm text-slate-400">Entrevistas confirmadas por las empresas.</p>
                    </div>
                    <button type="button" onClick={() => setActiveTab('postulaciones')} className="text-xs font-semibold text-emerald-300 hover:text-emerald-200">Ver postulaciones</button>
                  </div>
                  {loading ? (
                    <p role="status" className="mt-4 text-sm text-slate-400">Cargando eventos...</p>
                  ) : upcomingInterviews.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm leading-6 text-slate-400">
                      {applications.some((application) => application.estado === 'aprobada')
                        ? 'Aún no tienes entrevistas agendadas. Aquí aparecerán cuando una empresa confirme la fecha.'
                        : 'Cuando una empresa agende una entrevista para una postulación aceptada, aparecerá aquí.'}
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {upcomingInterviews.slice(0, 5).map((application) => (
                        <li key={application.id} className="rounded-xl border border-slate-700 bg-slate-950/55 p-4">
                          <p className="font-semibold text-white">{application.oferta}</p>
                          <p className="mt-1 text-sm text-emerald-200">{formatInterviewDate(application.interview!.fecha_hora)}</p>
                          <p className="mt-1 text-xs text-slate-400">{application.interview!.modalidad === 'virtual' ? 'Entrevista virtual' : 'Entrevista presencial'}</p>
                          {application.interview!.ubicacion && (
                            <p className="mt-2 text-sm">
                              {application.interview!.modalidad === 'virtual'
                                ? <a href={application.interview!.ubicacion} target="_blank" rel="noreferrer" className="font-semibold text-emerald-300 hover:text-emerald-200">Abrir enlace →</a>
                                : <span className="text-slate-300">{application.interview!.ubicacion}</span>}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
                  <h2 className="font-semibold text-emerald-100">Prepara tu postulación</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">Completa tu información y mantén tu hoja de vida lista para aplicar a nuevas oportunidades.</p>
                  <Link href="/perfil" className="mt-4 inline-flex rounded-lg border border-emerald-400/30 px-3.5 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10">Completar mi perfil</Link>
                </section>
              </aside>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 p-6 sm:p-9">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · OPORTUNIDADES</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">¡Hola, {studentName || 'aprendiz'}!</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
            PractiHub conecta aprendices, instructores y empresas para que encuentres una oportunidad, compartas tus avances y lleves el seguimiento de tu práctica en un solo lugar.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">Explora ofertas</span>
            <span className="rounded-full border border-slate-600 bg-slate-900/70 px-3 py-1.5">Postúlate con tu perfil y hoja de vida</span>
            <Link href="/perfil" className="rounded-full border border-slate-600 bg-slate-900/70 px-3 py-1.5 transition hover:border-emerald-400/50">Completa tu perfil →</Link>
          </div>
        </header>

        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
        {loadError && (
          <section role="alert" className="mb-6 rounded-2xl border border-rose-500/30 bg-slate-800 p-6">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button type="button" onClick={() => void loadOpportunities()} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
          </section>
        )}
        {interviewSetupError && (
          <p role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">{interviewSetupError}</p>
        )}

        <div role="tablist" aria-label="Oportunidades del aprendiz" className="mb-5 flex flex-wrap gap-2 border-b border-slate-700 pb-3">
          <button type="button" role="tab" aria-selected={activeTab === 'ofertas'} onClick={() => setActiveTab('ofertas')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === 'ofertas' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Ofertas disponibles</button>
          <button type="button" role="tab" aria-selected={activeTab === 'postulaciones'} onClick={() => setActiveTab('postulaciones')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === 'postulaciones' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Mis postulaciones ({applications.length})</button>
        </div>

        {loading ? (
          <p className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Cargando oportunidades...</p>
        ) : activeTab === 'ofertas' ? (
          offers.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-12 text-center">
              <h2 className="text-xl font-semibold text-white">Aún no hay ofertas disponibles</h2>
              <p className="mt-2 text-sm text-slate-400">Vuelve pronto para descubrir nuevas oportunidades de práctica.</p>
            </section>
          ) : (
            <section aria-label="Ofertas de práctica disponibles" className="grid gap-4 lg:grid-cols-2">
              {offers.map((offer) => {
                const applied = appliedOfferIds.has(offer.id)
                const draft = drafts[offer.id]
                return (
                  <article key={offer.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-emerald-300">{offer.empresa}</p>
                        <h2 className="mt-1 text-xl font-semibold text-white">{offer.titulo}</h2>
                      </div>
                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">Vacante activa</span>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{offer.descripcion}</p>
                    <h3 className="mt-4 text-sm font-semibold text-slate-200">Requisitos</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">{offer.requisitos}</p>
                    {(offer.fecha_inicio || offer.fecha_fin) && (
                      <p className="mt-4 text-xs text-slate-500">
                        Duración: {readableDate(offer.fecha_inicio)} – {readableDate(offer.fecha_fin)}
                      </p>
                    )}

                    {applied ? (
                      <p className="mt-5 rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-emerald-300">Ya enviaste una postulación a esta oferta.</p>
                    ) : (
                      <div className="mt-5 border-t border-slate-700 pt-4">
                        <button type="button" onClick={() => { setOpenApplicationId((current) => current === offer.id ? null : offer.id); setError('') }} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
                          {openApplicationId === offer.id ? 'Cerrar formulario' : 'Postularme'}
                        </button>
                        {openApplicationId === offer.id && (
                          <form onSubmit={(event) => void applyToOffer(event, offer)} className="mt-4 space-y-4">
                            <label className="block text-sm font-medium text-slate-300">
                              Cuéntale a la empresa sobre tu perfil
                              <textarea required minLength={20} maxLength={2000} rows={4} value={draft?.profileDescription || ''} onChange={(event) => updateDraft(offer.id, { profileDescription: event.target.value })} placeholder="Resume tu formación, habilidades y por qué te interesa esta práctica." className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400" />
                              <span className="mt-1 block text-right text-xs text-slate-500">{draft?.profileDescription.length || 0}/2000</span>
                            </label>
                            <label className="block text-sm font-medium text-slate-300">
                              Hoja de vida (PDF o Word, máximo 10 MB)
                              <input required type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => updateDraft(offer.id, { cv: event.target.files?.[0] || null })} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-300 file:mr-4 file:rounded-l-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2.5 file:font-semibold file:text-white" />
                            </label>
                            <button type="submit" disabled={submittingId === offer.id} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                              {submittingId === offer.id ? 'Enviando postulación...' : 'Enviar postulación'}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </section>
          )
        ) : applications.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-12 text-center">
            <h2 className="text-xl font-semibold text-white">Aún no tienes postulaciones</h2>
            <p className="mt-2 text-sm text-slate-400">Explora las ofertas disponibles y envía tu perfil y hoja de vida.</p>
            <button type="button" onClick={() => setActiveTab('ofertas')} className="mt-5 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950">Ver ofertas</button>
          </section>
        ) : (
          <ul className="space-y-3">
            {applications.map((application) => (
              <li key={application.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{application.oferta}</h2>
                    <p className="mt-1 text-sm text-slate-500">Enviada {readableDate(application.created_at.slice(0, 10))}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${application.estado === 'rechazada' ? 'bg-rose-400/10 text-rose-300' : application.estado === 'pendiente' ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{statusLabels[application.estado]}</span>
                </div>
                {application.estado === 'aprobada' && (
                  <section role="status" className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                    <p className="font-semibold">La empresa aceptó tu perfil y quiere continuar contigo en el proceso.</p>
                    {application.interview ? (
                      <div className="mt-3 border-t border-emerald-300/20 pt-3">
                        <p className="font-semibold">Entrevista agendada</p>
                        <p className="mt-1">{formatInterviewDate(application.interview.fecha_hora)} · {application.interview.modalidad === 'virtual' ? 'Virtual' : 'Presencial'}</p>
                        {application.interview.ubicacion && (
                          <p className="mt-1">
                            {application.interview.modalidad === 'virtual'
                              ? <a href={application.interview.ubicacion} target="_blank" rel="noreferrer" className="underline">Unirse a la entrevista</a>
                              : application.interview.ubicacion}
                          </p>
                        )}
                        {application.interview.notas && <p className="mt-2 whitespace-pre-wrap">{application.interview.notas}</p>}
                      </div>
                    ) : (
                      <p className="mt-1">La empresa todavía no ha agendado una entrevista.</p>
                    )}
                    {interviewSetupError && <p className="mt-2 text-xs text-amber-100">La agenda no está disponible hasta que se configure en el sistema.</p>}
                  </section>
                )}
                {application.estado === 'contratada' && (
                  <p role="status" className="mt-4 rounded-lg border border-blue-400/30 bg-blue-400/10 px-4 py-3 text-sm leading-6 text-blue-200">
                    La empresa te vinculó a contrato. Esta oferta ya no aparece entre las vacantes disponibles.
                  </p>
                )}
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-400">{application.descripcion_perfil}</p>
                {application.estado === 'contratada' && (
                  <Link href="/mi-practica" className="mt-4 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir seguimiento de práctica →</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
