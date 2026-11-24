export type RolUsuario = 'aprendiz' | 'instructor' | 'empresa' | 'admin'
export type EstadoCuenta = 'pendiente' | 'activo' | 'rechazado' | 'suspendido'
export type RolSolicitado = 'instructor' | 'empresa' | null

export interface PerfilUsuario {
  id: string
  nombre: string
  email: string
  rol: RolUsuario
  estado_cuenta: EstadoCuenta
  telefono: string
  documento_identidad: string | null
  centro_formacion: string | null
  nombre_empresa: string | null
  rol_solicitado: RolSolicitado
  foto_perfil_path?: string | null
}
