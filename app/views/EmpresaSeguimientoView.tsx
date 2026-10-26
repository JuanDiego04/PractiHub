'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'

type ApplicationState = 'pendiente' | 'aprobada' | 'contratada' | 'rechazada'

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

interface CompanyEvidence {
  id: string
  postulacion_id: string
  titulo: string
  descripcion: string
  archivo_path: string
  created_at: string
}

type CompanyApplication = PostulacionConPerfil & { evidences: CompanyEvidence[] }

const stateLabels: Record<ApplicationState, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aceptada · pendiente de instructor',
  contratada: 'Contratada',
  rechazada: 'No seleccionada',
}

export default function EmpresaSeguimientoView() {
  const [applications, setApplications] = useState<CompanyApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({})
  const [cvUrls, setCvUrls] = useState<Record<string, string>>({})

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setLoadError('')
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

      const applicationRows = (rows || []) as unknown as Omit<CompanyApplication, 'estudiante' | 'evidences'>[]
      const ids = applicationRows.map((application) => application.id)
      const studentIds = [...new Set(applicationRows.map((application) => application.estudiante_id))]
      const [studentsResult, evidenceResult] = await Promise.all([
        studentIds.length > 0
          ? supabase.from('perfiles').select('id, nombre, email').in('id', studentIds)
          : Promise.resolve({ data: [], error: null }),
        ids.length > 0
          ? supabase.from('evidencias_estudiantes').select('id, postulacion_id, titulo, descripcion, archivo_path, created_at').eq('empresa_id', user.id).eq('tipo', 'empresa').in('postulacion_id', ids).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (studentsResult.error) throw new Error(`No se pudieron cargar los perfiles de estudiantes: ${studentsResult.error.message}`)
      if (evidenceResult.error) throw new Error(`No se pudieron cargar los entregables: ${evidenceResult.error.message}`)

      const students = new Map((studentsResult.data || []).map((student) => [student.id, { nombre: student.nombre, email: student.email }]))
      const evidence = (evidenceResult.data || []) as CompanyEvidence[]
      setApplications(applicationRows.map((application) => ({
        ...application,
        oferta: Array.isArray(application.oferta) ? application.oferta[0] : application.oferta,
        estudiante: students.get(application.estudiante_id) || null,
        evidences: evidence.filter((item) => item.postulacion_id === application.id),
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
      (application): application is CompanyApplication & { cv_path: string } => Boolean(application.cv_path) && !(application.id in cvUrls),
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

  useEffect(() => {
    let cancelled = false
    const pending = applications.flatMap((application) => application.evidences).filter((evidence) => !(evidence.id in evidenceUrls))
    if (pending.length === 0) return

    void Promise.all(pending.map(async (evidence) => {
      const { data, error: urlError } = await supabase.storage
        .from('evidencias_estudiantes')
        .createSignedUrl(evidence.archivo_path, 60 * 60)
      if (urlError) throw new Error(`No se pudo abrir el entregable «${evidence.titulo}»: ${urlError.message}`)
      return [evidence.id, data.signedUrl] as const
    })).then((results) => {
      if (!cancelled) setEvidenceUrls((current) => ({ ...current, ...Object.fromEntries(results) }))
    }).catch((urlError: unknown) => {
      if (!cancelled) setError(urlError instanceof Error ? urlError.message : 'No se pudieron abrir los entregables.')
    })

    return () => { cancelled = true }
  }, [applications, evidenceUrls])

  async function updateApplicationStatus(application: CompanyApplication, status: 'aprobada' | 'rechazada') {
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
        ? `Se aceptó a ${application.estudiante?.nombre || 'el estudiante'}. Un instructor deberá asignar la práctica para habilitar su seguimiento.`
        : `Se rechazó la postulación de ${application.estudiante?.nombre || 'el estudiante'}.`)
    } catch (updateFailure) {
      setError(updateFailure instanceof Error ? updateFailure.message : 'No se pudo actualizar la postulación.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · EMPRESA</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Revisión de postulaciones</h1>
          <p className="mt-2 max-w-2xl text-slate-400">Revisa los perfiles, acepta candidatos y consulta sus postulaciones. El seguimiento inicia cuando un instructor registra la práctica.</p>
        </header>

        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}

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
          <div className="space-y-4">
            {applications.map((application) => (
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
                    ) : null}
                  </div>
                </div>

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

                {application.evidences.length > 0 && (
                  <div className="mt-5 border-t border-slate-700 pt-4">
                    <h3 className="font-semibold text-white">Entregables laborales ({application.evidences.length})</h3>
                    <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {application.evidences.map((evidence) => (
                        <li key={evidence.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h4 className="font-medium text-slate-100">{evidence.titulo}</h4>
                            <span className="text-xs text-slate-500">{readableDate(evidence.created_at.slice(0, 10))}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-400">{evidence.descripcion}</p>
                          {evidenceUrls[evidence.id] && <a href={evidenceUrls[evidence.id]} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir entregable →</a>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
