'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/app/components/TurnstileWidget'

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

function getAuthErrorMessage(error: { message: string }) {
  if (error.message.includes('invalid-input-secret')) {
    return 'Supabase rechazó la clave secreta de Turnstile. Verifica la Secret Key del widget en Supabase > Authentication > Bot and Abuse Protection.'
  }
  if (error.message.includes('captcha protection')) {
    return `No se pudo validar Turnstile: ${error.message}`
  }
  return error.message
}

export default function LoginView() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef<TurnstileWidgetHandle>(null)

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captchaToken) {
      setMessage('Completa la verificación de seguridad antes de continuar.')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      })
      if (signInError) {
        setMessage(`No se pudo iniciar sesión: ${getAuthErrorMessage(signInError)}`)
        return
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        await supabase.auth.signOut()
        setMessage(`No se pudo verificar la sesión: ${authError?.message || 'No se encontró el usuario.'}`)
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('perfiles')
        .select('rol, estado_cuenta')
        .eq('id', user.id)
        .maybeSingle()
      if (profileError || !profile) {
        await supabase.auth.signOut()
        setMessage(`No se pudo cargar el perfil de la cuenta: ${profileError?.message || 'No existe un perfil asociado.'}`)
        return
      }

      router.replace(profile.estado_cuenta === 'activo'
        ? profile.rol === 'admin' ? '/admin' : '/'
        : '/cuenta-pendiente')
    } catch (error) {
      console.error('Error al procesar el inicio de sesión.', error)
      setMessage('No fue posible completar la solicitud. Revisa tu conexión e inténtalo nuevamente.')
    } finally {
      captchaRef.current?.reset()
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 pt-20 text-white">
      <Link
        href="/admin/login"
        aria-label="Acceso para administradores"
        className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-300 shadow-lg backdrop-blur transition hover:border-emerald-500/50 hover:bg-slate-800 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 sm:right-8 sm:top-8"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-emerald-400">
          <path d="M12 3 19 6v5c0 4.7-2.9 8.2-7 10-4.1-1.8-7-5.3-7-10V6l7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Acceso admin
      </Link>

      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="mb-2 text-center text-3xl font-extrabold text-emerald-400">PractiHub</h1>
        <p className="mb-6 text-center text-sm text-slate-400">Inicia sesión en tu cuenta</p>

        {message && (
          <p role="alert" className="mb-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-center text-sm text-slate-200">
            {message}
          </p>
        )}

        <form onSubmit={(event) => void handleLogin(event)} className="space-y-4">
          <label className="block text-xs font-semibold text-slate-300">
            Correo electrónico
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block text-xs font-semibold text-slate-300">
            Contraseña
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <TurnstileWidget
            ref={captchaRef}
            siteKey={turnstileSiteKey}
            onTokenChange={setCaptchaToken}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-500 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? 'Verificando...' : 'Iniciar sesión'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-3 text-sm">
          <Link href="/recuperar-contrasena" className="text-slate-400 underline decoration-slate-600 underline-offset-4 hover:text-slate-200">
            ¿Olvidaste tu contraseña?
          </Link>
          <Link href="/registro" className="font-medium text-emerald-300 underline hover:text-emerald-200">
            ¿No tienes cuenta? Regístrate
          </Link>
        </div>
      </section>
    </main>
  )
}
