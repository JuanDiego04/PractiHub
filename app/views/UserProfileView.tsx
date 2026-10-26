'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

const MAX_PHOTO_SIZE = 5 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').slice(0, 10)
}

interface UserProfile {
  id: string
  nombre: string
  nombre_empresa: string | null
  email: string
  rol: string
  telefono: string | null
  foto_perfil_path: string | null
}

const roleLabels: Record<string, string> = {
  estudiante: 'Practicante',
  tutor: 'Instructor',
  empresa: 'Empresa',
}

function profileSchemaMessage(message: string, code?: string) {
  if (/nombre_empresa|update_own_company_name/i.test(message)) {
    return `No está disponible el registro del nombre empresarial. Ejecuta completo supabase/company_registry.sql después de las migraciones del módulo de empresa en el SQL Editor y vuelve a cargar la página. Detalle: ${message}`
  }
  if (code === '42703' || /column .* does not exist/i.test(message)) {
    return `A la tabla public.perfiles le faltan columnas del perfil. Ejecuta completo supabase/user_profile.sql en el SQL Editor del mismo proyecto de Supabase que usa esta aplicación y vuelve a cargar la página. Detalle: ${message}`
  }
  if (code === 'PGRST204') {
    return `El esquema de perfiles aún no está disponible en la API de Supabase. Ejecuta completo supabase/user_profile.sql en el SQL Editor del mismo proyecto de Supabase que usa esta aplicación y recarga el esquema de la API. Detalle: ${message}`
  }
  if (code === 'PGRST202' || (code === '42883' && /update_own_profile/i.test(message))) {
    return `No está disponible la función de actualización del perfil. Ejecuta completo supabase/user_profile.sql en el SQL Editor del mismo proyecto de Supabase. Detalle: ${message}`
  }
  return message
}

function Notice({ children, error = false }: { children: string; error?: boolean }) {
  return (
    <p role={error ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
      {children}
    </p>
  )
}

export default function UserProfileView() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [accountEmail, setAccountEmail] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoInputVersion, setPhotoInputVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingCompanyName, setSavingCompanyName] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [nombre, setNombre] = useState('')
  const [nombreEmpresa, setNombreEmpresa] = useState('')
  const [telefono, setTelefono] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) {
        router.replace('/login')
        return
      }
      setAccountEmail(user.email || '')
      setNewEmail(user.email || '')

      const { data, error: profileError } = await supabase
        .from('perfiles')
        .select('id, nombre, nombre_empresa, email, rol, telefono, foto_perfil_path')
        .eq('id', user.id)
        .maybeSingle()
      if (profileError) throw new Error(profileSchemaMessage(`No se pudo cargar tu perfil: ${profileError.message}`, profileError.code))
      if (!data) throw new Error('Tu cuenta no tiene un perfil asociado.')

      const userProfile = data as UserProfile
      setProfile(userProfile)
      setNombre(userProfile.nombre)
      setNombreEmpresa(userProfile.nombre_empresa || '')
      setTelefono(normalizePhone(userProfile.telefono || ''))
      if (userProfile.foto_perfil_path) {
        const { data: signedPhoto, error: photoError } = await supabase.storage
          .from('fotos_perfil')
          .createSignedUrl(userProfile.foto_perfil_path, 60 * 60)
        if (photoError) throw new Error(`No se pudo abrir tu foto de perfil: ${photoError.message}`)
        setPhotoUrl(signedPhoto.signedUrl)
      } else {
        setPhotoUrl('')
      }
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudo cargar tu perfil.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    // The profile is loaded asynchronously from Supabase after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile()
  }, [loadProfile])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) {
      setError('No se encontró tu perfil para guardar los cambios.')
      return
    }
    if (nombre.trim().length < 2 || nombre.trim().length > 100) {
      setError('El nombre debe tener entre 2 y 100 caracteres.')
      return
    }
    const normalizedPhone = normalizePhone(telefono)
    if (normalizedPhone && normalizedPhone.length !== 10) {
      setError('El teléfono debe tener exactamente 10 dígitos.')
      return
    }
    if (photo && !ALLOWED_PHOTO_TYPES.has(photo.type)) {
      setError('La foto debe ser JPG, PNG o WEBP.')
      return
    }
    if (photo && photo.size > MAX_PHOTO_SIZE) {
      setError('La foto supera el límite de 5 MB.')
      return
    }

    setSavingProfile(true)
    setError('')
    setMessage('')
    let nextPath = profile.foto_perfil_path
    let uploadedPath: string | null = null
    let photoUploaded = false
    let profileSaved = false
    try {
      if (photo) {
        const safeName = photo.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
        uploadedPath = `${profile.id}/profile/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('fotos_perfil').upload(uploadedPath, photo, {
          contentType: photo.type,
          upsert: false,
        })
        if (uploadError) throw new Error(`No se pudo subir la foto: ${uploadError.message}`)
        photoUploaded = true
        nextPath = uploadedPath
      } else if (removePhoto) {
        nextPath = null
      }

      const { error: updateError } = await supabase.rpc('update_own_profile', {
        p_nombre: nombre.trim(),
        p_telefono: normalizedPhone || null,
        p_foto_perfil_path: nextPath,
      })
      if (updateError) throw new Error(profileSchemaMessage(`No se pudo actualizar el perfil: ${updateError.message}`, updateError.code))
      profileSaved = true

      const previousPath = profile.foto_perfil_path
      setProfile({ ...profile, nombre: nombre.trim(), telefono: normalizedPhone || null, foto_perfil_path: nextPath })
      setRemovePhoto(false)
      setPhoto(null)
      setPhotoInputVersion((current) => current + 1)
      if (nextPath) {
        const { data: signedPhoto, error: photoError } = await supabase.storage.from('fotos_perfil').createSignedUrl(nextPath, 60 * 60)
        if (photoError) throw new Error(`El perfil se guardó, pero no se pudo abrir la foto: ${photoError.message}`)
        setPhotoUrl(signedPhoto.signedUrl)
      } else {
        setPhotoUrl('')
      }

      if (previousPath && previousPath !== nextPath) {
        const { error: removeError } = await supabase.storage.from('fotos_perfil').remove([previousPath])
        if (removeError) {
          setMessage(`Perfil actualizado. No se pudo eliminar la foto anterior: ${removeError.message}`)
          return
        }
      }
      setMessage('Tus datos personales se actualizaron correctamente.')
    } catch (saveFailure) {
      if (uploadedPath && photoUploaded && !profileSaved) {
        const { error: cleanupError } = await supabase.storage.from('fotos_perfil').remove([uploadedPath])
        if (cleanupError) {
          setError(`${saveFailure instanceof Error ? saveFailure.message : 'No se pudo actualizar el perfil.'} Además, no se pudo eliminar la foto temporal: ${cleanupError.message}`)
          return
        }
      }
      setError(saveFailure instanceof Error ? saveFailure.message : 'No se pudo actualizar el perfil.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function saveCompanyName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = nombreEmpresa.trim()
    if (normalizedName.length < 2 || normalizedName.length > 150) {
      setError('El nombre de la empresa debe tener entre 2 y 150 caracteres.')
      return
    }

    setSavingCompanyName(true)
    setError('')
    setMessage('')
    try {
      const { error: saveError } = await supabase.rpc('update_own_company_name', {
        p_nombre_empresa: normalizedName,
      })
      if (saveError) throw new Error(profileSchemaMessage(`No se pudo guardar el nombre de la empresa: ${saveError.message}`, saveError.code))
      setProfile((current) => current ? { ...current, nombre_empresa: normalizedName } : current)
      setMessage('El nombre de la empresa se actualizó correctamente y se mostrará en las ofertas y seguimientos.')
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'No se pudo guardar el nombre de la empresa.')
    } finally {
      setSavingCompanyName(false)
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = newEmail.trim().toLowerCase()
    if (!normalizedEmail || normalizedEmail === accountEmail.toLowerCase()) {
      setError('Escribe un correo distinto al actual.')
      return
    }
    setSavingEmail(true)
    setError('')
    setMessage('')
    const { error: updateError } = await supabase.auth.updateUser({ email: normalizedEmail })
    if (updateError) {
      setError(`No se pudo solicitar el cambio de correo: ${updateError.message}`)
    } else {
      setMessage('Te enviamos un enlace de confirmación. El correo de tu cuenta cambiará cuando confirmes la solicitud.')
    }
    setSavingEmail(false)
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setSavingPassword(true)
    setError('')
    setMessage('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(`No se pudo actualizar la contraseña: ${updateError.message}`)
    } else {
      setPassword('')
      setConfirmPassword('')
      setMessage('Tu contraseña se actualizó correctamente.')
    }
    setSavingPassword(false)
  }

  async function handleSignOut() {
    setSigningOut(true)
    setError('')
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      window.location.replace('/login')
    } catch (signOutFailure) {
      const detail = signOutFailure instanceof Error ? signOutFailure.message : 'Error inesperado.'
      setError(`No se pudo cerrar la sesión: ${detail}`)
      setSigningOut(false)
    }
  }

  const initials = (profile?.nombre || accountEmail || 'P').trim().slice(0, 1).toUpperCase()

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · CUENTA</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Mi perfil</h1>
          <p className="mt-2 text-slate-400">Administra tus datos personales y la seguridad de tu cuenta.</p>
        </header>

        {message && <div className="mb-5"><Notice>{message}</Notice></div>}
        {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
        {loadError && <div className="mb-5"><Notice error>{loadError}</Notice></div>}
        {loading && <p className="mb-5 text-sm text-slate-400">Cargando los datos de tu cuenta...</p>}

        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            {photoUrl ? (
              <Image src={photoUrl} alt="Foto de perfil" width={88} height={88} unoptimized className="h-[88px] w-[88px] rounded-full border border-slate-600 object-cover" />
            ) : (
              <span aria-label="Sin foto de perfil" className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-3xl font-bold text-emerald-300">{initials}</span>
            )}
            <div>
              <h2 className="text-lg font-semibold text-white">{profile?.nombre || 'Completa tu perfil'}</h2>
              <p className="mt-1 text-sm text-slate-400">{accountEmail}</p>
              {profile?.rol && <span className="mt-2 inline-flex rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300">{roleLabels[profile.rol] || profile.rol}</span>}
            </div>
          </div>

          <form onSubmit={(event) => void saveProfile(event)} className="mt-6 space-y-4 border-t border-slate-700 pt-5">
            <h3 className="font-semibold text-white">Datos personales</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-300">Nombre completo
                <input required minLength={2} maxLength={100} value={nombre} onChange={(event) => setNombre(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <label className="text-sm font-medium text-slate-300">Teléfono (opcional)
                <input type="tel" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" title="Ingresa exactamente 10 dígitos." value={telefono} onChange={(event) => setTelefono(normalizePhone(event.target.value))} placeholder="3000000000" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-300">Foto de perfil (JPG, PNG o WEBP; máximo 5 MB)
              <input
                type="file"
                key={photoInputVersion}
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const selected = event.target.files?.[0] || null
                  setError('')
                  if (selected && !ALLOWED_PHOTO_TYPES.has(selected.type)) {
                    event.target.value = ''
                    setPhoto(null)
                    setError('La foto debe ser JPG, PNG o WEBP.')
                    return
                  }
                  if (selected && selected.size > MAX_PHOTO_SIZE) {
                    event.target.value = ''
                    setPhoto(null)
                    setError('La foto supera el límite de 5 MB.')
                    return
                  }
                  setPhoto(selected)
                  setRemovePhoto(false)
                }}
                className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200"
              />
            </label>
            {(photo || profile?.foto_perfil_path) && (
              <button type="button" onClick={() => { setPhoto(null); setRemovePhoto(true); setPhotoUrl('') }} className="text-sm font-medium text-rose-300 hover:text-rose-200">
                Quitar foto
              </button>
            )}
            <div>
              <button type="submit" disabled={savingProfile || loading || !profile} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                {savingProfile ? 'Guardando...' : 'Guardar perfil'}
              </button>
            </div>
          </form>
        </section>

        {profile?.rol === 'empresa' && (
          <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
            <h2 className="font-semibold text-white">Datos de la empresa</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Este nombre se mostrará en las ofertas para aprendices y en el selector de empresas del instructor. Tu nombre personal no se modifica.
            </p>
            <form onSubmit={(event) => void saveCompanyName(event)} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-medium text-slate-300">
                Nombre de la empresa que gestionas
                <input
                  required
                  minLength={2}
                  maxLength={150}
                  value={nombreEmpresa}
                  onChange={(event) => setNombreEmpresa(event.target.value)}
                  placeholder="Ej. Soluciones Tecnológicas S.A.S."
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
                />
              </label>
              <button
                type="submit"
                disabled={savingCompanyName}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                {savingCompanyName ? 'Guardando...' : 'Guardar empresa'}
              </button>
            </form>
          </section>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Correo de acceso</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">El cambio se aplica después de confirmar el enlace que enviaremos a tu nuevo correo.</p>
            <form onSubmit={(event) => void changeEmail(event)} className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-slate-300">Correo actual
                <input readOnly value={accountEmail} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-slate-400" />
              </label>
              <label className="block text-sm font-medium text-slate-300">Nuevo correo
                <input required type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <button type="submit" disabled={savingEmail || loading} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/60 hover:text-emerald-300 disabled:opacity-60">
                {savingEmail ? 'Enviando confirmación...' : 'Solicitar cambio de correo'}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Cambiar contraseña</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">Usa una contraseña única de al menos 8 caracteres.</p>
            <form onSubmit={(event) => void changePassword(event)} className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-slate-300">Nueva contraseña
                <input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <label className="block text-sm font-medium text-slate-300">Confirmar contraseña
                <input required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
              </label>
              <button type="submit" disabled={savingPassword || loading} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/60 hover:text-emerald-300 disabled:opacity-60">
                {savingPassword ? 'Actualizando...' : 'Actualizar contraseña'}
              </button>
            </form>
          </section>
        </div>

        <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-rose-500/20 bg-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="font-semibold text-white">Cerrar sesión</h2>
            <p className="mt-1 text-sm text-slate-400">Cierra el acceso a PractiHub en este dispositivo.</p>
          </div>
          <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="rounded-lg border border-rose-400/30 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-wait disabled:opacity-60">
            {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          </button>
        </section>

        <Link href="/" className="mt-6 inline-flex text-sm font-semibold text-emerald-300 hover:text-emerald-200">← Volver al panel</Link>
      </div>
    </main>
  )
}
