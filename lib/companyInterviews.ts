export type InterviewModality = 'virtual' | 'presencial'

export interface CompanyInterview {
  id: string
  postulacion_id: string
  empresa_id: string
  estudiante_id: string
  fecha_hora: string
  modalidad: InterviewModality
  ubicacion: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export function interviewSchemaError(message: string, code?: string) {
  if (['42P01', 'PGRST200', 'PGRST205'].includes(code || '') || /entrevistas_postulacion/i.test(message)) {
    return `Supabase no encuentra la tabla de entrevistas. Ejecuta completo supabase/company_interviews.sql en el SQL Editor del mismo proyecto que usa la aplicación. Después ejecuta NOTIFY pgrst, 'reload schema'; y vuelve a cargar la página. Detalle: ${message}`
  }
  return message
}

export function isInterviewSchemaUnavailable(message: string, code?: string) {
  return ['42P01', 'PGRST200', 'PGRST205'].includes(code || '') || /entrevistas_postulacion/i.test(message)
}

export function toLocalDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function formatInterviewDate(value: string) {
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
