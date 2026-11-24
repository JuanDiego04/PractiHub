'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

export default function UpdatePasswordView() {
  const searchParams = useSearchParams()
  const invalidLink = searchParams.get('error') === 'invalid-link'
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return
        if (sessionError) {
          setError(`No se pudo verificar el enlace: ${sessionError.message}`)
        } else {
          setHasSession(Boolean(data.session))
        }
        setCheckingSession(false)
      })
      .catch((sessionFailure: unknown) => {
        if (!active) return
        console.error('Error al verificar el enlace para cambiar la contraseña.', sessionFailure)
        setError('No fue posible verificar el enlace. Solicita uno nuevo e inténtalo nuevamente.')
        setCheckingSession(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(`No se pudo actualizar la contraseña: ${updateError.message}`)
        return
      }

      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      setPassword('')
      setConfirmPassword('')
      setHasSession(false)
      setMessage(signOutError
        ? `La contraseña se actualizó, pero no se pudo cerrar esta sesión: ${signOutError.message}`
        : 'Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión con ella.')
    } catch (updateFailure) {
      console.error('Error al actualizar la contraseña.', updateFailure)
      setError('No fue posible actualizar la contraseña. Inténtalo nuevamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-bold text-emerald-400">Crear contraseña</h1>
        <p className="mt-3 text-center text-sm text-slate-400">
          Elige una contraseña segura para tu cuenta PractiHub.
        </p>

        {!checkingSession && !hasSession && !error && !message && (
          <p role="alert" className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {invalidLink
              ? 'El enlace no es válido o ya venció. Solicita uno nuevo desde la recuperación de contraseña.'
              : 'No hay una sesión válida para crear una contraseña. Solicita un enlace desde la recuperación de contraseña.'}
          </p>
        )}
        {message && <p role="status" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
        {checkingSession && <p role="status" className="mt-5 text-center text-sm text-slate-400">Verificando el enlace seguro...</p>}

        {!checkingSession && hasSession && (
          <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-300">
              Nueva contraseña
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              Confirmar contraseña
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-emerald-500 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {!checkingSession && !hasSession && !message && (
          <Link href="/recuperar-contrasena" className="mt-6 block text-center font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200">
            Solicitar un enlace nuevo
          </Link>
        )}
        {message && (
          <Link href="/login" className="mt-6 block text-center font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200">
            Ir al inicio de sesión
          </Link>
        )}
      </section>
    </main>
  )
}
