'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { readableDate, statusLabel, type Evaluacion, type EstudianteAsignado } from '@/lib/tutorSeguimiento'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
])

type EvidenceKind = 'academica' | 'empresa'
type FollowupTab = 'academica' | 'empresa'
type NoveltyType = 'retraso' | 'ausencia_salud' | 'permiso_personal'
type NoveltyStatus = 'enviado' | 'leido'

interface Entregable {
  id: string
  tutor_estudiante_id: string
  titulo: string
  descripcion: string
  enlace_adjunto: string | null
  estado: 'pendiente' | 'completado'
  created_at: string
  completed_at: string | null
}

interface Novedad {
  id: string
  tutor_estudiante_id: string
  tipo: NoveltyType
  justificacion: string
  estado: NoveltyStatus
  created_at: string
}

interface FeedbackEmpresa {
  id: string
  tutor_estudiante_id: string
  comentario: string
  created_at: string
}

const noveltyTypeLabels: Record<NoveltyType, string> = {
  retraso: 'Retraso',
  ausencia_salud: 'Ausencia por salud',
  permiso_personal: 'Permiso personal',
}

interface TutorAssignment extends Omit<EstudianteAsignado, 'tutor_id'> {
  tutor_id: string | null
  empresa_id: string | null
  jefe_inmediato: string | null
  postulacion_id: string | null
}

interface ActivePractice {
  id: string
  assignment: TutorAssignment
  empresa: { nombre: string } | null
  tutor: { nombre: string } | null
}

interface StudentEvidence {
  id: string
  tutor_estudiante_id: string
  tipo: EvidenceKind
  titulo: string
  descripcion: string
  archivo_path: string
  created_at: string
}

function schemaSetupMessage(message: string, code?: string) {
  if (['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'].includes(code || '')) {
    return `Falta aplicar la migración de seguimiento académico. Ejecuta supabase/student_followup.sql después de tutor_module.sql en Supabase. Detalle: ${message}`
  }
  return message
}

function Message({ children, error = false }: { children: string; error?: boolean }) {
  return (
    <p role={error ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
      {children}
    </p>
  )
}

export default function MiPracticaView() {
  const [practices, setPractices] = useState<ActivePractice[]>([])
  const [evaluations, setEvaluations] = useState<Evaluacion[]>([])
  const [evidences, setEvidences] = useState<StudentEvidence[]>([])
  const [selectedPracticeId, setSelectedPracticeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState<EvidenceKind | null>(null)
  const [academicTitle, setAcademicTitle] = useState('')
  const [academicDescription, setAcademicDescription] = useState('')
  const [academicFile, setAcademicFile] = useState<File | null>(null)
  const [companyTitle, setCompanyTitle] = useState('')
  const [companyDescription, setCompanyDescription] = useState('')
  const [companyFile, setCompanyFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({})
  const [activeTab, setActiveTab] = useState<FollowupTab>('academica')
  const [entregables, setEntregables] = useState<Entregable[]>([])
  const [novedades, setNovedades] = useState<Novedad[]>([])
  const [feedbackEmpresa, setFeedbackEmpresa] = useState<FeedbackEmpresa[]>([])
  const [laborLoading, setLaborLoading] = useState(false)
  const [laborError, setLaborError] = useState('')
  const [completingTask, setCompletingTask] = useState<Entregable | null>(null)
  const [taskEvidenceLink, setTaskEvidenceLink] = useState('')
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [noveltyType, setNoveltyType] = useState<NoveltyType>('retraso')
  const [noveltyJustification, setNoveltyJustification] = useState('')
  const [sendingNovelty, setSendingNovelty] = useState(false)
  const [certificateRequested, setCertificateRequested] = useState(false)

  const selectedPractice = useMemo(
    () => practices.find((practice) => practice.id === selectedPracticeId) || practices[0] || null,
    [practices, selectedPracticeId],
  )
  const selectedEvidence = useMemo(
    () => evidences.filter((evidence) => evidence.tutor_estudiante_id === selectedPractice?.id),
    [evidences, selectedPractice?.id],
  )
  const selectedTabEvidence = useMemo(
    () => selectedEvidence.filter((evidence) => evidence.tipo === activeTab),
    [activeTab, selectedEvidence],
  )
  const selectedEvaluations = useMemo(
    () => evaluations.filter((evaluation) => evaluation.estudiante_asignado_id === selectedPractice?.id),
    [evaluations, selectedPractice?.id],
  )
  const selectedTasks = useMemo(
    () => entregables.filter((task) => task.tutor_estudiante_id === selectedPractice?.id),
    [entregables, selectedPractice?.id],
  )
  const selectedNovelties = useMemo(
    () => novedades.filter((novelty) => novelty.tutor_estudiante_id === selectedPractice?.id),
    [novedades, selectedPractice?.id],
  )
  const selectedCompanyFeedback = useMemo(
    () => feedbackEmpresa.filter((feedback) => feedback.tutor_estudiante_id === selectedPractice?.id),
    [feedbackEmpresa, selectedPractice?.id],
  )

  const loadPractice = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión con tu cuenta de estudiante para consultar tu práctica.')

      const { data: profile, error: profileError } = await supabase.from('perfiles').select('rol').eq('id', user.id).maybeSingle()
      if (profileError) throw new Error(`No se pudo verificar tu perfil: ${profileError.message}`)
      if (profile?.rol !== 'estudiante') throw new Error('Esta sección está disponible para cuentas de estudiante.')

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('tutor_estudiantes')
        .select('id, tutor_id, estudiante_id, empresa, cargo, fecha_inicio, fecha_fin, estado, created_at, empresa_id, jefe_inmediato, postulacion_id')
        .eq('estudiante_id', user.id)
        .order('created_at', { ascending: false })
      if (assignmentError) {
        throw new Error(schemaSetupMessage(`No se pudo cargar la asignación del instructor: ${assignmentError.message}`, assignmentError.code))
      }

      const assignments = (assignmentRows || []) as TutorAssignment[]
      if (assignments.length === 0) {
        setPractices([])
        setEvaluations([])
        setEvidences([])
        setEntregables([])
        setNovedades([])
        setFeedbackEmpresa([])
        setSelectedPracticeId('')
        return
      }

      const assignmentIds = assignments.map((assignment) => assignment.id)
      const tutorIds = [...new Set(assignments.flatMap((assignment) => assignment.tutor_id ? [assignment.tutor_id] : []))]
      const companyIds = [...new Set(assignments.flatMap((assignment) => assignment.empresa_id ? [assignment.empresa_id] : []))]
      const [tutorsResult, companiesResult, evaluationsResult, evidenceResult] = await Promise.all([
        tutorIds.length
          ? supabase.from('perfiles').select('id, nombre').in('id', tutorIds)
          : Promise.resolve({ data: [], error: null }),
        companyIds.length
          ? supabase.from('perfiles').select('id, nombre').in('id', companyIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('tutor_evaluaciones')
          .select('id, estudiante_asignado_id, calificacion, retroalimentacion, resultado, evidencia_path, created_at')
          .in('estudiante_asignado_id', assignmentIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('evidencias_estudiantes')
          .select('id, tutor_estudiante_id, tipo, titulo, descripcion, archivo_path, created_at')
          .in('tutor_estudiante_id', assignmentIds)
          .order('created_at', { ascending: false }),
      ])
      if (tutorsResult.error) throw new Error(`No se pudieron cargar los instructores: ${tutorsResult.error.message}`)
      if (companiesResult.error) throw new Error(`No se pudieron cargar las empresas: ${companiesResult.error.message}`)
      if (evaluationsResult.error) throw new Error(schemaSetupMessage(`No se pudieron cargar las evaluaciones: ${evaluationsResult.error.message}`, evaluationsResult.error.code))
      if (evidenceResult.error) throw new Error(schemaSetupMessage(`No se pudo cargar el historial de entregas: ${evidenceResult.error.message}`, evidenceResult.error.code))

      const tutors = new Map((tutorsResult.data || []).map((profile) => [profile.id, { nombre: profile.nombre }]))
      const companies = new Map((companiesResult.data || []).map((profile) => [profile.id, { nombre: profile.nombre }]))
      const mappedPractices = assignments.map((assignment) => ({
        id: assignment.id,
        assignment,
        empresa: assignment.empresa_id ? companies.get(assignment.empresa_id) || null : null,
        tutor: assignment.tutor_id ? tutors.get(assignment.tutor_id) || null : null,
      }))

      setPractices(mappedPractices)
      setSelectedPracticeId((current) => mappedPractices.some((practice) => practice.id === current) ? current : mappedPractices[0]?.id || '')
      setEvaluations((evaluationsResult.data || []) as Evaluacion[])
      setEvidences((evidenceResult.data || []) as StudentEvidence[])
      setSignedUrls({})
      const companyAssignmentIds = assignments.filter((assignment) => assignment.empresa_id).map((assignment) => assignment.id)
      if (companyAssignmentIds.length) {
        setLaborLoading(true)
        setLaborError('')
        const [tasksResult, noveltiesResult, feedbackResult] = await Promise.all([
          supabase
            .from('entregables_empresa')
            .select('id, tutor_estudiante_id, titulo, descripcion, enlace_adjunto, estado, created_at, completed_at')
            .in('tutor_estudiante_id', companyAssignmentIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('novedades_practica')
            .select('id, tutor_estudiante_id, tipo, justificacion, estado, created_at')
            .in('tutor_estudiante_id', companyAssignmentIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('feedback_empresa')
            .select('id, tutor_estudiante_id, comentario, created_at')
            .in('tutor_estudiante_id', companyAssignmentIds)
            .order('created_at', { ascending: false }),
        ])
        const laborErrors = [tasksResult.error, noveltiesResult.error, feedbackResult.error].filter((queryError) => queryError !== null)
        if (laborErrors.length) {
          const missingTables = laborErrors.some((queryError) => (
            queryError?.code === 'PGRST205'
            || /could not find the table .* in the schema cache/i.test(queryError?.message || '')
          ))
          setLaborError(missingTables
            ? `Supabase no encuentra las tablas de gestión laboral. Ejecuta completo supabase/student_followup.sql en el proyecto configurado en NEXT_PUBLIC_SUPABASE_URL. Confirma que las tablas entregables_empresa, novedades_practica y feedback_empresa aparezcan al final del resultado. Si ya existen, ejecuta NOTIFY pgrst, 'reload schema'; en el SQL Editor y vuelve a cargar la página. Detalle: ${laborErrors.map((queryError) => queryError?.message).join('; ')}`
            : `No se pudo cargar toda la gestión laboral. Verifica que la práctica esté vinculada a la empresa correspondiente. Detalle: ${laborErrors.map((queryError) => queryError?.message).join('; ')}`)
        } else {
          setEntregables((tasksResult.data || []) as Entregable[])
          setNovedades((noveltiesResult.data || []) as Novedad[])
          setFeedbackEmpresa((feedbackResult.data || []) as FeedbackEmpresa[])
        }
        setLaborLoading(false)
      } else {
        setEntregables([])
        setNovedades([])
        setFeedbackEmpresa([])
        setLaborError('')
      }
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudo cargar la información de tu práctica.')
    } finally {
      setLoading(false)
      setLaborLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading updates component state after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPractice()
  }, [loadPractice])

  useEffect(() => {
    let cancelled = false
    const missingUrls = selectedEvidence.filter((evidence) => !(evidence.id in signedUrls))
    if (missingUrls.length === 0) return

    void Promise.all(missingUrls.map(async (evidence) => {
      const { data, error: urlError } = await supabase.storage
        .from('evidencias_estudiantes')
        .createSignedUrl(evidence.archivo_path, 60 * 60)
      if (urlError) throw new Error(`No se pudo abrir la bitácora «${evidence.titulo}»: ${urlError.message}`)
      return [evidence.id, data.signedUrl] as const
    })).then((results) => {
      if (!cancelled) setSignedUrls((current) => ({ ...current, ...Object.fromEntries(results) }))
    }).catch((urlError: unknown) => {
      if (!cancelled) setError(urlError instanceof Error ? urlError.message : 'No se pudieron abrir los archivos.')
    })

    return () => { cancelled = true }
  }, [selectedEvidence, signedUrls])

  useEffect(() => {
    let cancelled = false
    const pendingEvaluations = selectedEvaluations.filter((evaluation) => evaluation.evidencia_path && !(evaluation.id in signedUrls))
    if (pendingEvaluations.length === 0) return

    void Promise.all(pendingEvaluations.map(async (evaluation) => {
      const { data, error: urlError } = await supabase.storage
        .from('evidencias_evaluaciones')
        .createSignedUrl(evaluation.evidencia_path as string, 60 * 60)
      if (urlError) {
        throw new Error(`No se pudo abrir el archivo adjunto de la evaluación del ${readableDate(evaluation.created_at.slice(0, 10))}. Ejecuta de nuevo supabase/student_followup.sql para habilitar la lectura de archivos por el estudiante. Si el error persiste, el objeto ya no existe en Storage y el instructor debe editar la evaluación para adjuntarlo otra vez. Detalle: ${urlError.message}`)
      }
      return [evaluation.id, data.signedUrl] as const
    })).then((results) => {
      if (!cancelled) setSignedUrls((current) => ({ ...current, ...Object.fromEntries(results) }))
    }).catch((urlError: unknown) => {
      if (!cancelled) setError(urlError instanceof Error ? urlError.message : 'No se pudieron abrir los archivos del instructor.')
    })

    return () => { cancelled = true }
  }, [selectedEvaluations, signedUrls])

  async function submitEvidence(event: FormEvent<HTMLFormElement>, kind: EvidenceKind) {
    event.preventDefault()
    if (!selectedPractice) return
    const { assignment } = selectedPractice
    const title = kind === 'academica' ? academicTitle : companyTitle
    const description = kind === 'academica' ? academicDescription : companyDescription
    const file = kind === 'academica' ? academicFile : companyFile
    if (!file) {
      setError('Selecciona un archivo antes de enviar.')
      return
    }
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      setError('Formato no permitido. Adjunta PDF, Word, JPG, PNG o WEBP.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('El archivo supera el límite de 10 MB.')
      return
    }
    if (kind === 'empresa' && !assignment.empresa_id) {
      setError('La empresa aún no tiene un perfil vinculado a esta práctica.')
      return
    }

    setSubmitting(kind)
    setError('')
    setMessage('')
    let uploadedPath: string | null = null
    let fileUploaded = false
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión nuevamente para enviar el archivo.')

      const safeName = file.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
      uploadedPath = `${user.id}/${assignment.id}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('evidencias_estudiantes').upload(uploadedPath, file, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadError) throw new Error(`No se pudo subir el archivo: ${uploadError.message}`)
      fileUploaded = true

      const { data, error: insertError } = await supabase
        .from('evidencias_estudiantes')
        .insert({
          postulacion_id: assignment.postulacion_id,
          tutor_estudiante_id: assignment.id,
          estudiante_id: user.id,
          empresa_id: assignment.empresa_id,
          tutor_id: assignment.tutor_id,
          tipo: kind,
          titulo: title.trim(),
          descripcion: description.trim(),
          archivo_path: uploadedPath,
          mime_type: file.type,
          tamanio_bytes: file.size,
        })
        .select('id, tutor_estudiante_id, tipo, titulo, descripcion, archivo_path, created_at')
        .single()
      if (insertError) throw new Error(`El archivo se subió, pero no se pudo guardar el registro: ${insertError.message}`)

      setEvidences((current) => [data as StudentEvidence, ...current])
      if (kind === 'academica') {
        setAcademicTitle('')
        setAcademicDescription('')
        setAcademicFile(null)
      } else {
        setCompanyTitle('')
        setCompanyDescription('')
        setCompanyFile(null)
      }
      setMessage(kind === 'academica' ? 'Bitácora enviada al instructor correctamente.' : 'Entregable enviado a la empresa correctamente.')
    } catch (submitFailure) {
      if (uploadedPath && fileUploaded) {
        const { error: cleanupError } = await supabase.storage.from('evidencias_estudiantes').remove([uploadedPath])
        if (cleanupError) {
          setError(`${submitFailure instanceof Error ? submitFailure.message : 'No se pudo enviar el archivo.'} Además, no se pudo retirar el archivo temporal: ${cleanupError.message}`)
          return
        }
      }
      setError(submitFailure instanceof Error ? submitFailure.message : 'No se pudo enviar el archivo.')
    } finally {
      setSubmitting(null)
    }
  }

  async function completeTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!completingTask) return
    const link = taskEvidenceLink.trim()
    let parsedLink: URL
    try {
      parsedLink = new URL(link)
    } catch {
      setError('Ingresa un enlace válido como GitHub, Figma o Drive.')
      return
    }
    if (!['http:', 'https:'].includes(parsedLink.protocol)) {
      setError('El enlace debe comenzar con http:// o https://.')
      return
    }

    setSavingTaskId(completingTask.id)
    setError('')
    setMessage('')
    try {
      const completedAt = new Date().toISOString()
      const { data, error: updateError } = await supabase
        .from('entregables_empresa')
        .update({ estado: 'completado', enlace_adjunto: parsedLink.toString(), completed_at: completedAt })
        .eq('id', completingTask.id)
        .eq('tutor_estudiante_id', completingTask.tutor_estudiante_id)
        .eq('estado', 'pendiente')
        .select('id')
      if (updateError) throw new Error(`No se pudo completar el entregable: ${updateError.message}`)
      if (!data?.length) throw new Error('La tarea ya no está pendiente o no pertenece a esta práctica. Recarga e inténtalo nuevamente.')
      setEntregables((current) => current.map((task) => task.id === completingTask.id
        ? { ...task, estado: 'completado', enlace_adjunto: parsedLink.toString(), completed_at: completedAt }
        : task))
      setCompletingTask(null)
      setTaskEvidenceLink('')
      setMessage('Entregable marcado como completado y enviado a la empresa.')
    } catch (submitFailure) {
      setError(submitFailure instanceof Error ? submitFailure.message : 'No se pudo completar el entregable.')
    } finally {
      setSavingTaskId(null)
    }
  }

  async function submitNovelty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPractice || !selectedPractice.assignment.empresa_id) {
      setError('La práctica todavía no tiene una empresa vinculada.')
      return
    }
    const justification = noveltyJustification.trim()
    if (justification.length < 5) {
      setError('Escribe una justificación de al menos 5 caracteres.')
      return
    }

    setSendingNovelty(true)
    setError('')
    setMessage('')
    try {
      const { data, error: insertError } = await supabase
        .from('novedades_practica')
        .insert({
          tutor_estudiante_id: selectedPractice.id,
          postulacion_id: selectedPractice.assignment.postulacion_id,
          estudiante_id: selectedPractice.assignment.estudiante_id,
          empresa_id: selectedPractice.assignment.empresa_id,
          tipo: noveltyType,
          justificacion: justification,
          estado: 'enviado',
        })
        .select('id, tutor_estudiante_id, tipo, justificacion, estado, created_at')
        .single()
      if (insertError) throw new Error(`No se pudo reportar la novedad: ${insertError.message}`)
      setNovedades((current) => [data as Novedad, ...current])
      setNoveltyJustification('')
      setMessage('Novedad reportada a la empresa.')
    } catch (submitFailure) {
      setError(submitFailure instanceof Error ? submitFailure.message : 'No se pudo reportar la novedad.')
    } finally {
      setSendingNovelty(false)
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-900 px-4 py-12 text-center text-slate-400">Cargando tu práctica...</main>
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-slate-900 px-4 py-12 text-slate-100">
        <section role="alert" className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-slate-800 p-6 text-center">
          <p className="text-sm text-rose-200">{loadError}</p>
          <button type="button" onClick={() => void loadPractice()} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
        </section>
      </main>
    )
  }

  if (practices.length === 0) {
    return (
      <main className="min-h-screen bg-slate-900 px-4 py-12 text-slate-100">
        <section className="mx-auto max-w-2xl rounded-2xl border border-dashed border-slate-700 bg-slate-800/70 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · MI PRÁCTICA</p>
          <h1 className="mt-3 text-2xl font-bold text-white">Aún no tienes una práctica activa</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">El seguimiento se habilitará cuando tu instructor registre tu práctica.</p>
          <Link href="/perfil" className="mt-6 inline-flex rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700">Ir a mi perfil</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · MI PRÁCTICA</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Seguimiento de práctica</h1>
          <p className="mt-2 text-slate-400">Tu instructor registró esta práctica. Aquí puedes consultar y compartir tus avances.</p>
        </header>

        {practices.length > 1 && (
          <label className="mb-6 block max-w-md text-sm font-medium text-slate-300">
            Práctica
            <select value={selectedPractice?.id || ''} onChange={(event) => setSelectedPracticeId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-emerald-400">
              {practices.map((practice) => <option key={practice.id} value={practice.id}>{practice.assignment.cargo} · {practice.assignment.empresa}</option>)}
            </select>
          </label>
        )}

        {message && (
          <div role="status" className="fixed right-4 top-4 z-40 flex max-w-md items-start gap-3 rounded-xl border border-emerald-500/40 bg-slate-900 p-4 text-sm text-emerald-200 shadow-2xl">
            <p className="leading-6">{message}</p>
            <button type="button" aria-label="Cerrar notificación" onClick={() => setMessage('')} className="text-lg leading-none text-slate-400 hover:text-white">×</button>
          </div>
        )}
        {error && <div className="mb-5"><Message error>{error}</Message></div>}
        {selectedPractice && (
          <>
          <div role="tablist" aria-label="Secciones del seguimiento" className="mb-5 flex flex-wrap gap-2 border-b border-slate-700 pb-3">
            <button
              id="academic-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === 'academica'}
              aria-controls="academic-panel"
              onClick={() => setActiveTab('academica')}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === 'academica' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Seguimiento académico
            </button>
            <button
              id="company-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === 'empresa'}
              aria-controls="company-panel"
              onClick={() => setActiveTab('empresa')}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === 'empresa' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Gestión laboral · Empresa
            </button>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {activeTab === 'empresa' && (
            <section id="company-panel" role="tabpanel" aria-labelledby="company-tab" className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-300">SEGUIMIENTO LABORAL · EMPRESA</p>
                  <h2 className="mt-2 text-xl font-bold text-white">{selectedPractice.empresa?.nombre || selectedPractice.assignment.empresa}</h2>
                  <p className="mt-1 text-slate-300">{selectedPractice.assignment.cargo}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedPractice.assignment.estado === 'en_curso' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
                  {statusLabel(selectedPractice.assignment.estado)}
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-700 pt-4 sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Instructor</dt><dd className="mt-1 text-sm text-slate-200">{selectedPractice.tutor?.nombre || (selectedPractice.assignment.tutor_id ? 'Instructor' : 'Pendiente de asignación')}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Jefe inmediato</dt><dd className="mt-1 text-sm text-slate-200">{selectedPractice.assignment.jefe_inmediato || 'Pendiente de asignación'}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Inicio</dt><dd className="mt-1 text-sm text-slate-200">{readableDate(selectedPractice.assignment.fecha_inicio)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-slate-500">Finalización</dt><dd className="mt-1 text-sm text-slate-200">{readableDate(selectedPractice.assignment.fecha_fin)}</dd></div>
              </dl>
              {selectedPractice.assignment.empresa_id ? (
                <details className="mt-5 rounded-xl border border-slate-700 bg-slate-900/40">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="block font-semibold text-white">Entregables para la empresa</span>
                      <span className="mt-1 block text-xs text-slate-400">Comparte reportes o productos técnicos.</span>
                    </span>
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{selectedEvidence.filter((evidence) => evidence.tipo === 'empresa').length} enviados</span>
                  </summary>
                  <div className="space-y-4 border-t border-slate-700 p-4">
                    {selectedPractice.assignment.estado === 'en_curso' ? (
                      <form onSubmit={(event) => void submitEvidence(event, 'empresa')} className="space-y-4">
                        <label className="block text-sm font-medium text-slate-300">Título
                          <input required maxLength={120} value={companyTitle} onChange={(event) => setCompanyTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                        </label>
                        <label className="block text-sm font-medium text-slate-300">Descripción
                          <textarea required minLength={5} rows={3} value={companyDescription} onChange={(event) => setCompanyDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                        </label>
                        <FileField file={companyFile} setFile={setCompanyFile} onInvalid={setError} />
                        <SubmitButton submitting={submitting === 'empresa'}>Enviar entregable</SubmitButton>
                      </form>
                    ) : (
                      <p className="text-sm text-slate-400">La práctica finalizó. Puedes consultar tu historial, pero ya no enviar nuevos entregables.</p>
                    )}
                  </div>
                </details>
              ) : (
                <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-4 text-sm leading-6 text-slate-400">La empresa todavía no está vinculada a tu registro. Puedes enviar bitácoras al instructor; cuando vinculemos el perfil de la empresa aparecerán aquí los entregables.</p>
              )}

              {selectedPractice.assignment.empresa_id && (
                <>
                  {laborError && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm leading-6 text-rose-200">{laborError}</p>}

                  <details className="rounded-xl border border-slate-700 bg-slate-900/40">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-semibold text-white">Tareas y entregables laborales</span>
                        <span className="mt-1 block text-xs text-slate-400">Completa las tareas asignadas y comparte su evidencia.</span>
                      </span>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                        {selectedTasks.filter((task) => task.estado === 'completado').length}/{selectedTasks.length} completadas
                      </span>
                    </summary>
                    <div className="border-t border-slate-700 p-4">
                    {laborLoading ? (
                      <p className="animate-pulse text-sm text-slate-400">Cargando tareas...</p>
                    ) : selectedTasks.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-5 text-center text-sm text-slate-400">No tienes tareas pendientes por el momento.</p>
                    ) : (
                      <ul className="space-y-3">
                        {selectedTasks.map((task) => (
                          <li key={task.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h4 className="font-semibold text-white">{task.titulo}</h4>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">{task.descripcion}</p>
                                <p className="mt-2 text-xs text-slate-500">Asignada el {readableDate(task.created_at.slice(0, 10))}</p>
                              </div>
                              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${task.estado === 'completado' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
                                {task.estado === 'completado' ? '✓ Completada' : 'Pendiente'}
                              </span>
                            </div>
                            {task.estado === 'completado' ? (
                              task.enlace_adjunto && <a href={task.enlace_adjunto} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir evidencia enviada →</a>
                            ) : selectedPractice.assignment.estado === 'en_curso' ? (
                              <button type="button" onClick={() => { setCompletingTask(task); setTaskEvidenceLink(''); setError('') }} className="mt-3 rounded-lg border border-emerald-500/50 px-3 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/10">
                                Marcar como completada
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    </div>
                  </details>

                  <details className="rounded-xl border border-slate-700 bg-slate-900/40">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-semibold text-white">Novedades</span>
                        <span className="mt-1 block text-xs text-slate-400">Reporta retrasos, ausencias o permisos a la empresa.</span>
                      </span>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{selectedNovelties.length} reportadas</span>
                    </summary>
                    <div className="space-y-4 border-t border-slate-700 p-4">
                    {selectedPractice.assignment.estado === 'en_curso' ? (
                      <form onSubmit={(event) => void submitNovelty(event)} className="space-y-3">
                        <label className="block text-sm font-medium text-slate-300">Tipo de novedad
                          <select value={noveltyType} onChange={(event) => setNoveltyType(event.target.value as NoveltyType)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-rose-400">
                            <option value="retraso">Retraso</option>
                            <option value="ausencia_salud">Ausencia por salud</option>
                            <option value="permiso_personal">Permiso personal</option>
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-slate-300">Justificación
                          <textarea required minLength={5} maxLength={2000} rows={3} value={noveltyJustification} onChange={(event) => setNoveltyJustification(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-rose-400" />
                        </label>
                        <button type="submit" disabled={sendingNovelty} className="rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-wait disabled:opacity-60">
                          {sendingNovelty ? 'Enviando novedad...' : 'Reportar novedad'}
                        </button>
                      </form>
                    ) : <p className="mt-3 text-sm text-slate-400">La práctica finalizó; ya no puedes enviar novedades.</p>}
                    <div>
                      {laborLoading ? (
                        <p className="text-sm text-slate-400">Cargando novedades...</p>
                      ) : selectedNovelties.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-center text-sm text-slate-400">No has reportado novedades.</p>
                      ) : (
                        <ul className="space-y-2">
                          {selectedNovelties.map((novelty) => (
                            <li key={novelty.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                              <div className="flex flex-wrap justify-between gap-2">
                                <span className="text-sm font-semibold text-rose-300">{noveltyTypeLabels[novelty.tipo]}</span>
                                <span className={`text-xs ${novelty.estado === 'leido' ? 'text-emerald-300' : 'text-slate-400'}`}>{novelty.estado === 'leido' ? 'Leída por la empresa' : 'Enviada'}</span>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{novelty.justificacion}</p>
                              <p className="mt-2 text-xs text-slate-500">{readableDate(novelty.created_at.slice(0, 10))}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    </div>
                  </details>

                  <details className="rounded-xl border border-slate-700 bg-slate-900/40">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block font-semibold text-white">Feedback de la empresa</span>
                        <span className="mt-1 block text-xs text-slate-400">Consulta los comentarios sobre tu desempeño.</span>
                      </span>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{selectedCompanyFeedback.length} comentarios</span>
                    </summary>
                    <div className="border-t border-slate-700 p-4">
                    {laborLoading ? (
                      <p className="text-sm text-slate-400">Cargando comentarios...</p>
                    ) : selectedCompanyFeedback.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">La empresa aún no ha dejado comentarios de desempeño.</p>
                    ) : (
                      <ul className="space-y-3">
                        {selectedCompanyFeedback.map((feedback) => (
                          <li key={feedback.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{feedback.comentario}</p>
                            <p className="mt-2 text-xs text-slate-500">{readableDate(feedback.created_at.slice(0, 10))}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    </div>

                  {selectedPractice.assignment.estado === 'finalizada' && (
                    <div className="border-t border-slate-700 p-4">
                      <button
                        type="button"
                        onClick={() => { setCertificateRequested(true); setMessage('Solicitud de certificado registrada. La empresa recibirá el aviso cuando se habilite el envío de correo.') }}
                        disabled={certificateRequested}
                        className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-default disabled:opacity-70 sm:w-auto"
                      >
                        {certificateRequested ? 'Certificado solicitado' : 'Solicitar certificado laboral'}
                      </button>
                      <p className="mt-2 text-xs text-slate-500">El envío automático al correo de recursos humanos aún no está configurado.</p>
                    </div>
                  )}
                  </details>
                </>
              )}
            </section>
            )}

            {activeTab === 'academica' && (
            <section id="academic-panel" role="tabpanel" aria-labelledby="academic-tab" className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
              <p className="text-sm font-semibold text-emerald-300">SEGUIMIENTO ACADÉMICO · INSTRUCTOR</p>
              <h2 className="mt-2 text-xl font-bold text-white">Bitácora y evaluaciones</h2>
              {selectedPractice.assignment.estado === 'en_curso' ? (
                <>
                {!selectedPractice.assignment.tutor_id && <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">Aún no tienes instructor asignado. Puedes enviar tus archivos; quedarán disponibles para revisión cuando el instructor se vincule a tu práctica.</p>}
                <form onSubmit={(event) => void submitEvidence(event, 'academica')} className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-slate-300">Título de la bitácora
                    <input required maxLength={120} value={academicTitle} onChange={(event) => setAcademicTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                  </label>
                  <label className="block text-sm font-medium text-slate-300">Trabajo realizado esta semana
                    <textarea required minLength={5} rows={3} value={academicDescription} onChange={(event) => setAcademicDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                  </label>
                  <FileField file={academicFile} setFile={setAcademicFile} onInvalid={setError} />
                  <SubmitButton submitting={submitting === 'academica'}>Enviar bitácora</SubmitButton>
                </form>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-400">La práctica finalizó. Puedes consultar tu historial, pero ya no enviar nuevas bitácoras.</p>
              )}

              <div className="mt-7 border-t border-slate-700 pt-5">
                <h3 className="font-semibold text-white">Evaluaciones del instructor</h3>
                {selectedEvaluations.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">Aún no hay evaluaciones registradas para esta práctica.</p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {selectedEvaluations.map((evaluation) => (
                      <li key={evaluation.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${evaluation.resultado === 'aprobada' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{evaluation.resultado === 'aprobada' ? 'Aprobada' : 'Reprobada'}</span>
                          <span className="text-xs text-slate-500">{readableDate(evaluation.created_at.slice(0, 10))}</span>
                        </div>
                        <p className="mt-3 font-semibold text-white">Calificación: {evaluation.calificacion}/100</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{evaluation.retroalimentacion}</p>
                        {evaluation.evidencia_path && signedUrls[evaluation.id] && (
                          <a href={signedUrls[evaluation.id] || undefined} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir archivo del instructor →</a>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
            )}
          </div>
          </>
        )}

        {selectedPractice && (
          <details className="mt-6 rounded-2xl border border-slate-700 bg-slate-800">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-lg font-semibold text-white">Historial de entregas</span>
                <span className="mt-1 block text-sm text-slate-400">
                  {activeTab === 'academica' ? 'Bitácoras y archivos para tu instructor.' : 'Archivos que has compartido con la empresa.'}
                </span>
              </span>
              <span className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300">{selectedTabEvidence.length} archivos</span>
            </summary>
            <div className="border-t border-slate-700 p-5 sm:p-6">
            {selectedTabEvidence.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-center text-sm text-slate-400">
                {activeTab === 'academica' ? 'Aún no has enviado bitácoras al instructor.' : 'Aún no has enviado archivos a la empresa.'}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {selectedTabEvidence.map((evidence) => (
                  <li key={evidence.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${evidence.tipo === 'academica' ? 'bg-blue-400/10 text-blue-300' : 'bg-violet-400/10 text-violet-300'}`}>{evidence.tipo === 'academica' ? 'Instructor' : 'Empresa'}</span>
                      <span className="text-xs text-slate-500">{readableDate(evidence.created_at.slice(0, 10))}</span>
                    </div>
                    <h3 className="mt-3 font-semibold text-white">{evidence.titulo}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-400">{evidence.descripcion}</p>
                    {signedUrls[evidence.id] && <a href={signedUrls[evidence.id] || undefined} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">Abrir archivo →</a>}
                  </li>
                ))}
              </ul>
            )}
            </div>
          </details>
        )}
        {completingTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="complete-task-title" className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
              <h2 id="complete-task-title" className="text-lg font-semibold text-white">Completar entregable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{completingTask.titulo}</p>
              <form onSubmit={(event) => void completeTask(event)} className="mt-5 space-y-4">
                <label className="block text-sm font-medium text-slate-300">Enlace de evidencia
                  <input
                    required
                    type="url"
                    inputMode="url"
                    value={taskEvidenceLink}
                    onChange={(event) => setTaskEvidenceLink(event.target.value)}
                    placeholder="https://github.com/..."
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button type="button" disabled={savingTaskId === completingTask.id} onClick={() => setCompletingTask(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">
                    Cancelar
                  </button>
                  <button type="submit" disabled={savingTaskId === completingTask.id} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                    {savingTaskId === completingTask.id ? 'Enviando...' : 'Enviar evidencia'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

function FileField({ file, setFile, onInvalid }: { file: File | null; setFile: (file: File | null) => void; onInvalid: (message: string) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-300">
      Archivo (PDF, Word o imagen; máximo 10 MB)
      <input
        type="file"
        required
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const nextFile = event.target.files?.[0] || null
          if (nextFile && !ALLOWED_FILE_TYPES.has(nextFile.type)) {
            event.target.value = ''
            setFile(null)
            onInvalid('Formato no permitido. Adjunta PDF, Word, JPG, PNG o WEBP.')
            return
          }
          if (nextFile && nextFile.size > MAX_FILE_SIZE) {
            event.target.value = ''
            setFile(null)
            onInvalid('El archivo supera el límite de 10 MB.')
            return
          }
          onInvalid('')
          setFile(nextFile)
        }}
        className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200"
      />
      <span className="mt-1 block text-xs text-slate-500">{file?.name || 'Formatos permitidos: PDF, DOC, DOCX, JPG, PNG y WEBP.'}</span>
    </label>
  )
}

function SubmitButton({ children, submitting }: { children: string; submitting: boolean }) {
  return (
    <div>
      <button type="submit" disabled={submitting} className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
        {submitting ? 'Subiendo archivo...' : children}
      </button>
      {submitting && <div role="progressbar" aria-label="Subiendo archivo" className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700"><div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400" /></div>}
    </div>
  )
}
