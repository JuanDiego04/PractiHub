'use client'

import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import {
  formatInterviewDate,
  interviewSchemaError,
  toLocalDateTime,
  type CompanyInterview,
  type InterviewModality,
} from '@/lib/companyInterviews'

export default function CompanyInterviewScheduler({
  applicationId,
  companyId,
  studentId,
  interview,
  onScheduled,
}: {
  applicationId: string
  companyId: string
  studentId: string
  interview: CompanyInterview | null
  onScheduled: (interview: CompanyInterview) => void
}) {
  const [editing, setEditing] = useState(!interview)
  const [dateTime, setDateTime] = useState(interview ? toLocalDateTime(interview.fecha_hora) : '')
  const [modality, setModality] = useState<InterviewModality>(interview?.modalidad || 'virtual')
  const [location, setLocation] = useState(interview?.ubicacion || '')
  const [notes, setNotes] = useState(interview?.notas || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function saveInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const { data: userResult, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!userResult.user || userResult.user.id !== companyId) {
        throw new Error('Inicia sesión con la cuenta de empresa que recibió esta postulación.')
      }

      const { data, error: saveError } = await supabase
        .from('entrevistas_postulacion')
        .upsert({
          postulacion_id: applicationId,
          empresa_id: companyId,
          estudiante_id: studentId,
          fecha_hora: new Date(dateTime).toISOString(),
          modalidad: modality,
          ubicacion: location.trim() || null,
          notas: notes.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'postulacion_id' })
        .select('id, postulacion_id, empresa_id, estudiante_id, fecha_hora, modalidad, ubicacion, notas, created_at, updated_at')
        .single()

      if (saveError) throw new Error(interviewSchemaError(`No se pudo guardar la entrevista: ${saveError.message}`, saveError.code))
      onScheduled(data as CompanyInterview)
      setEditing(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar la entrevista.')
    } finally {
      setSaving(false)
    }
  }

  function editInterview() {
    if (interview) {
      setDateTime(toLocalDateTime(interview.fecha_hora))
      setModality(interview.modalidad)
      setLocation(interview.ubicacion || '')
      setNotes(interview.notas || '')
    }
    setError('')
    setEditing(true)
  }

  if (!editing && interview) {
    return (
      <section className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Entrevista agendada</p>
            <p className="mt-1 font-semibold text-white">{formatInterviewDate(interview.fecha_hora)}</p>
            <p className="mt-1 text-sm text-slate-300">{interview.modalidad === 'virtual' ? 'Virtual' : 'Presencial'}</p>
            {interview.ubicacion && <p className="mt-1 break-all text-sm text-slate-400">{interview.modalidad === 'virtual' ? <a href={interview.ubicacion} target="_blank" rel="noreferrer" className="text-emerald-300 underline">Abrir enlace de entrevista</a> : interview.ubicacion}</p>}
            {interview.notas && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{interview.notas}</p>}
          </div>
          <button type="button" onClick={editInterview} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-200">
            Cambiar entrevista
          </button>
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={(event) => void saveInterview(event)} className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <h3 className="font-semibold text-white">{interview ? 'Cambiar entrevista' : 'Agendar entrevista'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-300">
          Fecha y hora
          <input required type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} min={toLocalDateTime(new Date().toISOString())} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
        </label>
        <label className="block text-sm font-medium text-slate-300">
          Modalidad
          <select value={modality} onChange={(event) => setModality(event.target.value as InterviewModality)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400">
            <option value="virtual">Virtual</option>
            <option value="presencial">Presencial</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-300 sm:col-span-2">
          {modality === 'virtual' ? 'Enlace de videollamada (opcional)' : 'Dirección o lugar (opcional)'}
          <input type={modality === 'virtual' ? 'url' : 'text'} value={location} onChange={(event) => setLocation(event.target.value)} placeholder={modality === 'virtual' ? 'https://...' : 'Dirección de la entrevista'} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400" />
        </label>
        <label className="block text-sm font-medium text-slate-300 sm:col-span-2">
          Indicaciones adicionales (opcional)
          <textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={saving || !dateTime} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
          {saving ? 'Guardando...' : interview ? 'Guardar cambios' : 'Agendar entrevista'}
        </button>
        {interview && <button type="button" disabled={saving} onClick={() => { setEditing(false); setError('') }} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>}
      </div>
    </form>
  )
}
