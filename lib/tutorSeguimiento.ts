import { supabase } from '@/lib/supabase'

export type EstadoPractica = 'en_curso' | 'finalizada'
export type ResultadoEvaluacion = 'aprobada' | 'reprobada'

export interface EstudianteAsignado {
  id: string
  tutor_id: string
  estudiante_id: string
  empresa: string
  cargo: string
  fecha_inicio: string | null
  fecha_fin: string | null
  estado: EstadoPractica
  created_at: string
  nombre: string
  email: string
}

export interface Evaluacion {
  id: string
  estudiante_asignado_id: string
  calificacion: number
  retroalimentacion: string
  resultado: ResultadoEvaluacion
  evidencia_path: string | null
  created_at: string
}

export const EVIDENCE_BUCKET = 'evidencias_evaluaciones'
export const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024
export const ALLOWED_EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export async function getTutorId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(`No se pudo verificar la sesión: ${error.message}`)
  if (!data.user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.')
  return data.user.id
}

export async function getAssignedStudents(tutorId: string): Promise<EstudianteAsignado[]> {
  const { data, error } = await supabase
    .from('tutor_estudiantes')
    .select('id, tutor_id, estudiante_id, empresa, cargo, fecha_inicio, fecha_fin, estado, created_at')
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes("public.tutor_estudiantes")) {
      throw new Error(
        "Supabase no encuentra la tabla tutor_estudiantes. Ejecuta supabase/tutor_module.sql en el SQL Editor. Si ya la ejecutaste, actualiza el schema cache con: NOTIFY pgrst, 'reload schema';",
      )
    }
    throw new Error(`No se pudieron cargar los estudiantes: ${error.message}`)
  }

  const assignments = (data || []) as Omit<EstudianteAsignado, 'nombre' | 'email'>[]
  if (assignments.length === 0) return []

  const studentIds = [...new Set(assignments.map((assignment) => assignment.estudiante_id))]
  const { data: profiles, error: profilesError } = await supabase
    .from('perfiles')
    .select('id, nombre, email')
    .in('id', studentIds)

  if (profilesError) throw new Error(`No se pudieron cargar los perfiles de estudiantes: ${profilesError.message}`)

  const profilesById = new Map(
    ((profiles || []) as { id: string; nombre: string; email: string }[])
      .map((profile) => [profile.id, profile]),
  )

  return assignments.flatMap((assignment) => {
    const profile = profilesById.get(assignment.estudiante_id)
    return profile ? [{ ...assignment, nombre: profile.nombre, email: profile.email }] : []
  })
}

export async function getEvaluations(assignmentIds: string[]): Promise<Evaluacion[]> {
  if (assignmentIds.length === 0) return []

  const { data, error } = await supabase
    .from('tutor_evaluaciones')
    .select('id, estudiante_asignado_id, calificacion, retroalimentacion, resultado, evidencia_path, created_at')
    .in('estudiante_asignado_id', assignmentIds)
    .order('created_at', { ascending: false })

  if (error) {
    const missingEvidenceColumn =
      error.code === '42703' ||
      error.code === 'PGRST204' ||
      (error.message.includes('evidencia_path') &&
        (error.message.includes('does not exist') || error.message.includes('schema cache')))

    if (missingEvidenceColumn) {
      throw new Error(
        'Falta la columna evidencia_path en tutor_evaluaciones. Ejecuta supabase/tutor_evidence_migration.sql en el SQL Editor de Supabase y vuelve a cargar la página.',
      )
    }

    throw new Error(`No se pudieron cargar las evaluaciones: ${error.message}`)
  }
  return (data || []) as Evaluacion[]
}

export async function uploadEvidence(file: File, assignmentId: string): Promise<string> {
  if (!ALLOWED_EVIDENCE_TYPES.includes(file.type)) {
    throw new Error('El archivo debe ser un PDF, JPG, PNG o WEBP.')
  }
  if (file.size > MAX_EVIDENCE_SIZE) {
    throw new Error('El archivo supera el límite de 10 MB.')
  }

  const tutorId = await getTutorId()
  const safeName = file.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${tutorId}/${assignmentId}/${crypto.randomUUID()}-${safeName}`
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw new Error(`No se pudo subir la evidencia: ${error.message}`)
  return path
}

export async function getEvidenceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, 60 * 60)

  if (error) throw new Error(`No se pudo abrir la evidencia: ${error.message}`)
  return data.signedUrl
}

export async function removeEvidence(path: string): Promise<void> {
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path])
  if (error) throw new Error(`No se pudo eliminar el archivo adjunto: ${error.message}`)
}

export function readableDate(date: string | null): string {
  if (!date) return 'Sin definir'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export function statusLabel(status: EstadoPractica): string {
  return status === 'en_curso' ? 'En curso' : 'Finalizada'
}
