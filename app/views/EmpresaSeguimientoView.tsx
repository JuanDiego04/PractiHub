'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CompanyInterviewScheduler from '@/app/components/CompanyInterviewScheduler'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'
import { interviewSchemaError, isInterviewSchemaUnavailable, type CompanyInterview } from '@/lib/companyInterviews'

type ApplicationState = 'pendiente' | 'aprobada' | 'contratada' | 'rechazada'
type ApplicationSection = 'pendientes' | 'aceptados' | 'contratados' | 'noSeleccionados'

export interface PostulacionConPerfil {
  id: string
  oferta_id: string
  estudiante_id: string
  empresa_id: string
  estado: ApplicationState
  created_at: string
  descripcion_perfil: string | null
  cv_path: string | null
  oferta: { titulo: string } | null
  estudiante: { nombre: string; email: string } | null
}

const stateLabels: Record<ApplicationState, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aceptada · aprendiz notificado',
  contratada: 'Vinculada a contrato',
  rechazada: 'No seleccionada',
}

export default function EmpresaSeguimientoView() {
  const [applications, setApplications] = useState<PostulacionConPerfil[]>([])
  const [interviews, setInterviews] = useState<Record<string, CompanyInterview>>({})
  const [activeSection, setActiveSection] = useState<ApplicationSection>('pendientes')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [interviewSetupError, setInterviewSetupError] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [cvUrls, setCvUrls] = useState<Record<string, string>>({})

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setInterviewSetupError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión con tu cuenta de empresa para consultar tus postulaciones.')

      const { data: profile, error: profileError } = await supabase.from('perfiles').select('rol').eq('id', user.id).maybeSingle()
      if (profileError) throw new Error(`No se pudo verificar tu perfil: ${profileError.message}`)
      if (profile?.rol !== 'empresa') throw new Error('Esta sección está disponible para cuentas de empresa.')

      const { data: rows, error: applicationsError } = await supabase
        .from('postulaciones')
        .select('id, oferta_id, estudiante_id, empresa_id, estado, created_at, descripcion_perfil, cv_path, oferta:ofertas(titulo)')
        .eq('empresa_id', user.id)
        .order('created_at', { ascending: false })
      if (applicationsError) throw new Error(`No se pudieron cargar las postulaciones: ${applicationsError.message}`)

      const applicationRows = (rows || []) as unknown as Omit<PostulacionConPerfil, 'estudiante'>[]
      const studentIds = [...new Set(applicationRows.map((application) => application.estudiante_id))]
      const studentsResult = studentIds.length > 0
        ? await supabase.from('perfiles').select('id, nombre, email').in('id', studentIds)
        : { data: [], error: null }
      if (studentsResult.error) throw new Error(`No se pudieron cargar los perfiles de estudiantes: ${studentsResult.error.message}`)

      const acceptedApplicationIds = applicationRows
        .filter((application) => application.estado === 'aprobada')
        .map((application) => application.id)
      const interviewsResult = acceptedApplicationIds.length
        ? await supabase
          .from('entrevistas_postulacion')
          .select('id, postulacion_id, empresa_id, estudiante_id, fecha_hora, modalidad, ubicacion, notas, created_at, updated_at')
          .in('postulacion_id', acceptedApplicationIds)
        : { data: [], error: null }
      if (interviewsResult.error) {
        if (isInterviewSchemaUnavailable(interviewsResult.error.message, interviewsResult.error.code)) {
          setInterviewSetupError(interviewSchemaError(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`, interviewsResult.error.code))
        } else {
          throw new Error(`No se pudieron cargar las entrevistas: ${interviewsResult.error.message}`)
        }
      }

      const students = new Map((studentsResult.data || []).map((student) => [student.id, { nombre: student.nombre, email: student.email }]))
      setInterviews(Object.fromEntries((interviewsResult.data || []).map((interview) => [interview.postulacion_id, interview as CompanyInterview])))
      setApplications(applicationRows.map((application) => ({
        ...application,
        oferta: Array.isArray(application.oferta) ? application.oferta[0] : application.oferta,
        estudiante: students.get(application.estudiante_id) || null,
      })))
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudieron cargar las postulaciones.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const pending = applications.filter(
      (application): application is PostulacionConPerfil & { cv_path: string } => Boolean(application.cv_path) && !(application.id in cvUrls),
    )
    if (pending.length === 0) return

    void Promise.all(pending.map(async (application) => {
      const { data, error: urlError } = await supabase.storage
        .from('hojas_vida')
        .createSignedUrl(application.cv_path, 60 * 60)
      if (urlError) throw new Error(`No se pudo abrir la hoja de vida de ${application.estudiante?.nombre || 'un candidato'}: ${urlError.message}`)
      return [application.id, data.signedUrl] as const
    })).then((results) => {
      if (!cancelled) setCvUrls((current) => ({ ...current, ...Object.fromEntries(results) }))
    }).catch((urlError: unknown) => {
      if (!cancelled) setError(urlError instanceof Error ? urlError.message : 'No se pudieron abrir las hojas de vida.')
    })

    return () => { cancelled = true }
  }, [applications, cvUrls])

  useEffect(() => {
    // Loading updates component state after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApplications()
  }, [loadApplications])

  async function updateApplicationStatus(application: PostulacionConPerfil, status: 'aprobada' | 'contratada' | 'rechazada') {
    setUpdatingId(application.id)
    setMessage('')
    setError('')
    try {
      const { data, error: updateError } = await supabase
        .from('postulaciones')
        .update({ estado: status, updated_at: new Date().toISOString() })
        .eq('id', application.id)
        .eq('empresa_id', application.empresa_id)
        .select('id')
      if (updateError) throw new Error(`No se pudo actualizar la postulación: ${updateError.message}`)
      if (!data?.length) throw new Error('No se actualizó ningún registro. Recarga la página e inténtalo nuevamente.')

      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, estado: status } : item))
      setMessage(status === 'aprobada'
        ? `Se aceptó a ${application.estudiante?.nombre || 'el estudiante'}. La aceptación ya aparece en sus postulaciones.`
        : status === 'contratada'
          ? `${application.estudiante?.nombre || 'El candidato'} quedó vinculado a contrato. Registra la práctica en Seguimiento laboral para iniciar el seguimiento.`
          : `Se rechazó la postulación de ${application.estudiante?.nombre || 'el estudiante'}.`)
    } catch (updateFailure) {
      setError(updateFailure instanceof Error ? updateFailure.message : 'No se pudo actualizar la postulación.')
    } finally {
      setUpdatingId(null)
    }
  }

  const sectionApplications = applications.filter((application) => {
    if (activeSection === 'pendientes') return application.estado === 'pendiente'
    if (activeSection === 'aceptados') return application.estado === 'aprobada'
    if (activeSection === 'contratados') return application.estado === 'contratada'
    return application.estado === 'rechazada'
  })
  const sectionCounts: Record<ApplicationSection, number> = {
    pendientes: applications.filter((application) => application.estado === 'pendiente').length,
    aceptados: applications.filter((application) => application.estado === 'aprobada').length,
    contratados: applications.filter((application) => application.estado === 'contratada').length,
    noSeleccionados: applications.filter((application) => application.estado === 'rechazada').length,
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · EMPRESA</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Revisión de postulaciones</h1>
          <p className="mt-2 max-w-2xl text-slate-400">Organiza las postulaciones pendientes, los candidatos aceptados y las vinculaciones a contrato.</p>
        </header>

        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
        {interviewSetupError && <p role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">{interviewSetupError}</p>}

        {loading ? (
          <p className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Cargando postulaciones...</p>
        ) : loadError ? (
          <section role="alert" className="rounded-2xl border border-rose-500/30 bg-slate-800 p-8 text-center">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button type="button" onClick={() => void loadApplications()} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
          </section>
        ) : applications.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-12 text-center">
            <h2 className="text-xl font-semibold text-white">Aún no tienes postulaciones</h2>
            <p className="mt-2 text-sm text-slate-400">Cuando un estudiante se postule a una de tus ofertas, podrás revisar su perfil aquí.</p>
          </section>
        ) : (
          <>
            <div role="tablist" aria-label="Estados de postulaciones" className="mb-5 flex flex-wrap gap-2 border-b border-slate-700 pb-3">
              {([
                ['pendientes', 'Pendientes'],
                ['aceptados', 'Aceptados'],
                ['contratados', 'Contratados'],
                ['noSeleccionados', 'No seleccionados'],
              ] as const).map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={activeSection === section}
                  onClick={() => setActiveSection(section)}
                  className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeSection === section ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  {label} ({sectionCounts[section]})
                </button>
              ))}
            </div>
            {sectionApplications.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-10 text-center">
                <h2 className="text-lg font-semibold text-white">
                  {activeSection === 'pendientes'
                    ? 'No tienes postulaciones pendientes'
                    : activeSection === 'aceptados'
                      ? 'Aún no tienes candidatos aceptados'
                      : activeSection === 'contratados'
                        ? 'No tienes aprendices vinculados a contrato'
                        : 'No tienes candidatos descartados'}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {activeSection === 'pendientes'
                    ? 'Las nuevas postulaciones aparecerán aquí para que puedas revisar sus perfiles.'
                    : activeSection === 'aceptados'
                      ? 'Cuando aceptes una postulación, el aprendiz aparecerá aquí y verá el aviso en sus postulaciones.'
                      : activeSection === 'contratados'
                        ? 'Los aprendices vinculados a contrato aparecen aquí separados de los candidatos en proceso.'
                        : 'Las postulaciones que rechaces aparecerán aquí.'}
                </p>
              </section>
            ) : (
              <div role="tabpanel" className="space-y-4">
                {sectionApplications.map((application) => (
              <article key={application.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm text-slate-400">{application.oferta?.titulo || 'Oferta'}</p>
                    <h2 className="mt-1 text-xl font-semibold text-white">{application.estudiante?.nombre || 'Estudiante'}</h2>
                    <p className="mt-1 text-sm text-slate-400">{application.estudiante?.email || ''}</p>
                    <p className="mt-2 text-xs text-slate-500">Postulación recibida {readableDate(application.created_at.slice(0, 10))}</p>
                  </div>
                  <div className="w-full lg:max-w-sm">
                    <p className={`text-sm font-semibold ${application.estado === 'rechazada' ? 'text-rose-300' : application.estado === 'pendiente' ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {stateLabels[application.estado]}
                    </p>
                    {application.estado === 'pendiente' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={updatingId === application.id} onClick={() => void updateApplicationStatus(application, 'aprobada')} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                          {updatingId === application.id ? 'Guardando...' : 'Aceptar candidato'}
                        </button>
                        <button type="button" disabled={updatingId === application.id} onClick={() => void updateApplicationStatus(application, 'rechazada')} className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-wait disabled:opacity-60">
                          Rechazar
                        </button>
                      </div>
                    ) : application.estado === 'aprobada' ? (
                      <div className="mt-3">
                        <p className="text-xs leading-5 text-slate-400">El aprendiz ya ve que continúa en el proceso. Si cumple los requisitos, vincúlalo a contrato.</p>
                        <button type="button" disabled={updatingId === application.id} onClick={() => void updateApplicationStatus(application, 'contratada')} className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                          {updatingId === application.id ? 'Guardando...' : 'Vincular a contrato'}
                        </button>
                        <button type="button" disabled={updatingId === application.id} onClick={() => void updateApplicationStatus(application, 'rechazada')} className="mt-3 rounded-lg border border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-wait disabled:opacity-60 sm:ml-2">
                          {updatingId === application.id ? 'Guardando...' : 'Descartar candidato'}
                        </button>
                      </div>
                    ) : application.estado === 'contratada' ? (
                      <Link href="/mis-practicantes" className="mt-3 inline-flex rounded-lg border border-emerald-400/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10">
                        Ir a seguimiento laboral
                      </Link>
                    ) : null}
                  </div>
                </div>

                {application.estado === 'aprobada' && (
                  <CompanyInterviewScheduler
                    applicationId={application.id}
                    companyId={application.empresa_id}
                    studentId={application.estudiante_id}
                    interview={interviews[application.id] || null}
                    onScheduled={(interview) => setInterviews((current) => ({ ...current, [application.id]: interview }))}
                  />
                )}

                {(application.descripcion_perfil || application.cv_path) && (
                  <div className="mt-5 border-t border-slate-700 pt-4">
                    <h3 className="font-semibold text-white">Perfil del aprendiz</h3>
                    {application.descripcion_perfil && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{application.descripcion_perfil}</p>
                    )}
                    {application.cv_path && (
                      cvUrls[application.id]
                        ? <a href={cvUrls[application.id]} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir hoja de vida →</a>
                        : <p className="mt-3 text-xs text-slate-500">Preparando hoja de vida privada...</p>
                    )}
                  </div>
                )}

              </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
