'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { EstadoCuenta, PerfilUsuario, RolUsuario } from '@/lib/perfil'
import { adminDeleteUser, adminInviteAdmin, adminUpdateUser } from '@/app/views/adminActions'

type RoleFilter = 'todos' | RolUsuario
type EditableProfile = Pick<
  PerfilUsuario,
  'nombre' | 'email' | 'rol' | 'estado_cuenta' | 'telefono' | 'documento_identidad' | 'centro_formacion' | 'nombre_empresa'
>

const roleLabels: Record<RolUsuario, string> = {
  aprendiz: 'Aprendiz',
  instructor: 'Instructor',
  empresa: 'Empresa',
  admin: 'Administrador',
}

const statusLabels: Record<EstadoCuenta, string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  rechazado: 'Rechazado',
  suspendido: 'Suspendido',
}

const statusStyles: Record<EstadoCuenta, string> = {
  pendiente: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  activo: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  rechazado: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  suspendido: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
}

const roleFilters: { value: RoleFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'aprendiz', label: 'Aprendices' },
  { value: 'instructor', label: 'Instructores' },
  { value: 'empresa', label: 'Empresas' },
  { value: 'admin', label: 'Admins' },
]

function profileForm(profile: PerfilUsuario): EditableProfile {
  return {
    nombre: profile.nombre,
    email: profile.email,
    rol: profile.rol,
    estado_cuenta: profile.estado_cuenta,
    telefono: profile.telefono,
    documento_identidad: profile.documento_identidad,
    centro_formacion: profile.centro_formacion,
    nombre_empresa: profile.nombre_empresa,
  }
}

export default function AdminDashboardView() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<PerfilUsuario[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<RoleFilter>('todos')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState<PerfilUsuario | null>(null)
  const [editForm, setEditForm] = useState<EditableProfile | null>(null)
  const [rejectingProfile, setRejectingProfile] = useState<PerfilUsuario | null>(null)
  const [deletingProfile, setDeletingProfile] = useState<PerfilUsuario | null>(null)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ nombre: '', email: '', telefono: '' })
  const [invitingAdmin, setInvitingAdmin] = useState(false)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        setError(`No se pudo verificar el acceso administrativo: ${authError?.message || 'Inicia sesión nuevamente.'}`)
        router.replace('/admin/login')
        return
      }
      setCurrentUserId(user.id)

      const { data, error: profilesError } = await supabase
        .from('perfiles')
        .select('id, nombre, email, rol, estado_cuenta, telefono, documento_identidad, centro_formacion, nombre_empresa, rol_solicitado, foto_perfil_path')
        .order('nombre')

      if (profilesError) {
        setError(`No se pudo cargar el directorio de usuarios: ${profilesError.message}`)
      } else {
        setProfiles((data || []) as PerfilUsuario[])
      }
    } catch (loadFailure) {
      setError(loadFailure instanceof Error ? `No se pudo cargar el directorio de usuarios: ${loadFailure.message}` : 'No se pudo cargar el directorio de usuarios.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    // Load the admin directory after client hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfiles()
  }, [loadProfiles])

  const pendingProfiles = useMemo(
    () => profiles.filter((profile) => profile.estado_cuenta === 'pendiente' && profile.rol_solicitado !== null),
    [profiles],
  )

  const filteredProfiles = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return profiles.filter((profile) => {
      const matchesRole = filter === 'todos' || profile.rol === filter
      const matchesSearch = !normalizedSearch ||
        profile.nombre.toLocaleLowerCase().includes(normalizedSearch) ||
        profile.email.toLocaleLowerCase().includes(normalizedSearch)
      return matchesRole && matchesSearch
    })
  }, [filter, profiles, search])

  const metrics = useMemo(() => ({
    total: profiles.length,
    pending: pendingProfiles.length,
    learners: profiles.filter((profile) => profile.rol === 'aprendiz' && profile.estado_cuenta === 'activo').length,
    instructors: profiles.filter((profile) => profile.rol === 'instructor').length,
    companies: profiles.filter((profile) => profile.rol === 'empresa').length,
  }), [pendingProfiles.length, profiles])

  async function approveRequest(profile: PerfilUsuario) {
    if (!profile.rol_solicitado) {
      setError('La solicitud no tiene un rol pendiente para asignar.')
      return
    }

    setActionId(profile.id)
    setError('')
    setMessage('')
    try {
      const { data, error: updateError } = await supabase
        .from('perfiles')
        .update({ rol: profile.rol_solicitado, estado_cuenta: 'activo' })
        .eq('id', profile.id)
        .eq('estado_cuenta', 'pendiente')
        .select('id')
        .maybeSingle()

      if (updateError || !data) {
        setError(`No se pudo aprobar la solicitud: ${updateError?.message || 'El perfil ya no está pendiente.'}`)
      } else {
        setMessage(`Solicitud aprobada. Se asignó el rol de ${roleLabels[profile.rol_solicitado]}.`)
        await loadProfiles()
      }
    } catch (approvalFailure) {
      setError(approvalFailure instanceof Error ? `No se pudo aprobar la solicitud: ${approvalFailure.message}` : 'No se pudo aprobar la solicitud.')
    } finally {
      setActionId(null)
    }
  }

  async function rejectRequest() {
    if (!rejectingProfile) return
    const profile = rejectingProfile
    setActionId(profile.id)
    setError('')
    setMessage('')
    try {
      const { data, error: updateError } = await supabase
        .from('perfiles')
        .update({ estado_cuenta: 'rechazado' })
        .eq('id', profile.id)
        .eq('estado_cuenta', 'pendiente')
        .select('id')
        .maybeSingle()

      if (updateError || !data) {
        setError(`No se pudo rechazar la solicitud: ${updateError?.message || 'El perfil ya no está pendiente.'}`)
      } else {
        setMessage(`Se rechazó la solicitud de ${profile.nombre}.`)
        setRejectingProfile(null)
        await loadProfiles()
      }
    } catch (rejectionFailure) {
      setError(rejectionFailure instanceof Error ? `No se pudo rechazar la solicitud: ${rejectionFailure.message}` : 'No se pudo rechazar la solicitud.')
    } finally {
      setActionId(null)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingProfile || !editForm) return
    setActionId(editingProfile.id)
    setError('')
    setMessage('')

    try {
      const result = await adminUpdateUser(editingProfile.id, editForm)
      if (result.error) throw new Error(result.error)
      setMessage(`Se actualizaron los datos de ${editForm.nombre}.`)
      setEditingProfile(null)
      setEditForm(null)
      await loadProfiles()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo actualizar el perfil.')
    } finally {
      setActionId(null)
    }
  }

  async function deleteProfile() {
    if (!deletingProfile) return
    const profile = deletingProfile
    setActionId(profile.id)
    setError('')
    setMessage('')

    try {
      const result = await adminDeleteUser(profile.id)
      if (result.error) throw new Error(result.error)
      setDeletingProfile(null)
      await loadProfiles()
      setMessage(result.message || `Se eliminó la cuenta de ${profile.nombre}.`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la cuenta.')
    } finally {
      setActionId(null)
    }
  }

  async function inviteAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInvitingAdmin(true)
    setError('')
    setMessage('')

    try {
      const result = await adminInviteAdmin(inviteForm)
      if (result.error) throw new Error(result.error)

      const invitedEmail = inviteForm.email.trim()
      setInviteModalOpen(false)
      setInviteForm({ nombre: '', email: '', telefono: '' })
      await loadProfiles()
      setMessage(`Se envió una invitación administrativa a ${invitedEmail}.`)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'No se pudo invitar al administrador.')
    } finally {
      setInvitingAdmin(false)
    }
  }

  async function signOut() {
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        setError(`No se pudo cerrar la sesión: ${signOutError.message}`)
        return
      }
      router.replace('/admin/login')
    } catch (signOutFailure) {
      setError(signOutFailure instanceof Error ? `No se pudo cerrar la sesión: ${signOutFailure.message}` : 'No se pudo cerrar la sesión.')
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-700 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Panel Administrativo • PractiHub</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Gestión de usuarios</h1>
            <p className="mt-2 text-sm text-slate-400">Administra solicitudes, roles y acceso a la plataforma.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setInviteModalOpen(true)} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
              Invitar administrador
            </button>
            <button type="button" onClick={() => void signOut()} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-rose-500/60 hover:text-rose-300">
              Cerrar sesión
            </button>
          </div>
        </header>

        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}

        <section aria-label="Indicadores generales" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Usuarios totales', value: metrics.total, tone: 'text-white' },
            { label: 'Solicitudes pendientes', value: metrics.pending, tone: 'text-amber-300' },
            { label: 'Aprendices activos', value: metrics.learners, tone: 'text-emerald-300' },
            { label: 'Instructores', value: metrics.instructors, tone: 'text-sky-300' },
            { label: 'Empresas', value: metrics.companies, tone: 'text-violet-300' },
          ].map((metric) => (
            <article key={metric.label} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-sm text-slate-400">{metric.label}</p>
              <p className={`mt-2 text-3xl font-bold ${metric.tone}`}>{metric.value}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="pending-title" className="mb-10 rounded-2xl border border-amber-500/25 bg-slate-800 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-300">Bandeja de verificación</p>
              <h2 id="pending-title" className="mt-1 text-xl font-bold text-white">Solicitudes pendientes</h2>
            </div>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-200">{pendingProfiles.length} pendientes</span>
          </div>

          {pendingProfiles.length === 0 ? (
            <p className="mt-5 rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">No hay solicitudes pendientes de revisión.</p>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {pendingProfiles.map((profile) => (
                <article key={profile.id} className="rounded-xl border border-amber-400/20 bg-slate-900/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">{profile.nombre}</h3>
                      <p className="mt-1 text-sm text-amber-200">Solicita rol de {profile.rol_solicitado ? roleLabels[profile.rol_solicitado] : 'no definido'}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[profile.estado_cuenta]}`}>{statusLabels[profile.estado_cuenta]}</span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">Correo</dt><dd className="mt-1 break-all text-slate-200">{profile.email}</dd></div>
                    <div><dt className="text-xs text-slate-500">Teléfono</dt><dd className="mt-1 text-slate-200">{profile.telefono}</dd></div>
                    <div><dt className="text-xs text-slate-500">Documento</dt><dd className="mt-1 text-slate-200">{profile.documento_identidad || 'No informado'}</dd></div>
                    {profile.rol_solicitado === 'instructor'
                      ? <div><dt className="text-xs text-slate-500">Centro de formación</dt><dd className="mt-1 text-slate-200">{profile.centro_formacion || 'No informado'}</dd></div>
                      : <div><dt className="text-xs text-slate-500">Empresa</dt><dd className="mt-1 text-slate-200">{profile.nombre_empresa || 'No informada'}</dd></div>}
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" disabled={actionId === profile.id || !profile.rol_solicitado} onClick={() => void approveRequest(profile)} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-50">
                      Aprobar y asignar rol
                    </button>
                    <button type="button" disabled={actionId === profile.id} onClick={() => setRejectingProfile(profile)} className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50">
                      Rechazar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="directory-title" className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">Directorio global</p>
              <h2 id="directory-title" className="mt-1 text-xl font-bold text-white">Usuarios y perfiles</h2>
            </div>
            <label className="w-full text-sm text-slate-400 lg:max-w-sm">
              Buscar por nombre o correo
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar..." className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
            </label>
          </div>

          <div role="tablist" aria-label="Filtrar usuarios por rol" className="mt-5 flex gap-2 overflow-x-auto border-b border-slate-700 pb-3">
            {roleFilters.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${filter === item.value ? 'bg-emerald-500 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p role="status" className="py-10 text-center text-sm text-slate-400">Cargando usuarios...</p>
          ) : filteredProfiles.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No hay perfiles que coincidan con los filtros.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-700">
                    <th scope="col" className="px-3 py-3">Nombre y correo</th>
                    <th scope="col" className="px-3 py-3">Rol</th>
                    <th scope="col" className="px-3 py-3">Estado</th>
                    <th scope="col" className="px-3 py-3">Teléfono</th>
                    <th scope="col" className="px-3 py-3">Centro / Empresa</th>
                    <th scope="col" className="px-3 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/70">
                  {filteredProfiles.map((profile) => (
                    <tr key={profile.id} className="align-top">
                      <td className="px-3 py-4">
                        <p className="font-semibold text-white">{profile.nombre}</p>
                        <p className="mt-1 max-w-xs break-all text-xs text-slate-400">{profile.email}</p>
                      </td>
                      <td className="px-3 py-4 text-slate-200">{roleLabels[profile.rol] || profile.rol}</td>
                      <td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[profile.estado_cuenta]}`}>{statusLabels[profile.estado_cuenta]}</span></td>
                      <td className="px-3 py-4 text-slate-300">{profile.telefono}</td>
                      <td className="px-3 py-4 text-slate-300">{profile.centro_formacion || profile.nombre_empresa || '—'}</td>
                      <td className="px-3 py-4">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setEditingProfile(profile); setEditForm(profileForm(profile)) }} className="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-400 hover:text-emerald-300">Editar</button>
                          <button type="button" disabled={profile.id === currentUserId} onClick={() => { setError(''); setDeletingProfile(profile) }} className="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Mostrando {filteredProfiles.length} de {profiles.length} perfiles.</p>
        </section>
      </div>

      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="invite-admin-title" className="my-auto w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h2 id="invite-admin-title" className="text-xl font-bold text-white">Invitar administrador</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Se enviará un enlace al correo indicado. La cuenta recibirá el rol administrativo activo; no se crea desde el registro público.</p>
            <form onSubmit={(event) => void inviteAdmin(event)} className="mt-5 space-y-4">
              <label className="block text-sm text-slate-300">Nombre completo
                <input required minLength={2} maxLength={100} value={inviteForm.nombre} onChange={(event) => setInviteForm({ ...inviteForm, nombre: event.target.value })} autoComplete="name" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="block text-sm text-slate-300">Correo
                <input required type="email" value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="block text-sm text-slate-300">Teléfono
                <input required type="tel" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={inviteForm.telefono} onChange={(event) => setInviteForm({ ...inviteForm, telefono: event.target.value.replace(/\D/g, '').slice(0, 10) })} autoComplete="tel" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={invitingAdmin} onClick={() => setInviteModalOpen(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={invitingAdmin} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-50">{invitingAdmin ? 'Enviando...' : 'Enviar invitación'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingProfile && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" className="my-auto w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h2 id="edit-profile-title" className="text-xl font-bold text-white">Editar perfil</h2>
            <form onSubmit={(event) => void saveProfile(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300">Nombre completo
                <input required minLength={2} maxLength={100} value={editForm.nombre} onChange={(event) => setEditForm({ ...editForm, nombre: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="text-sm text-slate-300">Correo
                <input required type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="text-sm text-slate-300">Teléfono
                <input required type="tel" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={editForm.telefono} onChange={(event) => setEditForm({ ...editForm, telefono: event.target.value.replace(/\D/g, '').slice(0, 10) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="text-sm text-slate-300">Documento / NIT
                <input value={editForm.documento_identidad || ''} onChange={(event) => setEditForm({ ...editForm, documento_identidad: event.target.value || null })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="text-sm text-slate-300">Rol
                <select value={editForm.rol} onChange={(event) => setEditForm({ ...editForm, rol: event.target.value as RolUsuario })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none">
                  {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">Estado de cuenta
                <select value={editForm.estado_cuenta} onChange={(event) => setEditForm({ ...editForm, estado_cuenta: event.target.value as EstadoCuenta })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none">
                  {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">Centro de formación
                <input value={editForm.centro_formacion || ''} onChange={(event) => setEditForm({ ...editForm, centro_formacion: event.target.value || null })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <label className="text-sm text-slate-300">Nombre de la empresa
                <input value={editForm.nombre_empresa || ''} onChange={(event) => setEditForm({ ...editForm, nombre_empresa: event.target.value || null })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
              <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                <button type="button" onClick={() => { setEditingProfile(null); setEditForm(null) }} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700">Cancelar</button>
                <button type="submit" disabled={actionId === editingProfile.id} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">{actionId === editingProfile.id ? 'Guardando...' : 'Guardar cambios'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {rejectingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="reject-title" className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-800 p-6 shadow-2xl">
            <h2 id="reject-title" className="text-lg font-bold text-white">Rechazar solicitud</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">¿Confirmas que deseas rechazar la solicitud de <strong className="text-white">{rejectingProfile.nombre}</strong>? La persona no podrá acceder a los módulos.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectingProfile(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700">Cancelar</button>
              <button type="button" disabled={actionId === rejectingProfile.id} onClick={() => void rejectRequest()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-400 disabled:opacity-50">Confirmar rechazo</button>
            </div>
          </section>
        </div>
      )}

      {deletingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-800 p-6 shadow-2xl">
            <h2 id="delete-title" className="text-lg font-bold text-white">Eliminar cuenta permanentemente</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Se eliminarán la cuenta de Auth y el perfil de <strong className="text-white">{deletingProfile.nombre}</strong>. Los datos vinculados también pueden eliminarse. Esta acción no se puede deshacer.</p>
            {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={actionId === deletingProfile.id} onClick={() => setDeletingProfile(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50">Cancelar</button>
              <button type="button" disabled={actionId === deletingProfile.id} onClick={() => void deleteProfile()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-400 disabled:opacity-50">{actionId === deletingProfile.id ? 'Eliminando...' : 'Eliminar cuenta'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
