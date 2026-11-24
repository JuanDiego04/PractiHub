'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/app/components/TurnstileWidget'

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

export default function AdminLoginView() {
  const router = useRouter()
  const captchaRef = useRef<TurnstileWidgetHandle>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captchaToken) {
      setError('Completa la verificación de seguridad antes de continuar.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      })
      if (signInError) {
        setError(`No se pudo iniciar sesión: ${signInError.message}`)
        return
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      const { data: profile, error: profileError } = user
        ? await supabase.from('perfiles').select('rol, estado_cuenta').eq('id', user.id).maybeSingle()
        : { data: null, error: null }

      if (authError || profileError || !profile || profile.rol !== 'admin' || profile.estado_cuenta !== 'activo') {
        const { error: signOutError } = await supabase.auth.signOut()
        const detail = profileError?.message || authError?.message
        setError(signOutError
          ? `Acceso denegado. No se pudo cerrar la sesión: ${signOutError.message}`
          : `Acceso denegado. Esta cuenta no tiene permisos de administrador${detail ? ` (${detail})` : ''}.`)
        return
      }

      router.replace('/admin')
    } catch (loginError) {
      console.error('Error al procesar el acceso administrativo.', loginError)
      setError('No fue posible verificar el acceso administrativo. Inténtalo nuevamente.')
    } finally {
      captchaRef.current?.reset()
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-emerald-500/25 bg-slate-900 p-8 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-xl text-emerald-300" aria-hidden="true">◆</div>
        <p className="mt-5 text-center text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Panel Administrativo • PractiHub</p>
        <h1 className="mt-2 text-center text-2xl font-bold">Acceso seguro</h1>
        <p className="mt-2 text-center text-sm text-slate-400">Ingresa con una cuenta administrativa activa.</p>

        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}

        <form onSubmit={(event) => void handleLogin(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-300">
            Correo del administrador
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white focus:border-emerald-500 focus:outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-300">
            Contraseña
            <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white focus:border-emerald-500 focus:outline-none" />
          </label>
          <TurnstileWidget ref={captchaRef} siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} />
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-emerald-500 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
            {loading ? 'Verificando permisos...' : 'Entrar al panel'}
          </button>
        </form>

        <Link href="/recuperar-contrasena" className="mt-5 block text-center text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">
          ¿Olvidaste tu contraseña?
        </Link>
        <Link href="/login" className="mt-6 block text-center text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">
          Volver al acceso general
        </Link>
      </section>
    </main>
  )
}
