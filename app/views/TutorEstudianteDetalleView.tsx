'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { jsPDF } from 'jspdf'
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
  statusLabel,
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

export default function TutorEstudianteDetalleView({ assignmentId }: { assignmentId: string }) {
  const [student, setStudent] = useState<EstudianteAsignado | null>(null)
  const [evaluations, setEvaluations] = useState<Evaluacion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [editingEvaluationId, setEditingEvaluationId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<EvaluationDraft | null>(null)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Evaluacion | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({})
  const [savingEvaluation, setSavingEvaluation] = useState(false)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showActionMessage = useCallback((message: string) => {
    if (actionTimer.current) clearTimeout(actionTimer.current)
    setActionMessage(message)
    actionTimer.current = setTimeout(() => setActionMessage(''), 6000)
  }, [])

  const refreshHistory = useCallback(async () => {
    setEvaluations(await getEvaluations([assignmentId]))
  }, [assignmentId])

  useEffect(() => () => {
    if (actionTimer.current) clearTimeout(actionTimer.current)
  }, [])

  function exportPdf() {
    if (!student) return
    setExportError('')
    try {
      const document = new jsPDF()
      const margin = 18
      const pageWidth = document.internal.pageSize.getWidth()
      let y = 22

      document.setFillColor(15, 23, 42)
      document.rect(0, 0, pageWidth, 42, 'F')
      document.setTextColor(52, 211, 153)
      document.setFontSize(10)
      document.text('PRACTIHUB · INFORME DE SEGUIMIENTO', margin, 16)
      document.setTextColor(255, 255, 255)
      document.setFontSize(20)
      document.text(student.nombre, margin, 31)
      y = 55

      function addText(label: string, value: string) {
        document.setFont('helvetica', 'bold')
        document.setFontSize(10)
        document.setTextColor(51, 65, 85)
        document.text(label, margin, y)
        y += 6
        document.setFont('helvetica', 'normal')
        document.setTextColor(30, 41, 59)
        const lines = document.splitTextToSize(value || 'Sin información', pageWidth - margin * 2)
        document.text(lines, margin, y)
        y += lines.length * 5 + 5
      }

      addText('Correo', student.email)
      addText('Empresa', student.empresa)
      addText('Oferta / cargo', student.cargo)
      addText('Estado de práctica', statusLabel(student.estado))
      addText('Fecha de inicio', readableDate(student.fecha_inicio))
      addText('Fecha de finalización', readableDate(student.fecha_fin))

      y += 3
      document.setFont('helvetica', 'bold')
      document.setFontSize(14)
      document.setTextColor(5, 150, 105)
      document.text('Historial de evaluaciones', margin, y)
      y += 9

      if (evaluations.length === 0) {
        addText('Historial', 'Aún no hay evaluaciones registradas.')
      }

      evaluations.forEach((evaluation, index) => {
        const feedbackLines = document.splitTextToSize(
          evaluation.retroalimentacion,
          pageWidth - margin * 2,
        )
        const blockHeight = 34 + feedbackLines.length * 5
        if (y + blockHeight > document.internal.pageSize.getHeight() - 18) {
          document.addPage()
          y = 20
        }
        document.setDrawColor(203, 213, 225)
        document.setFillColor(248, 250, 252)
        document.roundedRect(margin, y - 4, pageWidth - margin * 2, blockHeight, 2, 2, 'FD')
        document.setFont('helvetica', 'bold')
        document.setFontSize(10)
        document.setTextColor(30, 41, 59)
        document.text(`Evaluación ${index + 1} · ${readableDate(evaluation.created_at.slice(0, 10))}`, margin + 4, y + 3)
        document.setFont('helvetica', 'normal')
        document.text(`Resultado: ${evaluation.resultado === 'aprobada' ? 'Aprobada' : 'Reprobada'} · Calificación: ${evaluation.calificacion}/100`, margin + 4, y + 10)
        document.setTextColor(71, 85, 105)
        document.text(feedbackLines, margin + 4, y + 17)
        y += blockHeight + 7
      })

      const totalPages = document.getNumberOfPages()
      for (let page = 1; page <= totalPages; page += 1) {
        document.setPage(page)
        document.setFontSize(8)
        document.setTextColor(100, 116, 139)
        document.text(`Página ${page} de ${totalPages}`, pageWidth - margin, document.internal.pageSize.getHeight() - 8, { align: 'right' })
      }

      document.save(`seguimiento-${student.nombre.trim().replace(/\s+/g, '-').toLowerCase()}.pdf`)
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : 'No se pudo generar el PDF.')
    }
  }

  function exportExcel() {
    if (!student) return
    setExportError('')
    try {
      const rows = [
        ['Práctica'],
        ['Estudiante', 'Correo', 'Empresa', 'Cargo', 'Estado', 'Fecha de inicio', 'Fecha de finalización'],
        [
          student.nombre,
          student.email,
          student.empresa,
          student.cargo,
          statusLabel(student.estado),
          readableDate(student.fecha_inicio),
          readableDate(student.fecha_fin),
        ],
        [],
        ['Evaluaciones'],
        ['Fecha', 'Calificación', 'Resultado', 'Retroalimentación', 'Evidencia'],
        ...evaluations.map((evaluation) => [
          readableDate(evaluation.created_at.slice(0, 10)),
          evaluation.calificacion,
          evaluation.resultado === 'aprobada' ? 'Aprobada' : 'Reprobada',
          evaluation.retroalimentacion,
          evaluation.evidencia_path ? 'Adjunta (enlace privado)' : 'Sin evidencia',
        ]),
      ]
      const csvCell = (value: string | number) => {
        const text = String(value)
        const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
        return `"${safeText.replace(/"/g, '""')}"`
      }
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `seguimiento-${student.nombre.trim().replace(/\s+/g, '-').toLowerCase()}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : 'No se pudo generar el archivo Excel.')
    }
  }

  function startEditing(evaluation: Evaluacion) {
    setEditingEvaluationId(evaluation.id)
    setEditingDraft({
      calificacion: String(evaluation.calificacion),
      retroalimentacion: evaluation.retroalimentacion,
      resultado: evaluation.resultado,
    })
    setEvidenceFile(null)
    setOpenMenuId(null)
  }

  async function saveEditedEvaluation(evaluation: Evaluacion) {
    if (!editingDraft || !student) return
    const score = Number(editingDraft.calificacion)
    if (!Number.isFinite(score) || score < 0 || score > 100 || editingDraft.retroalimentacion.trim().length < 5) {
      showActionMessage('Revisa la calificación (0–100) y escribe al menos 5 caracteres de retroalimentación.')
      return
    }

    let uploadedPath: string | null = null
    let cleanupWarning = ''
    setSavingEvaluation(true)
    try {
      if (evidenceFile) uploadedPath = await uploadEvidence(evidenceFile, assignmentId)
      const { data, error: updateError } = await supabase
        .from('tutor_evaluaciones')
        .update({
          calificacion: score,
          retroalimentacion: editingDraft.retroalimentacion.trim(),
          resultado: editingDraft.resultado,
          ...(uploadedPath ? { evidencia_path: uploadedPath } : {}),
        })
        .eq('id', evaluation.id)
        .eq('estudiante_asignado_id', assignmentId)
        .select('id')

      if (updateError) throw new Error(`No se pudo actualizar la evaluación: ${updateError.message}`)
      if (!data?.length) throw new Error('No se actualizó ningún registro. Verifica que esta evaluación siga asignada a tu perfil.')
    } catch (updateError) {
      if (uploadedPath) {
        try {
          await removeEvidence(uploadedPath)
        } catch (cleanupError) {
          showActionMessage(cleanupError instanceof Error
            ? `No se pudo retirar el archivo temporal: ${cleanupError.message}`
            : 'No se pudo retirar el archivo temporal.')
        }
      }
      showActionMessage(updateError instanceof Error ? updateError.message : 'No se pudo actualizar la evaluación.')
      setSavingEvaluation(false)
      return
    }

    if (uploadedPath && evaluation.evidencia_path) {
      try {
        await removeEvidence(evaluation.evidencia_path)
      } catch (removeError) {
        cleanupWarning = removeError instanceof Error ? removeError.message : 'No se pudo retirar el archivo anterior.'
      }
    }

    setEditingEvaluationId(null)
    setEditingDraft(null)
    setEvidenceFile(null)
    setSignedUrls((current) => {
      const next = { ...current }
      delete next[evaluation.id]
      return next
    })
    showActionMessage('Evaluación actualizada correctamente.')
    if (cleanupWarning) showActionMessage(`La evaluación se guardó, pero quedó el archivo anterior en Storage: ${cleanupWarning}`)
    try {
      await refreshHistory()
    } catch (refreshError) {
      showActionMessage(refreshError instanceof Error
        ? `Se guardó la evaluación, pero no se pudo refrescar el historial: ${refreshError.message}`
        : 'Se guardó la evaluación, pero no se pudo refrescar el historial.')
    } finally {
      setSavingEvaluation(false)
    }
  }

  async function deleteEvaluation() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from('tutor_evaluaciones')
        .delete()
        .eq('id', target.id)
        .eq('estudiante_asignado_id', assignmentId)
        .select('id')

      if (deleteError) throw new Error(`No se pudo eliminar la evaluación: ${deleteError.message}`)
      if (!deletedRows?.length) throw new Error('No se eliminó ningún registro. Actualiza la página e inténtalo nuevamente.')

      setEvaluations((current) => current.filter((evaluation) => evaluation.id !== target.id))
      setSignedUrls((current) => {
        const next = { ...current }
        delete next[target.id]
        return next
      })
      if (target.evidencia_path) {
        try {
        await removeEvidence(target.evidencia_path)
        } catch (removeError) {
          showActionMessage(removeError instanceof Error
            ? `La evaluación se eliminó, pero no se pudo retirar el archivo: ${removeError.message}`
            : 'La evaluación se eliminó, pero no se pudo retirar el archivo.')
          return
        }
      }
      if (editingEvaluationId === target.id) {
        setEditingEvaluationId(null)
        setEditingDraft(null)
        setEvidenceFile(null)
      }
      showActionMessage('Evaluación eliminada correctamente.')
    } catch (deleteError) {
      showActionMessage(deleteError instanceof Error ? deleteError.message : 'Ocurrió un error inesperado.')
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      setLoading(true)
      setError('')

      try {
        const tutorId = await getTutorId()
        const assignedStudents = await getAssignedStudents(tutorId)
        const assignment = assignedStudents.find((entry) => entry.id === assignmentId)
        if (!assignment) throw new Error('No encontramos este seguimiento en tu lista de estudiantes.')

        const history = await getEvaluations([assignment.id])
        if (!cancelled) {
          setStudent(assignment)
          setEvaluations(history)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Ocurrió un error inesperado.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDetails()
    return () => {
      cancelled = true
    }
  }, [assignmentId])

  useEffect(() => {
    let cancelled = false
    const pending = evaluations.filter((evaluation) => evaluation.evidencia_path && !(evaluation.id in signedUrls))
    if (pending.length === 0) return

    void Promise.all(pending.map(async (evaluation) => {
      if (!evaluation.evidencia_path) return null
      try {
        return [evaluation.id, await getEvidenceUrl(evaluation.evidencia_path)] as const
      } catch {
        return [evaluation.id, null] as const
      }
    })).then((results) => {
      if (!cancelled) {
        const urls = Object.fromEntries(results.filter((result): result is readonly [string, string | null] => result !== null))
        setSignedUrls((current) => ({ ...current, ...urls }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [evaluations, signedUrls])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-4xl animate-pulse space-y-5">
          <div className="h-5 w-32 rounded bg-slate-700" />
          <div className="h-40 rounded-2xl border border-slate-700 bg-slate-800" />
          <div className="h-52 rounded-2xl border border-slate-700 bg-slate-800" />
        </div>
      </main>
    )
  }

  if (error || !student) {
    return (
      <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
        <section role="alert" className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-slate-800 p-6">
          <h1 className="text-xl font-semibold text-white">No se pudo cargar el seguimiento</h1>
          <p className="mt-2 text-sm leading-6 text-rose-200">{error || 'No se encontró el estudiante.'}</p>
          <Link href="/estudiantes" className="mt-5 inline-flex font-semibold text-emerald-300 hover:text-emerald-200">
            ← Volver a estudiantes
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      {(actionMessage || exportError) && (
        <div
          role={exportError ? 'alert' : 'status'}
          className={`fixed right-4 top-4 z-40 flex max-w-md items-start gap-3 rounded-xl border bg-slate-900 p-4 text-sm shadow-2xl ${
            exportError ? 'border-rose-500/40 text-rose-200' : 'border-emerald-500/40 text-emerald-200'
          }`}
        >
          <p className="leading-6">{exportError || actionMessage}</p>
          <button
            type="button"
            aria-label="Cerrar notificación"
            onClick={() => { setActionMessage(''); setExportError('') }}
            className="text-lg leading-none text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="detail-delete-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl"
          >
            <h2 id="detail-delete-title" className="text-lg font-semibold text-white">Eliminar evaluación</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Esta acción no se puede deshacer. También se eliminará su evidencia adjunta.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
                Cancelar
              </button>
              <button type="button" onClick={() => void deleteEvaluation()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400">
                Eliminar
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="mx-auto max-w-4xl">
        <Link href="/estudiantes" className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200">
          ← Volver a estudiantes
        </Link>
        <header className="mb-6 mt-5">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · SEGUIMIENTO INDIVIDUAL</p>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">{student.nombre}</h1>
              <p className="mt-1 text-slate-400">{student.email}</p>
            </div>
            <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
              student.estado === 'en_curso' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-700 text-slate-300'
            }`}>
              {statusLabel(student.estado)}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={exportPdf} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700">
              Exportar PDF
            </button>
            <button type="button" onClick={exportExcel} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700">
              Exportar a Excel (CSV)
            </button>
          </div>
          {exportError && <p role="alert" className="mt-3 text-sm text-rose-300">{exportError}</p>}
        </header>

        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Datos de la práctica</h2>
          <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Empresa</dt>
              <dd className="mt-1 text-slate-200">{student.empresa}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Oferta / cargo</dt>
              <dd className="mt-1 text-slate-200">{student.cargo}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Fecha de inicio</dt>
              <dd className="mt-1 text-slate-200">{readableDate(student.fecha_inicio)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Fecha de finalización</dt>
              <dd className="mt-1 text-slate-200">{readableDate(student.fecha_fin)}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Historial de evaluaciones</h2>
              <p className="mt-1 text-sm text-slate-400">{evaluations.length} registro{evaluations.length === 1 ? '' : 's'}</p>
            </div>
            <Link href="/evaluaciones" className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200">
              Registrar evaluación →
            </Link>
          </div>

          {evaluations.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center">
              <h3 className="font-medium text-slate-200">Aún no hay evaluaciones</h3>
              <p className="mt-1 text-sm text-slate-500">Las evaluaciones guardadas para esta práctica aparecerán aquí.</p>
            </div>
          ) : (
            <ol className="mt-5 space-y-3">
              {evaluations.map((evaluation) => (
                <li key={evaluation.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      evaluation.resultado === 'aprobada'
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : 'bg-rose-500/10 text-rose-300'
                    }`}>
                      {evaluation.resultado === 'aprobada' ? 'Aprobada' : 'Reprobada'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">{readableDate(evaluation.created_at.slice(0, 10))}</span>
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
                            <button type="button" onClick={() => { startEditing(evaluation); setOpenMenuId(null) }} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">
                              Editar
                            </button>
                            <button type="button" onClick={() => { setDeleteTarget(evaluation); setOpenMenuId(null) }} className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-slate-700">
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {editingEvaluationId === evaluation.id && editingDraft ? (
                    <form
                      onSubmit={(event) => { event.preventDefault(); void saveEditedEvaluation(evaluation) }}
                      className="mt-4 space-y-4"
                    >
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="text-sm font-medium text-slate-300">
                          Calificación (0–100)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            required
                            value={editingDraft.calificacion}
                            onChange={(event) => setEditingDraft((current) => current ? { ...current, calificacion: event.target.value } : current)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
                          />
                        </label>
                        <label className="text-sm font-medium text-slate-300">
                          Resultado
                          <select
                            value={editingDraft.resultado}
                            onChange={(event) => setEditingDraft((current) => current ? { ...current, resultado: event.target.value as ResultadoEvaluacion } : current)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
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
                          value={editingDraft.retroalimentacion}
                          onChange={(event) => setEditingDraft((current) => current ? { ...current, retroalimentacion: event.target.value } : current)}
                          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-300">
                        Reemplazar evidencia (PDF, JPG, PNG o WEBP; máximo 10 MB)
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null
                            if (file && !ALLOWED_EVIDENCE_TYPES.includes(file.type)) {
                              event.target.value = ''
                              showActionMessage('Formato no permitido. Adjunta un PDF, JPG, PNG o WEBP.')
                              return
                            }
                            if (file && file.size > MAX_EVIDENCE_SIZE) {
                              event.target.value = ''
                              showActionMessage('El archivo supera el límite de 10 MB.')
                              return
                            }
                            setEvidenceFile(file)
                          }}
                          className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200"
                        />
                        <span className="mt-1 block text-xs text-slate-500">
                          {evidenceFile ? evidenceFile.name : evaluation.evidencia_path ? 'La evidencia actual se conserva si no adjuntas otro archivo.' : 'No hay evidencia adjunta.'}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={savingEvaluation} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60">
                          {savingEvaluation ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                        <button type="button" disabled={savingEvaluation} onClick={() => { setEditingEvaluationId(null); setEditingDraft(null); setEvidenceFile(null) }} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-60">
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="mt-4 font-semibold text-white">Calificación: {evaluation.calificacion}/100</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{evaluation.retroalimentacion}</p>
                      {evaluation.evidencia_path && (
                        signedUrls[evaluation.id] ? (
                          <a href={signedUrls[evaluation.id] || undefined} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700">
                            Abrir evidencia adjunta
                          </a>
                        ) : signedUrls[evaluation.id] === null ? (
                          <span className="mt-3 inline-flex text-xs text-rose-300">No se pudo generar un enlace seguro para esta evidencia.</span>
                        ) : (
                          <span className="mt-3 inline-flex text-xs text-slate-500">Preparando enlace seguro...</span>
                        )
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  )
}
