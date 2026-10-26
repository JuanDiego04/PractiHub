'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'

const MAX_CV_SIZE = 10 * 1024 * 1024
const ALLOWED_CV_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

type ApplicationStatus = 'pendiente' | 'aprobada' | 'contratada' | 'rechazada'
type OpportunityTab = 'ofertas' | 'postulaciones'

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
}

interface ApplicationDraft {
  profileDescription: string
  cv: File | null
}

const statusLabels: Record<ApplicationStatus, string> = {
  pendiente: 'En revisión',
  aprobada: 'Aceptada',
  contratada: 'Contratada',
  rechazada: 'No seleccionada',
}

export default function StudentOpportunitiesView({ studentName }: { studentName?: string }) {
  const router = useRouter()
  const [offers, setOffers] = useState<OfertaDisponible[]>([])
  const [applications, setApplications] = useState<StudentApplication[]>([])
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({})
  const [activeTab, setActiveTab] = useState<OpportunityTab>('ofertas')
  const [loading, setLoading] = useState(true)
  const [redirectingToPractice, setRedirectingToPractice] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const appliedOfferIds = useMemo(
    () => new Set(applications.map((application) => application.oferta_id)),
    [applications],
  )

  const loadOpportunities = useCallback(async () => {
    setLoading(true)
    setLoadError('')
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
      const offerIds = [...new Set([
        ...offerRows.map((offer) => offer.id),
        ...applicationRows.map((application) => application.oferta_id),
      ])]
      const companyIds = [...new Set(offerRows.map((offer) => offer.empresa_id))]
      const [companyResult, appliedOffersResult] = await Promise.all([
        companyIds.length
          ? supabase.from('perfiles').select('id, nombre, nombre_empresa').in('id', companyIds)
          : Promise.resolve({ data: [], error: null }),
        offerIds.length
          ? supabase.from('ofertas').select('id, titulo').in('id', offerIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (companyResult.error) throw new Error(`No se pudieron cargar las empresas: ${companyResult.error.message}`)
      if (appliedOffersResult.error) throw new Error(`No se pudieron cargar los datos de tus ofertas: ${appliedOffersResult.error.message}`)

      const companies = new Map((companyResult.data || []).map((company) => [company.id, company.nombre_empresa || company.nombre]))
      const offerTitles = new Map((appliedOffersResult.data || []).map((offer) => [offer.id, offer.titulo]))
      setOffers(offerRows.map((offer) => ({
        ...offer,
        empresa: companies.get(offer.empresa_id) || 'Empresa',
      })) as OfertaDisponible[])
      setApplications(applicationRows.map((application) => ({
        ...application,
        descripcion_perfil: application.descripcion_perfil || '',
        cv_path: application.cv_path || '',
        oferta: offerTitles.get(application.oferta_id) || 'Oferta',
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
