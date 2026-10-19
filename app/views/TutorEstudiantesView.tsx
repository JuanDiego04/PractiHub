'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  getAssignedStudents,
  getTutorId,
  readableDate,
  statusLabel,
  type EstudianteAsignado,
  type EstadoPractica,
} from '@/lib/tutorSeguimiento'
import { supabase } from '@/lib/supabase'

function StudentListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Cargando estudiantes">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="animate-pulse rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="h-4 w-1/3 rounded bg-slate-700" />
          <div className="mt-4 h-3 w-2/3 rounded bg-slate-700/70" />
          <div className="mt-3 h-3 w-1/2 rounded bg-slate-700/70" />
        </div>
      ))}
    </div>
  )
}

export default function TutorEstudiantesView() {
  const [students, setStudents] = useState<EstudianteAsignado[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const [email, setEmail] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [cargo, setCargo] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  const loadStudents = useCallback(async () => {
    try {
      const tutorId = await getTutorId()
      const assignedStudents = await getAssignedStudents(tutorId)
      setStudents(assignedStudents)
      setError('')
      setLoadFailed(false)
    } catch (loadError) {
      setLoadFailed(true)
      setError(loadError instanceof Error ? loadError.message : 'Ocurrió un error inesperado.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // State updates happen after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStudents()
  }, [loadStudents])

  async function handleAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setFormMessage('')

    try {
      const { data, error: insertError } = await supabase.rpc('tutor_assign_student', {
        p_email: email.trim(),
        p_empresa: empresa.trim(),
        p_cargo: cargo.trim(),
        p_fecha_inicio: fechaInicio || null,
        p_fecha_fin: fechaFin || null,
      })

      if (insertError) throw new Error(`No se pudo asignar al estudiante: ${insertError.message}`)

      const assigned = (data || []) as { estudiante_id: string; nombre: string }[]
      if (!assigned[0]) throw new Error('La asignación se guardó, pero Supabase no devolvió el perfil del estudiante.')

      setFormMessage(`${assigned[0].nombre} fue agregado a tu lista de seguimiento.`)
      setEmail('')
      setEmpresa('')
      setCargo('')
      setFechaInicio('')
      setFechaFin('')
      await loadStudents()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ocurrió un error inesperado.')
    } finally {
      setSaving(false)
    }
  }

  async function togglePracticeStatus(student: EstudianteAsignado) {
    const nextStatus: EstadoPractica = student.estado === 'en_curso' ? 'finalizada' : 'en_curso'
    setUpdatingId(student.id)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('tutor_estudiantes')
        .update({ estado: nextStatus })
        .eq('id', student.id)
        .eq('tutor_id', student.tutor_id)

      if (updateError) throw new Error(`No se pudo actualizar el estado: ${updateError.message}`)
      await loadStudents()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Ocurrió un error inesperado.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · SEGUIMIENTO</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Estudiantes asignados</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Registra aprendices y consulta la información de sus prácticas profesionales.
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 sm:flex-row sm:items-center sm:justify-between">
            <p>{error}</p>
            <button type="button" onClick={() => { setLoading(true); void loadStudents() }} className="shrink-0 font-semibold underline underline-offset-4">
              Reintentar
            </button>
          </div>
        )}
        {formMessage && (
          <p role="status" className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {formMessage}
          </p>
        )}

        <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Agregar aprendiz</h2>
            <p className="mt-1 text-sm text-slate-400">El aprendiz debe tener una cuenta con rol de estudiante en PractiHub.</p>
          </div>
          <form onSubmit={handleAddStudent} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-medium text-slate-300">
              Correo del estudiante
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="aprendiz@correo.com"
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Empresa de práctica
              <input
                required
                value={empresa}
                onChange={(event) => setEmpresa(event.target.value)}
                placeholder="Nombre de la empresa"
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Cargo u oferta
              <input
                required
                value={cargo}
                onChange={(event) => setCargo(event.target.value)}
                placeholder="Ej. Auxiliar de desarrollo"
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Fecha de inicio
              <input
                type="date"
                value={fechaInicio}
                onChange={(event) => setFechaInicio(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Fecha de finalización (opcional)
              <input
                type="date"
                min={fechaInicio || undefined}
                value={fechaFin}
                onChange={(event) => setFechaFin(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? 'Agregando aprendiz...' : 'Agregar a seguimiento'}
              </button>
            </div>
          </form>
        </section>

        <section aria-labelledby="assigned-students-heading">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 id="assigned-students-heading" className="text-xl font-semibold text-white">Tu lista de seguimiento</h2>
              {!loading && <p className="mt-1 text-sm text-slate-400">{students.length} estudiante{students.length === 1 ? '' : 's'}</p>}
            </div>
          </div>

          {loading ? (
            <StudentListSkeleton />
          ) : loadFailed ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/60 px-6 py-10 text-center">
              <p className="font-medium text-slate-200">No se pudo cargar la lista de estudiantes.</p>
              <button type="button" onClick={() => { setLoading(true); void loadStudents() }} className="mt-3 text-sm font-semibold text-emerald-300 underline underline-offset-4">
                Reintentar
              </button>
            </div>
          ) : students.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/60 px-6 py-14 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-700/70 text-xl text-emerald-300" aria-hidden="true">＋</span>
              <h3 className="mt-4 text-lg font-semibold text-white">Aún no tienes aprendices asignados</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Agrega un aprendiz usando el correo de su cuenta para comenzar a registrar su práctica y hacer seguimiento.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {students.map((student) => (
                <article key={student.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold text-white">{student.nombre}</h3>
                      <p className="mt-1 truncate text-sm text-slate-400">{student.email}</p>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                      student.estado === 'en_curso'
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : 'bg-slate-700 text-slate-300'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${student.estado === 'en_curso' ? 'bg-emerald-400' : 'bg-slate-400'}`} />
                      {statusLabel(student.estado)}
                    </span>
                  </div>
                  <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-700 pt-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Empresa</dt>
                      <dd className="mt-1 text-sm text-slate-200">{student.empresa}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Oferta / cargo</dt>
                      <dd className="mt-1 text-sm text-slate-200">{student.cargo}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Inicio</dt>
                      <dd className="mt-1 text-sm text-slate-200">{readableDate(student.fecha_inicio)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Finalización</dt>
                      <dd className="mt-1 text-sm text-slate-200">{readableDate(student.fecha_fin)}</dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex flex-col gap-3 border-t border-slate-700 pt-4 sm:flex-row">
                    <Link
                      href={`/estudiantes/${student.id}`}
                      className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
                    >
                      Ver detalles
                    </Link>
                    <button
                      type="button"
                      disabled={updatingId === student.id}
                      onClick={() => void togglePracticeStatus(student)}
                      className="min-h-10 rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {updatingId === student.id
                        ? 'Actualizando...'
                        : student.estado === 'en_curso' ? 'Marcar finalizada' : 'Reabrir práctica'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
