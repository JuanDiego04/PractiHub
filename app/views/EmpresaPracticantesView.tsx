'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'

interface Practicante {
  id: string
  estudiante_id: string
  estudiante: { nombre: string; email: string } | null
  tutor_id: string | null
  cargo: string
  empresa: string
  estado: 'en_curso' | 'finalizada'
  fecha_inicio: string | null
  fecha_fin: string | null
  postulacion_id: string | null
}

interface PostulacionAceptada {
  id: string
  estudiante_id: string
  estado: 'aprobada' | 'contratada'
  created_at: string
  oferta: { titulo: string } | null
  estudiante: { nombre: string; email: string } | null
}

export interface Entregable {
  id: string
  tutor_estudiante_id: string
  postulacion_id: string | null
  empresa_id: string
  titulo: string
  descripcion: string
  enlace_adjunto: string | null
  estado: 'pendiente' | 'completado'
  created_at: string
  completed_at: string | null
}

export interface Novedad {
  id: string
  tutor_estudiante_id: string
  estudiante_id: string
  empresa_id: string
  tipo: 'retraso' | 'ausencia_salud' | 'permiso_personal'
  justificacion: string
  estado: 'enviado' | 'leido'
  created_at: string
}

interface CompanySubmission {
  id: string
  tutor_estudiante_id: string
  titulo: string
  descripcion: string
  archivoUrl: string
  created_at: string
}

type PracticeTab = 'entregables' | 'novedades'

const noveltyLabels: Record<Novedad['tipo'], string> = {
  retraso: 'Retraso',
  ausencia_salud: 'Ausencia por salud',
  permiso_personal: 'Permiso personal',
}

export default function EmpresaPracticantesView() {
  const [practitioners, setPractitioners] = useState<Practicante[]>([])
  const [acceptedApplications, setAcceptedApplications] = useState<PostulacionAceptada[]>([])
  const [deliverables, setDeliverables] = useState<Entregable[]>([])
  const [studentSubmissions, setStudentSubmissions] = useState<CompanySubmission[]>([])
  const [novelties, setNovelties] = useState<Novedad[]>([])
  const [selectedPracticeId, setSelectedPracticeId] = useState('')
  const [activeTab, setActiveTab] = useState<PracticeTab>('entregables')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState('')
  const [practiceStartDate, setPracticeStartDate] = useState('')
  const [practiceEndDate, setPracticeEndDate] = useState('')
  const [immediateSupervisor, setImmediateSupervisor] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selectedPractice = useMemo(
    () => practitioners.find((practice) => practice.id === selectedPracticeId) || practitioners[0] || null,
    [practitioners, selectedPracticeId],
  )
  const practiceDeliverables = useMemo(
    () => deliverables.filter((item) => item.tutor_estudiante_id === selectedPractice?.id),
    [deliverables, selectedPractice?.id],
  )
  const practiceNovelties = useMemo(
    () => novelties.filter((item) => item.tutor_estudiante_id === selectedPractice?.id),
    [novelties, selectedPractice?.id],
  )

  const loadPractitioners = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión con tu cuenta de empresa para gestionar practicantes.')

      const { data: profile, error: profileError } = await supabase.from('perfiles').select('rol, nombre_empresa').eq('id', user.id).maybeSingle()
      if (profileError) throw new Error(`No se pudo verificar tu perfil: ${profileError.message}`)
      if (profile?.rol !== 'empresa') throw new Error('Esta sección está disponible para cuentas de empresa.')
      setCompanyName(profile.nombre_empresa || '')

      const [assignmentsResult, applicationsResult] = await Promise.all([
        supabase
          .from('tutor_estudiantes')
          .select('id, estudiante_id, tutor_id, cargo, empresa, estado, fecha_inicio, fecha_fin, postulacion_id')
          .eq('empresa_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('postulaciones')
          .select('id, estudiante_id, estado, created_at, oferta:ofertas(titulo)')
          .eq('empresa_id', user.id)
          .in('estado', ['aprobada', 'contratada'])
          .order('created_at', { ascending: false }),
      ])
      const assignments = assignmentsResult.data
      const applications = applicationsResult.data
      if (assignmentsResult.error) throw new Error(`No se pudieron cargar tus practicantes: ${assignmentsResult.error.message}`)
      if (applicationsResult.error) throw new Error(`No se pudieron cargar los candidatos aceptados: ${applicationsResult.error.message}`)

      const rows = assignments || []
      const assignmentIds = rows.map((item) => item.id)
      const studentIds = [...new Set([
        ...rows.map((item) => item.estudiante_id),
        ...(applications || []).map((item) => item.estudiante_id),
      ])]
      const [studentsResult, deliverablesResult, noveltiesResult, evidenceResult] = await Promise.all([
        studentIds.length
          ? supabase.from('perfiles').select('id, nombre, email').in('id', studentIds)
          : Promise.resolve({ data: [], error: null }),
        assignmentIds.length
          ? supabase.from('entregables_empresa').select('id, tutor_estudiante_id, postulacion_id, empresa_id, titulo, descripcion, enlace_adjunto, estado, created_at, completed_at').eq('empresa_id', user.id).in('tutor_estudiante_id', assignmentIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        assignmentIds.length
          ? supabase.from('novedades_practica').select('id, tutor_estudiante_id, estudiante_id, empresa_id, tipo, justificacion, estado, created_at').eq('empresa_id', user.id).in('tutor_estudiante_id', assignmentIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        assignmentIds.length
          ? supabase.from('evidencias_estudiantes').select('id, tutor_estudiante_id, titulo, descripcion, archivo_path, created_at').eq('empresa_id', user.id).eq('tipo', 'empresa').in('tutor_estudiante_id', assignmentIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (studentsResult.error) throw new Error(`No se pudieron cargar los perfiles de los practicantes: ${studentsResult.error.message}`)
      if (deliverablesResult.error) throw new Error(`No se pudieron cargar los entregables: ${deliverablesResult.error.message}`)
      if (noveltiesResult.error) throw new Error(`No se pudieron cargar las novedades: ${noveltiesResult.error.message}`)
      if (evidenceResult.error) throw new Error(`No se pudieron cargar los archivos enviados por los aprendices: ${evidenceResult.error.message}`)

      const students = new Map((studentsResult.data || []).map((student) => [student.id, { nombre: student.nombre, email: student.email }]))
      const submissions = await Promise.all((evidenceResult.data || []).map(async (evidence) => {
        const { data: signedFile, error: signedUrlError } = await supabase.storage
          .from('evidencias_estudiantes')
          .createSignedUrl(evidence.archivo_path, 60 * 60)
        if (signedUrlError) throw new Error(`No se pudo abrir el archivo «${evidence.titulo}»: ${signedUrlError.message}`)
        return {
          id: evidence.id,
          tutor_estudiante_id: evidence.tutor_estudiante_id,
          titulo: evidence.titulo,
          descripcion: evidence.descripcion,
          archivoUrl: signedFile.signedUrl,
          created_at: evidence.created_at,
        }
      }))
      setPractitioners(rows.map((row) => ({ ...row, estudiante: students.get(row.estudiante_id) || null })) as Practicante[])
      setStudentSubmissions(submissions)
      const registeredApplicationIds = new Set(rows.flatMap((row) => row.postulacion_id ? [row.postulacion_id] : []))
      const unregisteredApplications = (applications || [])
        .filter((application) => !registeredApplicationIds.has(application.id))
        .map((application) => ({
          ...application,
          oferta: Array.isArray(application.oferta) ? application.oferta[0] || null : application.oferta,
          estudiante: students.get(application.estudiante_id) || null,
        })) as PostulacionAceptada[]
      setAcceptedApplications(unregisteredApplications)
      setSelectedApplicationId((current) => unregisteredApplications.some((application) => application.id === current)
        ? current
        : unregisteredApplications[0]?.id || '')
      setDeliverables((deliverablesResult.data || []) as Entregable[])
      setNovelties((noveltiesResult.data || []) as Novedad[])
      setSelectedPracticeId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '')
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudieron cargar los practicantes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // State updates happen after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPractitioners()
  }, [loadPractitioners])

  async function registerPractitioner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyName.trim()) {
      setError('Registra primero el nombre de la empresa desde Mi perfil.')
      return
    }
    if (!selectedApplicationId) {
      setError('Selecciona un candidato aceptado para registrar su práctica.')
      return
    }

    setRegistering(true)
    setMessage('')
    setError('')
    try {
      const { data, error: registerError } = await supabase.rpc('company_register_practitioner', {
        p_postulacion_id: selectedApplicationId,
        p_fecha_inicio: practiceStartDate || null,
        p_fecha_fin: practiceEndDate || null,
        p_jefe_inmediato: immediateSupervisor.trim() || null,
      })
      if (registerError) throw new Error(`No se pudo registrar la práctica: ${registerError.message}`)

      const registered = data?.[0]
      if (!registered) throw new Error('La práctica se registró, pero no se recibieron los datos del aprendiz.')
      setMessage(`${registered.nombre} quedó registrado en el seguimiento laboral. El instructor podrá vincularse después desde su módulo.`)
      setPracticeStartDate('')
      setPracticeEndDate('')
      setImmediateSupervisor('')
      await loadPractitioners()
    } catch (registerFailure) {
      setError(registerFailure instanceof Error ? registerFailure.message : 'No se pudo registrar la práctica.')
    } finally {
      setRegistering(false)
    }
  }

  async function createDeliverable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPractice || selectedPractice.estado !== 'en_curso') return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión nuevamente para asignar una tarea.')

      const { data, error: insertError } = await supabase
        .from('entregables_empresa')
        .insert({
          tutor_estudiante_id: selectedPractice.id,
          postulacion_id: selectedPractice.postulacion_id,
          empresa_id: user.id,
          titulo: title.trim(),
          descripcion: description.trim(),
        })
        .select('id, tutor_estudiante_id, postulacion_id, empresa_id, titulo, descripcion, enlace_adjunto, estado, created_at, completed_at')
        .single()
      if (insertError) throw new Error(`No se pudo asignar la tarea: ${insertError.message}`)
      setDeliverables((current) => [data as Entregable, ...current])
      setTitle('')
      setDescription('')
      setMessage(`Tarea asignada a ${selectedPractice.estudiante?.nombre || 'el practicante'}.`)
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'No se pudo asignar la tarea.')
    } finally {
      setSaving(false)
    }
  }

  async function markNoveltyRead(novelty: Novedad) {
    setMarkingId(novelty.id)
    setMessage('')
    setError('')
    try {
      const { data, error: updateError } = await supabase
        .from('novedades_practica')
        .update({ estado: 'leido' })
        .eq('id', novelty.id)
        .eq('empresa_id', novelty.empresa_id)
        .eq('estado', 'enviado')
        .select('id')
      if (updateError) throw new Error(`No se pudo marcar la novedad como leída: ${updateError.message}`)
      if (!data?.length) throw new Error('La novedad ya se había leído o no pertenece a tu empresa.')
      setNovelties((current) => current.map((item) => item.id === novelty.id ? { ...item, estado: 'leido' } : item))
      setMessage('Novedad marcada como leída.')
    } catch (updateFailure) {
      setError(updateFailure instanceof Error ? updateFailure.message : 'No se pudo actualizar la novedad.')
    } finally {
      setMarkingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · EMPRESA</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Mis practicantes</h1>
          <p className="mt-2 max-w-2xl text-slate-400">Asigna entregables y consulta las novedades reportadas por tus practicantes.</p>
        </header>

        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}

        <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Registrar aprendiz aceptado</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">Completa los datos de la práctica para habilitar el envío de tareas, archivos y novedades entre la empresa y el aprendiz. El instructor podrá vincularse después desde su módulo.</p>
          {!companyName.trim() && (
            <p role="alert" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Para registrar practicantes, primero <Link href="/perfil" className="font-semibold underline">registra el nombre de tu empresa en Mi perfil</Link>.
            </p>
          )}
          {loading ? (
            <p className="mt-4 text-sm text-slate-400">Buscando candidatos aceptados...</p>
          ) : acceptedApplications.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">No hay candidatos aceptados pendientes de registrar. Primero acepta una postulación y luego podrás activar su seguimiento laboral aquí.</p>
          ) : (
            <form onSubmit={(event) => void registerPractitioner(event)} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-300 md:col-span-2">Candidato y vacante
                <select required value={selectedApplicationId} onChange={(event) => setSelectedApplicationId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400">
                  {acceptedApplications.map((application) => (
                    <option key={application.id} value={application.id}>{application.estudiante?.nombre || 'Aprendiz'} · {application.oferta?.titulo || 'Vacante'} · {application.estudiante?.email || ''}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-300">Fecha de inicio
                <input type="date" value={practiceStartDate} onChange={(event) => setPracticeStartDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <label className="block text-sm font-medium text-slate-300">Fecha de finalización
                <input type="date" min={practiceStartDate || undefined} value={practiceEndDate} onChange={(event) => setPracticeEndDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <label className="block text-sm font-medium text-slate-300">Jefe inmediato o supervisor
                <input maxLength={150} value={immediateSupervisor} onChange={(event) => setImmediateSupervisor(event.target.value)} placeholder="Nombre del supervisor en la empresa" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <div className="flex items-end">
                <button type="submit" disabled={registering || !companyName.trim()} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                  {registering ? 'Registrando práctica...' : 'Registrar para seguimiento'}
                </button>
              </div>
            </form>
          )}
        </section>

        {loading ? (
          <p className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Cargando practicantes...</p>
        ) : loadError ? (
          <section role="alert" className="rounded-2xl border border-rose-500/30 bg-slate-800 p-8 text-center">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button type="button" onClick={() => void loadPractitioners()} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
          </section>
        ) : practitioners.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-12 text-center">
            <h2 className="text-xl font-semibold text-white">Aún no tienes practicantes asignados</h2>
            <p className="mt-2 text-sm text-slate-400">Registra como aprendiz a uno de tus candidatos aceptados. La vinculación con un instructor se puede hacer después.</p>
          </section>
        ) : (
          <>
            <label className="mb-6 block max-w-xl text-sm font-medium text-slate-300">
              Practicante
              <select value={selectedPractice?.id || ''} onChange={(event) => setSelectedPracticeId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-emerald-400">
                {practitioners.map((practice) => <option key={practice.id} value={practice.id}>{practice.estudiante?.nombre || 'Estudiante'} · {practice.cargo}</option>)}
              </select>
            </label>

            {selectedPractice && (
              <section className="mb-6 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">PRACTICANTE</p>
                    <h2 className="mt-1 text-xl font-bold text-white">{selectedPractice.estudiante?.nombre || 'Estudiante'}</h2>
                    <p className="mt-1 text-sm text-slate-400">{selectedPractice.estudiante?.email} · {selectedPractice.cargo}</p>
                    {selectedPractice.fecha_inicio && <p className="mt-2 text-xs text-slate-500">Inicio: {readableDate(selectedPractice.fecha_inicio)}</p>}
                    {selectedPractice.fecha_fin && <p className="mt-1 text-xs text-slate-500">Finalización: {readableDate(selectedPractice.fecha_fin)}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedPractice.estado === 'en_curso' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{selectedPractice.estado === 'en_curso' ? 'En curso' : 'Finalizada'}</span>
                    {!selectedPractice.tutor_id && <span className="text-right text-xs text-amber-300">Pendiente de vincular con instructor</span>}
                  </div>
                </div>
              </section>
            )}

            <div role="tablist" aria-label="Gestión del practicante" className="mb-5 flex gap-2 border-b border-slate-700 pb-3">
              <button type="button" role="tab" aria-selected={activeTab === 'entregables'} onClick={() => setActiveTab('entregables')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${activeTab === 'entregables' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Entregables</button>
              <button type="button" role="tab" aria-selected={activeTab === 'novedades'} onClick={() => setActiveTab('novedades')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${activeTab === 'novedades' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Novedades ({novelties.filter((item) => item.estado === 'enviado').length})</button>
            </div>

            {activeTab === 'entregables' ? (
              <section role="tabpanel" className="space-y-5">
                {selectedPractice?.estado === 'en_curso' && (
                  <form onSubmit={(event) => void createDeliverable(event)} className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                    <h2 className="text-lg font-semibold text-white">Asignar tarea o hito</h2>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-300">Título
                        <input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                      </label>
                      <label className="block text-sm font-medium text-slate-300">Descripción
                        <textarea required minLength={5} maxLength={3000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                      </label>
                    </div>
                    <button type="submit" disabled={saving} className="mt-4 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">{saving ? 'Asignando...' : 'Asignar entregable'}</button>
                  </form>
                )}
                <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                  <h2 className="text-lg font-semibold text-white">Entregables asignados</h2>
                  {practiceDeliverables.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">Aún no has asignado tareas a este practicante.</p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {practiceDeliverables.map((item) => (
                        <li key={item.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-white">{item.titulo}</h3>
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">{item.descripcion}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.estado === 'completado' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{item.estado === 'completado' ? 'Completado' : 'Pendiente'}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-3 text-xs text-slate-500">
                            <span>Asignado {readableDate(item.created_at.slice(0, 10))}</span>
                            {item.completed_at && <span>Completado {readableDate(item.completed_at.slice(0, 10))}</span>}
                          </div>
                          {item.enlace_adjunto && <a href={item.enlace_adjunto} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir evidencia del estudiante →</a>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                  <h2 className="text-lg font-semibold text-white">Archivos enviados por el aprendiz</h2>
                  {studentSubmissions.filter((item) => item.tutor_estudiante_id === selectedPractice?.id).length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">El aprendiz aún no ha enviado archivos a la empresa.</p>
                  ) : (
                    <ul className="mt-4 grid gap-3 md:grid-cols-2">
                      {studentSubmissions.filter((item) => item.tutor_estudiante_id === selectedPractice?.id).map((submission) => (
                        <li key={submission.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3 className="font-semibold text-white">{submission.titulo}</h3>
                            <span className="text-xs text-slate-500">{readableDate(submission.created_at.slice(0, 10))}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-400">{submission.descripcion}</p>
                          <a href={submission.archivoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir archivo →</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </section>
            ) : (
              <section role="tabpanel" className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-white">Bandeja de novedades</h2>
                {practiceNovelties.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">No hay novedades reportadas por este practicante.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {practiceNovelties.map((novelty) => (
                      <li key={novelty.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-white">{noveltyLabels[novelty.tipo]}</h3>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{novelty.justificacion}</p>
                            <p className="mt-2 text-xs text-slate-500">Recibida {readableDate(novelty.created_at.slice(0, 10))}</p>
                          </div>
                          {novelty.estado === 'enviado' ? (
                            <button type="button" disabled={markingId === novelty.id} onClick={() => void markNoveltyRead(novelty)} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-60">{markingId === novelty.id ? 'Guardando...' : 'Marcar como leído'}</button>
                          ) : <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">Leída</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
