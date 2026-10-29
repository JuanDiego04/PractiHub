'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  ALLOWED_EVIDENCE_TYPES,
  getAssignedStudents,
  getEvidenceUrl,
  getEvaluations,
  getTutorId,
  MAX_EVIDENCE_SIZE,
  readableDate,
  removeEvidence,
  uploadEvidence,
  type EstudianteAsignado,
  type Evaluacion,
  type ResultadoEvaluacion,
} from '@/lib/tutorSeguimiento'

interface EvaluationDraft {
  calificacion: string
  retroalimentacion: string
  resultado: ResultadoEvaluacion
}

interface ToastMessage {
  kind: 'success' | 'error'
  text: string
}

function EvaluationSkeleton() {
  return (
    <div className="space-y-4" aria-label="Cargando evaluaciones">
      {[0, 1].map((item) => (
        <div key={item} className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <div className="h-5 w-1/3 rounded bg-slate-700" />
          <div className="mt-5 h-24 rounded bg-slate-700/70" />
          <div className="mt-4 h-10 w-1/4 rounded bg-slate-700/70" />
        </div>
      ))}
    </div>
  )
}

function Toast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`fixed right-4 top-4 z-50 flex max-w-md items-start gap-4 rounded-xl border p-4 shadow-2xl ${
        toast.kind === 'error'
          ? 'border-rose-500/40 bg-slate-900 text-rose-200'
          : 'border-emerald-500/40 bg-slate-900 text-emerald-200'
      }`}
    >
      <p className="text-sm leading-6">{toast.text}</p>
      <button type="button" aria-label="Cerrar notificación" onClick={onClose} className="text-lg leading-none text-slate-400 hover:text-white">
        ×
      </button>
    </div>
  )
}

function EmptyHistory() {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">Sin evaluaciones previas</p>
      <p className="mt-1 text-xs text-slate-500">La primera evaluación que guardes aparecerá aquí.</p>
    </div>
  )
}

export default function TutorEvaluacionesView() {
  const [students, setStudents] = useState<EstudianteAsignado[]>([])
  const [evaluations, setEvaluations] = useState<Evaluacion[]>([])
  const [drafts, setDrafts] = useState<Record<string, EvaluationDraft>>({})
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({})
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deletingEvaluation, setDeletingEvaluation] = useState<Evaluacion | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((kind: ToastMessage['kind'], text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ kind, text })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const tutorId = await getTutorId()
      const assignedStudents = await getAssignedStudents(tutorId)
      const history = await getEvaluations(assignedStudents.map((student) => student.id))
      setStudents(assignedStudents)
      setEvaluations(history)
      setLoadFailed(false)
    } catch (loadError) {
      setLoadFailed(true)
      showToast('error', loadError instanceof Error ? loadError.message : 'Ocurrió un error inesperado.')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    // State updates happen after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    const evidence = evaluations.filter((evaluation) => evaluation.evidencia_path && !(evaluation.id in signedUrls))

    if (evidence.length === 0) return
    void Promise.all(evidence.map(async (evaluation) => {
      if (!evaluation.evidencia_path) return null
      try {
        return [evaluation.id, await getEvidenceUrl(evaluation.evidencia_path)] as const
      } catch {
        return [evaluation.id, null] as const
      }
    })).then((results) => {
      if (cancelled) return
      const urls = Object.fromEntries(results.filter((result): result is readonly [string, string | null] => result !== null))
      if (Object.keys(urls).length > 0) setSignedUrls((current) => ({ ...current, ...urls }))
    })

    return () => {
      cancelled = true
    }
  }, [evaluations, signedUrls])

  function updateDraft(studentId: string, patch: Partial<EvaluationDraft>) {
    setDrafts((current) => {
      const existing = current[studentId]
      return {
        ...current,
        [studentId]: existing
          ? { ...existing, ...patch }
          : { calificacion: '', retroalimentacion: '', resultado: 'aprobada', ...patch },
      }
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, student: EstudianteAsignado) {
    event.preventDefault()
    const draft = drafts[student.id] || {
      calificacion: '',
      retroalimentacion: '',
      resultado: 'aprobada' as const,
    }
    const score = Number(draft.calificacion)

    if (!Number.isFinite(score) || score < 0 || score > 100) {
      showToast('error', 'La calificación debe ser un número entre 0 y 100.')
      return
    }
    if (draft.retroalimentacion.trim().length < 5) {
      showToast('error', 'Escribe una retroalimentación de al menos 5 caracteres.')
      return
    }

    if (editingId && editingStudentId !== student.id) {
      showToast('error', 'Termina o cancela la edición actual antes de registrar otra evaluación.')
      return
    }
    const currentEvaluation = evaluations.find((evaluation) => evaluation.id === editingId && evaluation.estudiante_asignado_id === student.id)
    if (editingId && !currentEvaluation) {
      showToast('error', 'La evaluación que intentas editar ya no está disponible. Actualiza el historial.')
      return
    }
    const selectedFile = selectedFiles[student.id] || null

    setSavingId(student.id)
    let uploadedPath: string | null = null
    let persisted = false
    let cleanupWarning = ''

    try {
      if (selectedFile) uploadedPath = await uploadEvidence(selectedFile, student.id)

      const payload = {
        calificacion: score,
        retroalimentacion: draft.retroalimentacion.trim(),
        resultado: draft.resultado,
        ...(uploadedPath ? { evidencia_path: uploadedPath } : {}),
      }

      if (currentEvaluation) {
        const { data, error } = await supabase
          .from('tutor_evaluaciones')
          .update(payload)
          .eq('id', currentEvaluation.id)
          .eq('estudiante_asignado_id', student.id)
          .select('id')
        if (error) throw new Error(`No se pudo actualizar la evaluación: ${error.message}`)
        if (!data?.length) throw new Error('No se actualizó ningún registro. Actualiza el historial e inténtalo nuevamente.')
        persisted = true

        if (uploadedPath && currentEvaluation.evidencia_path) {
          try {
            await removeEvidence(currentEvaluation.evidencia_path)
          } catch (removeError) {
            cleanupWarning = removeError instanceof Error ? removeError.message : 'No se pudo retirar el archivo anterior.'
          }
        }
        setEditingId(null)
        setEditingStudentId(null)
      } else {
        const { error } = await supabase.from('tutor_evaluaciones').insert({
          estudiante_asignado_id: student.id,
          ...payload,
        })
        if (error) throw new Error(`No se pudo guardar la evaluación: ${error.message}`)
        persisted = true
      }
    } catch (submitError) {
      if (uploadedPath && !persisted) {
        try {
          await removeEvidence(uploadedPath)
        } catch (cleanupError) {
          showToast('error', cleanupError instanceof Error
            ? `La operación falló y el archivo temporal no pudo eliminarse: ${cleanupError.message}`
            : 'La operación falló y el archivo temporal no pudo eliminarse.')
        }
      }
      showToast('error', submitError instanceof Error ? submitError.message : 'Ocurrió un error inesperado.')
      setSavingId(null)
      return
    }

    setDrafts((current) => ({
      ...current,
      [student.id]: { calificacion: '', retroalimentacion: '', resultado: 'aprobada' },
    }))
    setSelectedFiles((current) => ({ ...current, [student.id]: null }))
    const fileInput = document.getElementById(`evidence-${student.id}`)
    if (fileInput instanceof HTMLInputElement) fileInput.value = ''
    showToast('success', currentEvaluation ? `Evaluación de ${student.nombre} actualizada.` : `Evaluación guardada para ${student.nombre}.`)
    if (cleanupWarning) showToast('error', `La evaluación se guardó, pero quedó un archivo anterior en Storage: ${cleanupWarning}`)

    try {
      const tutorId = await getTutorId()
      const assignedStudents = await getAssignedStudents(tutorId)
      const history = await getEvaluations(assignedStudents.map((assigned) => assigned.id))
      setStudents(assignedStudents)
      setEvaluations(history)
    } catch (refreshError) {
      showToast('error', refreshError instanceof Error
        ? `La evaluación se guardó, pero no se pudo actualizar el historial: ${refreshError.message}`
        : 'La evaluación se guardó, pero no se pudo actualizar el historial.')
    } finally {
      setSavingId(null)
    }
  }

  function beginEdit(student: EstudianteAsignado, evaluation: Evaluacion) {
    setDrafts((current) => ({
      ...current,
      [student.id]: {
        calificacion: String(evaluation.calificacion),
        retroalimentacion: evaluation.retroalimentacion,
        resultado: evaluation.resultado,
      },
    }))
    setSelectedFiles((current) => ({ ...current, [student.id]: null }))
    setEditingId(evaluation.id)
    setEditingStudentId(student.id)
    setOpenMenuId(null)
    showToast('success', `Editando la evaluación de ${student.nombre}. Guarda los cambios en el formulario.`)
    document.getElementById(`evaluation-form-${student.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function cancelEdit(studentId: string) {
    setEditingId(null)
    setEditingStudentId(null)
    setDrafts((current) => ({
      ...current,
      [studentId]: { calificacion: '', retroalimentacion: '', resultado: 'aprobada' },
    }))
    setSelectedFiles((current) => ({ ...current, [studentId]: null }))
  }

  async function handleDelete() {
    if (!deletingEvaluation) return
    const evaluation = deletingEvaluation
    setDeletingEvaluation(null)
    setSavingId(evaluation.estudiante_asignado_id)

    try {
      const { data, error } = await supabase
        .from('tutor_evaluaciones')
        .delete()
        .eq('id', evaluation.id)
        .eq('estudiante_asignado_id', evaluation.estudiante_asignado_id)
        .select('id')

      if (error) throw new Error(`No se pudo eliminar la evaluación: ${error.message}`)
      if (!data?.length) throw new Error('No se eliminó ningún registro. Actualiza el historial e inténtalo nuevamente.')

      setEvaluations((current) => current.filter((entry) => entry.id !== evaluation.id))
      setSignedUrls((current) => {
        const next = { ...current }
        delete next[evaluation.id]
        return next
      })

      if (evaluation.evidencia_path) {
        try {
        await removeEvidence(evaluation.evidencia_path)
        } catch (removeError) {
          showToast('error', removeError instanceof Error
            ? `La evaluación se eliminó, pero su evidencia quedó almacenada: ${removeError.message}`
            : 'La evaluación se eliminó, pero no se pudo borrar la evidencia.')
          return
        }
      }

      if (editingId === evaluation.id) cancelEdit(evaluation.estudiante_asignado_id)
      showToast('success', 'Evaluación eliminada.')
    } catch (deleteError) {
      showToast('error', deleteError instanceof Error ? deleteError.message : 'Ocurrió un error inesperado.')
    } finally {
      setSavingId(null)
    }
  }

  async function refreshData() {
    setLoading(true)
    await loadData()
  }

  const evaluationsByStudent = evaluations.reduce<Record<string, Evaluacion[]>>((grouped, evaluation) => {
    const history = grouped[evaluation.estudiante_asignado_id] || []
    return { ...grouped, [evaluation.estudiante_asignado_id]: [...history, evaluation] }
  }, {})

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      {deletingEvaluation && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-evaluation-title"
            aria-describedby="delete-evaluation-description"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl"
          >
            <h2 id="delete-evaluation-title" className="text-lg font-semibold text-white">Eliminar evaluación</h2>
            <p id="delete-evaluation-description" className="mt-2 text-sm leading-6 text-slate-400">
              Esta acción no se puede deshacer. También se eliminará la evidencia adjunta.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeletingEvaluation(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
                Cancelar
              </button>
              <button type="button" onClick={() => void handleDelete()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400">
                Eliminar
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · SEGUIMIENTO</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Evaluaciones</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Registra calificaciones y retroalimentación, adjunta evidencias y consulta el historial de cada aprendiz.
          </p>
        </header>

        {loading ? (
          <EvaluationSkeleton />
        ) : loadFailed ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/60 px-6 py-10 text-center">
            <p className="font-medium text-slate-200">No se pudieron cargar tus evaluaciones.</p>
            <button type="button" onClick={() => void refreshData()} className="mt-3 text-sm font-semibold text-emerald-300 underline underline-offset-4">
              Reintentar
            </button>
          </div>
        ) : students.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/60 px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-700/70 text-xl text-emerald-300" aria-hidden="true">✓</span>
            <h2 className="mt-4 text-lg font-semibold text-white">No tienes evaluaciones pendientes</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
              Agrega primero a tus aprendices desde la lista de seguimiento para poder registrar sus evaluaciones.
            </p>
            <Link href="/estudiantes" className="mt-5 inline-flex rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300">
              Ir a estudiantes
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-white">Aprendices en seguimiento</h2>
                <p className="mt-1 text-sm text-slate-400">Despliega cada ficha para registrar o consultar sus evaluaciones.</p>
              </div>
              <span className="text-sm text-slate-500">{students.length} aprendiz{students.length === 1 ? '' : 'es'}</span>
            </div>
            {students.map((student) => {
              const draft = drafts[student.id] || {
                calificacion: '',
                retroalimentacion: '',
                resultado: 'aprobada' as const,
              }
              const history = evaluationsByStudent[student.id] || []
              const editingEvaluation = editingStudentId === student.id
                ? history.find((evaluation) => evaluation.id === editingId)
                : undefined

              return (
                <details key={student.id} className="group overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 open:border-slate-600">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 transition hover:bg-slate-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white">{student.nombre}</span>
                      <span className="mt-1 block truncate text-sm text-slate-400">{student.empresa} · {student.cargo}</span>
                      <span className="mt-2 inline-flex rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-400">
                        {history.length} evaluación{history.length === 1 ? '' : 'es'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-sm font-semibold text-emerald-300">
                      <span className="hidden sm:inline">Ver evaluaciones</span>
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 transition-transform group-open:rotate-180">
                        <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </summary>

                  <div className="border-t border-slate-700 p-5 sm:p-6">
                    <div className="mb-5 flex justify-end">
                      <Link href={`/estudiantes/${student.id}`} className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200">
                        Ver seguimiento completo →
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <form id={`evaluation-form-${student.id}`} onSubmit={(event) => void handleSubmit(event, student)} className="space-y-4">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {editingEvaluation ? 'Editar evaluación' : 'Nueva evaluación'}
                      </h3>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="text-sm font-medium text-slate-300">
                          Calificación (0–100)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            required
                            value={draft.calificacion}
                            onChange={(event) => updateDraft(student.id, { calificacion: event.target.value })}
                            placeholder="0–100"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
                          />
                        </label>
                        <label className="text-sm font-medium text-slate-300">
                          Resultado
                          <select
                            value={draft.resultado}
                            onChange={(event) => updateDraft(student.id, { resultado: event.target.value as ResultadoEvaluacion })}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
                          >
                            <option value="aprobada">Aprobada</option>
                            <option value="reprobada">Reprobada</option>
                          </select>
                        </label>
                      </div>
                      <label className="block text-sm font-medium text-slate-300">
                        Retroalimentación
                        <textarea
                          required
                          minLength={5}
                          rows={4}
                          value={draft.retroalimentacion}
                          onChange={(event) => updateDraft(student.id, { retroalimentacion: event.target.value })}
                          placeholder="Describe el progreso, fortalezas y aspectos por mejorar..."
                          className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-300">
                        Evidencia (PDF, JPG, PNG o WEBP; máximo 10 MB)
                        <input
                          id={`evidence-${student.id}`}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null
                            if (file && !ALLOWED_EVIDENCE_TYPES.includes(file.type)) {
                              event.target.value = ''
                              showToast('error', 'Formato no permitido. Adjunta un PDF, JPG, PNG o WEBP.')
                              return
                            }
                            if (file && file.size > MAX_EVIDENCE_SIZE) {
                              event.target.value = ''
                              showToast('error', 'El archivo supera el límite de 10 MB.')
                              return
                            }
                            setSelectedFiles((current) => ({ ...current, [student.id]: file }))
                          }}
                          className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200 hover:file:bg-slate-600"
                        />
                        {selectedFiles[student.id] && (
                          <span className="mt-1 block text-xs text-slate-500">{selectedFiles[student.id]?.name}</span>
                        )}
                        {editingEvaluation?.evidencia_path && (
                          <span className="mt-1 block text-xs text-slate-500">
                            {selectedFiles[student.id] ? 'El nuevo archivo reemplazará la evidencia actual.' : 'Si no seleccionas otro, se conservará la evidencia actual.'}
                          </span>
                        )}
                      </label>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={savingId === student.id}
                          className="rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
                        >
                          {savingId === student.id ? 'Guardando...' : editingEvaluation ? 'Guardar cambios' : 'Guardar evaluación'}
                        </button>
                        {editingEvaluation && (
                          <button type="button" onClick={() => cancelEdit(student.id)} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700">
                            Cancelar edición
                          </button>
                        )}
                      </div>
                    </form>

                    <section aria-label={`Historial de ${student.nombre}`} className="border-t border-slate-700 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-200">Historial</h3>
                        <span className="text-xs text-slate-500">{history.length} registro{history.length === 1 ? '' : 's'}</span>
                      </div>
                      {history.length === 0 ? (
                        <EmptyHistory />
                      ) : (
                        <ol className="mt-4 space-y-3">
                          {history.map((evaluation) => (
                            <li key={evaluation.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  evaluation.resultado === 'aprobada'
                                    ? 'bg-emerald-400/10 text-emerald-300'
                                    : 'bg-rose-500/10 text-rose-300'
                                }`}>
                                  {evaluation.resultado === 'aprobada' ? 'Aprobada' : 'Reprobada'}
                                </span>
                                <div className="relative">
                                  <button
                                    type="button"
                                    aria-label="Opciones de evaluación"
                                    aria-expanded={openMenuId === evaluation.id}
                                    onClick={() => setOpenMenuId((current) => current === evaluation.id ? null : evaluation.id)}
                                    className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-700 hover:text-white"
                                  >
                                    ⋯
                                  </button>
                                  {openMenuId === evaluation.id && (
                                    <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
                                      <button type="button" onClick={() => beginEdit(student, evaluation)} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">
                                        Editar
                                      </button>
                                      <button type="button" onClick={() => { setDeletingEvaluation(evaluation); setOpenMenuId(null) }} className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-slate-700">
                                        Eliminar
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <span className="mt-1 block text-xs text-slate-500">{readableDate(evaluation.created_at.slice(0, 10))}</span>
                              <p className="mt-3 text-sm font-semibold text-white">Calificación: {evaluation.calificacion}/100</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{evaluation.retroalimentacion}</p>
                              {evaluation.evidencia_path && (
                                signedUrls[evaluation.id] ? (
                                  <a
                                    href={signedUrls[evaluation.id] ?? undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                                  >
                                    Abrir evidencia adjunta
                                  </a>
                                ) : signedUrls[evaluation.id] === null ? (
                                  <span className="mt-3 inline-flex text-xs text-rose-300">No se pudo generar el enlace seguro de esta evidencia.</span>
                                ) : (
                                  <span className="mt-3 inline-flex text-xs text-slate-500">Preparando enlace seguro de evidencia...</span>
                                )
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
