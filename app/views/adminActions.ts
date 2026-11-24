'use server'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { EstadoCuenta, RolUsuario } from '@/lib/perfil'

const roles: RolUsuario[] = ['aprendiz', 'instructor', 'empresa', 'admin']
const accountStates: EstadoCuenta[] = ['pendiente', 'activo', 'rechazado', 'suspendido']

interface PerfilActualizable {
  nombre: string
  email: string
  rol: RolUsuario
  estado_cuenta: EstadoCuenta
  telefono: string
  documento_identidad: string | null
  centro_formacion: string | null
  nombre_empresa: string | null
}

interface AdminInvitation {
  nombre: string
  email: string
  telefono: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readAdminInvitation(value: unknown): AdminInvitation | null {
  if (!isRecord(value)) return null

  const { nombre, email, telefono } = value
  if (
    typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 100 ||
    typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof telefono !== 'string' || !/^[0-9]{10}$/.test(telefono.trim())
  ) {
    return null
  }

  return {
    nombre: nombre.trim(),
    email: email.trim().toLowerCase(),
    telefono: telefono.trim(),
  }
}

function readProfilePayload(value: unknown): PerfilActualizable | null {
  if (!isRecord(value)) return null

  const { nombre, email, rol, estado_cuenta, telefono } = value
  const nullableFields = ['documento_identidad', 'centro_formacion', 'nombre_empresa'] as const
  if (
    typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 100 ||
    typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof rol !== 'string' || !roles.includes(rol as RolUsuario) ||
    typeof estado_cuenta !== 'string' || !accountStates.includes(estado_cuenta as EstadoCuenta) ||
    typeof telefono !== 'string' || !/^[0-9]{10}$/.test(telefono.trim()) ||
    nullableFields.some((field) => value[field] !== null && typeof value[field] !== 'string')
  ) {
    return null
  }

  return {
    nombre: nombre.trim(),
    email: email.trim().toLowerCase(),
    rol: rol as RolUsuario,
    estado_cuenta: estado_cuenta as EstadoCuenta,
    telefono: telefono.trim(),
    documento_identidad: typeof value.documento_identidad === 'string' ? value.documento_identidad.trim() || null : null,
    centro_formacion: typeof value.centro_formacion === 'string' ? value.centro_formacion.trim() || null : null,
    nombre_empresa: typeof value.nombre_empresa === 'string' ? value.nombre_empresa.trim() || null : null,
  }
}

async function getAdminUserId() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Se requiere una sesión administrativa válida.' }

  const { data: profile, error: profileError } = await supabase
    .from('perfiles')
    .select('rol, estado_cuenta')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) return { error: `No se pudieron verificar los permisos: ${profileError.message}` }
  if (profile?.rol !== 'admin' || profile.estado_cuenta !== 'activo') return { error: 'Acceso denegado.' }

  return { userId: user.id }
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function getAuthCallbackUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  try {
    const url = new URL(siteUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return new URL('/auth/confirm', url).toString()
  } catch {
    return null
  }
}

export async function adminInviteAdmin(value: unknown): Promise<{ error?: string }> {
  const adminUser = await getAdminUserId()
  if ('error' in adminUser) return { error: adminUser.error }

  const invitation = readAdminInvitation(value)
  if (!invitation) return { error: 'Ingresa un nombre, correo y teléfono válidos.' }

  const serviceClient = createServiceClient()
  if (!serviceClient) {
    return { error: 'La invitación administrativa requiere configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }
  }

  const redirectTo = getAuthCallbackUrl()
  if (!redirectTo) {
    return { error: 'Configura NEXT_PUBLIC_SITE_URL con la URL pública de PractiHub para enviar invitaciones.' }
  }

  const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo,
    data: {
      account_type: 'aprendiz',
      nombre: invitation.nombre,
      telefono: invitation.telefono,
    },
  })
  if (inviteError) return { error: `No se pudo enviar la invitación: ${inviteError.message}` }
  if (!inviteData.user) {
    return { error: 'Supabase no devolvió el usuario invitado. Verifica Authentication → Users antes de volver a intentarlo.' }
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('perfiles')
    .update({ rol: 'admin', estado_cuenta: 'activo', rol_solicitado: null })
    .eq('id', inviteData.user.id)
    .select('id')
    .maybeSingle()

  if (profileError || !profile) {
    const reason = profileError
      ? `No se pudo asignar el rol de administrador: ${profileError.message}`
      : 'La invitación se creó, pero no se encontró el perfil para asignarle el rol de administrador.'
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(inviteData.user.id)
    return {
      error: cleanupError
        ? `${reason} Tampoco se pudo cancelar la invitación (${cleanupError.message}); elimina esa cuenta desde Supabase Auth antes de continuar.`
        : `${reason} Se canceló la cuenta invitada; puedes corregir la causa y volver a invitar.`,
    }
  }

  return {}
}

export async function adminUpdateUser(userId: string, value: unknown): Promise<{ error?: string }> {
  const adminUser = await getAdminUserId()
  if ('error' in adminUser) return { error: adminUser.error }

  const profile = readProfilePayload(value)
  if (!profile) return { error: 'Los datos del perfil no son válidos.' }

  const serviceClient = createServiceClient()
  if (!serviceClient) {
    return { error: 'La edición administrativa requiere configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }
  }

  const { data: currentProfile, error: loadError } = await serviceClient
    .from('perfiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  if (loadError) return { error: `No se pudo consultar el perfil: ${loadError.message}` }
  if (!currentProfile) return { error: 'No se encontró el perfil solicitado.' }

  if (currentProfile.email !== profile.email) {
    const { error: emailError } = await serviceClient.auth.admin.updateUserById(userId, {
      email: profile.email,
      email_confirm: true,
    })
    if (emailError) return { error: `No se pudo actualizar el correo de autenticación: ${emailError.message}` }
  }

  const { data, error: updateError } = await serviceClient
    .from('perfiles')
    .update(profile)
    .eq('id', userId)
    .select('id')
    .maybeSingle()
  if (updateError) return { error: `No se pudo actualizar el perfil: ${updateError.message}` }
  if (!data) return { error: 'No se actualizó ningún perfil.' }

  return {}
}

export async function adminDeleteUser(userId: string): Promise<{ error?: string; message?: string }> {
  const adminUser = await getAdminUserId()
  if ('error' in adminUser) return { error: adminUser.error }
  if (userId === adminUser.userId) {
    return { error: 'No puedes eliminar la cuenta administrativa con la que iniciaste sesión.' }
  }

  const serviceClient = createServiceClient()
  if (!serviceClient) {
    return { error: 'La eliminación administrativa requiere configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }
  }

  const { error } = await serviceClient.auth.admin.deleteUser(userId)
  if (error) {
    const userNotFound = error.status === 404 || error.message.toLowerCase().includes('user not found')
    if (!userNotFound) return { error: `No se pudo eliminar la cuenta: ${error.message}` }

    const { data: deletedProfile, error: profileDeleteError } = await serviceClient
      .from('perfiles')
      .delete()
      .eq('id', userId)
      .select('id')
      .maybeSingle()

    if (profileDeleteError) {
      return { error: `Auth no encontró la cuenta y no se pudo limpiar el perfil: ${profileDeleteError.message}` }
    }

    return {
      message: deletedProfile
        ? 'La cuenta Auth ya no existía; se eliminó el perfil huérfano.'
        : 'La cuenta ya no existía en Auth ni en perfiles; se actualizará el directorio.',
    }
  }

  return {}
}
