'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

const DOCUMENT_BUCKET = 'documentos_conexiones'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const FILE_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'text/plain': 'texto',
  'text/csv': 'CSV',
  'image/jpeg': 'imagen JPG',
  'image/png': 'imagen PNG',
}

type ConnectionRole = 'instructor' | 'empresa'
type WorkspaceTab = 'mensajes' | 'aprendices'

interface ConnectionWorkspaceProps {
  connection: {
    connection_id: string
    other_profile_id: string
    other_name: string
  }
  role: ConnectionRole
  userId: string
  onBack: () => void
}

interface ConnectionMessage {
  id: string
  sender_id: string
  contenido: string
  archivo_path: string | null
  archivo_nombre: string | null
  created_at: string
  signed_url: string | null
  download_error: string | null
}

interface SharedStudent {
  id: string
  estudiante_id: string
  nombre: string
  email: string
  cargo: string
  fecha_inicio: string | null
  fecha_fin: string | null
  estado: string
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatFileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-120)

  return cleaned || 'documento'
}

export default function ConnectionWorkspace({
  connection,
  role,
  userId,
  onBack,
}: ConnectionWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('mensajes')
  const [messages, setMessages] = useState<ConnectionMessage[]>([])
  const [students, setStudents] = useState<SharedStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [studentError, setStudentError] = useState('')
  const [notice, setNotice] = useState('')
  const [comment, setComment] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [refreshingMessages, setRefreshingMessages] = useState(false)
  const [studentEmail, setStudentEmail] = useState('')
  const [studentPosition, setStudentPosition] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [supervisor, setSupervisor] = useState('')
  const [linkingStudent, setLinkingStudent] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('conexiones_mensajes')
      .select('id, sender_id, contenido, archivo_path, archivo_nombre, created_at')
      .eq('connection_id', connection.connection_id)
      .order('created_at', { ascending: true })

    if (error) {
      throw new Error(`No se pudieron cargar los comentarios y documentos: ${error.message}`)
    }

    const rows = (data ?? []) as Omit<ConnectionMessage, 'signed_url' | 'download_error'>[]
    return Promise.all(rows.map(async (message) => {
      if (!message.archivo_path) return { ...message, signed_url: null, download_error: null }

      const { data: signedFile, error: signedUrlError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(message.archivo_path, 3600)

      if (signedUrlError) {
        return {
          ...message,
          signed_url: null,
          download_error: signedUrlError.message,
        }
      }

      return { ...message, signed_url: signedFile.signedUrl, download_error: null }
    }))
  }, [connection.connection_id])

  const fetchStudents = useCallback(async () => {
    const instructorId = role === 'instructor' ? userId : connection.other_profile_id
    const companyId = role === 'empresa' ? userId : connection.other_profile_id
    const { data: assignments, error: assignmentsError } = await supabase
      .from('tutor_estudiantes')
      .select('id, estudiante_id, cargo, fecha_inicio, fecha_fin, estado')
      .eq('tutor_id', instructorId)
      .eq('empresa_id', companyId)
      .order('created_at', { ascending: false })

    if (assignmentsError) {
      throw new Error(`No se pudieron cargar los aprendices vinculados: ${assignmentsError.message}`)
    }

    if (!assignments?.length) return []

    const studentIds = assignments.map((assignment) => assignment.estudiante_id)
    const { data: profiles, error: profilesError } = await supabase
      .from('perfiles')
      .select('id, nombre, email')
      .in('id', studentIds)

    if (profilesError) {
      throw new Error(`No se pudieron cargar los perfiles de los aprendices: ${profilesError.message}`)
    }

    const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
    return assignments.flatMap((assignment) => {
      const profile = profilesById.get(assignment.estudiante_id)
      if (!profile) return []

      return [{
        id: assignment.id,
        estudiante_id: assignment.estudiante_id,
        nombre: profile.nombre,
        email: profile.email,
        cargo: assignment.cargo,
        fecha_inicio: assignment.fecha_inicio,
        fecha_fin: assignment.fecha_fin,
        estado: assignment.estado,
      }]
    }) as SharedStudent[]
  }, [connection.other_profile_id, role, userId])

  const loadWorkspace = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setLoadError('')

    try {
      const [nextMessages, nextStudents] = await Promise.all([fetchMessages(), fetchStudents()])
      setMessages(nextMessages)
      setStudents(nextStudents)
    } catch (workspaceError) {
      setLoadError(workspaceError instanceof Error
        ? workspaceError.message
        : 'No se pudo cargar el espacio de colaboración.')
    } finally {
      setLoading(false)
    }
  }, [fetchMessages, fetchStudents])

  useEffect(() => {
    // Load the selected connection after it mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace()
  }, [loadWorkspace])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedComment = comment.trim()

    if (!trimmedComment && !selectedFile) {
      setMessageError('Escribe un comentario o adjunta un documento.')
      return
    }
    if (trimmedComment.length > 2000) {
      setMessageError('El comentario no puede superar los 2000 caracteres.')
      return
    }
    if (selectedFile && !FILE_TYPES[selectedFile.type]) {
      setMessageError('El formato no está permitido. Adjunta PDF, Word, Excel, PowerPoint, CSV, TXT, JPG o PNG.')
      return
    }
    if (selectedFile && selectedFile.size > MAX_FILE_SIZE) {
      setMessageError('El archivo supera el límite de 10 MB.')
      return
    }
    if (selectedFile && selectedFile.size === 0) {
      setMessageError('El archivo está vacío; selecciona otro documento.')
      return
    }

    setSending(true)
    setMessageError('')
    setNotice('')
    let uploadedPath: string | null = null
    let messageSaved = false

    try {
      if (selectedFile) {
        const path = `${connection.connection_id}/${userId}/${crypto.randomUUID()}-${safeFileName(selectedFile.name)}`
        const { error: uploadError } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .upload(path, selectedFile, { contentType: selectedFile.type, upsert: false })

        if (uploadError) throw new Error(`No se pudo subir el documento: ${uploadError.message}`)
        uploadedPath = path
      }

      const { error: insertError } = await supabase.from('conexiones_mensajes').insert({
        connection_id: connection.connection_id,
        sender_id: userId,
        contenido: trimmedComment,
        archivo_path: uploadedPath,
        archivo_nombre: selectedFile?.name ?? null,
        archivo_mime: selectedFile?.type ?? null,
        archivo_tamano: selectedFile?.size ?? null,
      })

      if (insertError) throw new Error(`No se pudo enviar el comentario: ${insertError.message}`)
      messageSaved = true
      setComment('')
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice('Comentario enviado.')
    } catch (sendError) {
      let errorMessage = sendError instanceof Error
        ? sendError.message
        : 'No se pudo enviar el comentario.'

      if (uploadedPath && !messageSaved) {
        const { error: cleanupError } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .remove([uploadedPath])
        if (cleanupError) {
          errorMessage += ` No se pudo limpiar el archivo que quedó pendiente: ${cleanupError.message}`
        }
      }

      setMessageError(errorMessage)
    } finally {
      setSending(false)
    }

    if (messageSaved) {
      try {
        setMessages(await fetchMessages())
      } catch (refreshError) {
        setMessageError(refreshError instanceof Error
          ? `El comentario se envió, pero no se pudo actualizar la lista: ${refreshError.message}`
          : 'El comentario se envió, pero no se pudo actualizar la lista.')
      }
    }
  }

  async function refreshMessages() {
    setRefreshingMessages(true)
    setMessageError('')
    try {
      setMessages(await fetchMessages())
    } catch (refreshError) {
      setMessageError(refreshError instanceof Error
        ? refreshError.message
        : 'No se pudieron actualizar los comentarios.')
    } finally {
      setRefreshingMessages(false)
    }
  }

  async function linkStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLinkingStudent(true)
    setStudentError('')
    setNotice('')

    try {
      const { data, error } = await supabase.rpc('link_instructor_company_student', {
        p_connection_id: connection.connection_id,
        p_student_email: studentEmail.trim(),
        p_position: studentPosition.trim(),
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_supervisor: supervisor.trim() || null,
      })

      if (error) {
        throw new Error(`No se pudo vincular el aprendiz: ${error.message}. Verifica que la migración de conexiones esté actualizada en Supabase.`)
      }
      if (!data?.length) throw new Error('La vinculación no devolvió un aprendiz.')

      setStudentEmail('')
      setStudentPosition('')
      setStartDate('')
      setEndDate('')
      setSupervisor('')
      setNotice('Aprendiz vinculado. La empresa ya puede ver este seguimiento.')

      try {
        setStudents(await fetchStudents())
      } catch (refreshError) {
        setStudentError(refreshError instanceof Error
          ? `El aprendiz quedó vinculado, pero no se pudo actualizar la lista: ${refreshError.message}`
          : 'El aprendiz quedó vinculado, pero no se pudo actualizar la lista.')
      }
    } catch (linkError) {
      setStudentError(linkError instanceof Error ? linkError.message : 'No se pudo vincular el aprendiz.')
    } finally {
      setLinkingStudent(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 text-sm font-semibold text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
      >
        Volver a conexiones
      </button>

      <div className="mb-6">
        <p className="text-sm font-semibold text-emerald-300">ESPACIO DE COLABORACIÓN</p>
        <h2 className="mt-2 text-2xl font-bold text-white">{connection.other_name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Comparte comentarios y documentos, y consulta el seguimiento del aprendiz en común.
        </p>
      </div>

      <div role="tablist" aria-label="Colaboración" className="mb-6 flex gap-2 border-b border-slate-700 pb-3">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mensajes'}
          onClick={() => setActiveTab('mensajes')}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
            activeTab === 'mensajes' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Comentarios y documentos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'aprendices'}
          onClick={() => setActiveTab('aprendices')}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
            activeTab === 'aprendices' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Aprendices en común ({students.length})
        </button>
      </div>

      {notice && (
        <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {loadError && (
        <div role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p>{loadError}</p>
          <button type="button" onClick={() => void loadWorkspace(true)} className="mt-2 font-semibold underline underline-offset-4">
            Reintentar
          </button>
        </div>
      )}

      {loading ? (
        <p className="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">Cargando colaboración...</p>
      ) : activeTab === 'mensajes' ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">Historial de comentarios</h3>
            <button
              type="button"
              disabled={refreshingMessages}
              onClick={() => void refreshMessages()}
              className="text-sm font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200 disabled:opacity-60"
            >
              {refreshingMessages ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
          <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4" aria-live="polite">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Todavía no hay comentarios ni documentos. Inicia la conversación.
              </p>
            ) : messages.map((message) => (
              <article key={message.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">
                    {message.sender_id === userId ? 'Tú' : connection.other_name}
                  </p>
                  <time className="text-xs text-slate-500" dateTime={message.created_at}>
                    {formatDate(message.created_at)}
                  </time>
                </div>
                {message.contenido && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                    {message.contenido}
                  </p>
                )}
                {message.archivo_path && message.archivo_nombre && message.signed_url && (
                  <a
                    href={message.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={message.archivo_nombre}
                    className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-200 underline underline-offset-4"
                  >
                    <span className="truncate">{message.archivo_nombre}</span>
                  </a>
                )}
                {message.archivo_path && !message.signed_url && (
                  <p role="alert" className="mt-3 text-sm text-rose-300">
                    No se pudo preparar la descarga de {message.archivo_nombre}: {message.download_error ?? 'enlace no disponible'}.
                  </p>
                )}
              </article>
            ))}
          </div>

          {messageError && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {messageError}
            </p>
          )}

          <form onSubmit={(event) => void sendMessage(event)} className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">
              Comentario
              <textarea
                rows={4}
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Escribe un comentario para la otra parte..."
                className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-emerald-400"
              />
              <span className="mt-1 block text-right text-xs text-slate-500">{comment.length}/2000</span>
            </label>

            <label className="block text-sm font-medium text-slate-300">
              Adjuntar documento (opcional, máximo 10 MB)
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-slate-600"
              />
            </label>
            {selectedFile && (
              <p className="text-xs text-slate-400">
                {selectedFile.name} · {formatFileSize(selectedFile.size)} · {FILE_TYPES[selectedFile.type] ?? selectedFile.type}
              </p>
            )}

            <button
              type="submit"
              disabled={sending}
              className="min-h-11 rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
            >
              {sending ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          {role === 'instructor' ? (
            <form onSubmit={(event) => void linkStudent(event)} className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
              <h3 className="text-lg font-semibold text-white">Vincular aprendiz a este seguimiento</h3>
              <p className="mt-1 text-sm text-slate-400">
                La asignación quedará asociada a esta empresa y será visible para ambas partes.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-300">
                  Correo del aprendiz
                  <input
                    type="email"
                    required
                    value={studentEmail}
                    onChange={(event) => setStudentEmail(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Cargo o área de práctica
                  <input
                    required
                    maxLength={120}
                    value={studentPosition}
                    onChange={(event) => setStudentPosition(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Fecha de inicio (opcional)
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Fecha de finalización (opcional)
                  <input
                    type="date"
                    min={startDate || undefined}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300 sm:col-span-2">
                  Supervisor empresarial (opcional)
                  <input
                    maxLength={120}
                    value={supervisor}
                    onChange={(event) => setSupervisor(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-400"
                  />
                </label>
              </div>
              {studentError && (
                <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  {studentError}
                </p>
              )}
              <button
                type="submit"
                disabled={linkingStudent}
                className="mt-4 min-h-11 rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
              >
                {linkingStudent ? 'Vinculando...' : 'Vincular aprendiz'}
              </button>
            </form>
          ) : (
            <p className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
              Los aprendices se vinculan desde la cuenta del instructor. Aquí verás los registros compartidos en esta conexión.
            </p>
          )}

          {studentError && role === 'empresa' && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {studentError}
            </p>
          )}

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-white">Aprendices en seguimiento ({students.length})</h3>
              <button
                type="button"
                onClick={() => void loadWorkspace(true)}
                className="text-sm font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
              >
                Actualizar lista
              </button>
            </div>
            {students.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-400">
                Aún no hay aprendices vinculados a esta conexión.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {students.map((student) => (
                  <article key={student.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                    <h4 className="font-semibold text-white">{student.nombre}</h4>
                    <a href={`mailto:${student.email}`} className="mt-1 inline-block text-sm text-emerald-300 underline underline-offset-4">
                      {student.email}
                    </a>
                    <p className="mt-3 text-sm text-slate-300">{student.cargo}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {student.fecha_inicio || 'Sin fecha de inicio'} – {student.fecha_fin || 'Sin fecha de finalización'}
                    </p>
                    <span className="mt-3 inline-block rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                      {student.estado === 'en_curso' ? 'En seguimiento' : student.estado}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
