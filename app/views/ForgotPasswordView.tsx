'use client'

import Link from 'next/link'
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
  if (/email address not authorized/i.test(error.message)) {
    return 'El SMTP de prueba de Supabase solo permite enviar correos a miembros del equipo del proyecto. Configura un proveedor SMTP propio en Authentication > SMTP Settings.'
  }
  if (/rate limit|too many requests/i.test(error.message)) {
    return 'Supabase limitó temporalmente los correos de recuperación. Revisa Authentication > Rate Limits y vuelve a intentar más tarde.'
  }
  if (/error sending recovery email/i.test(error.message)) {
    return 'Supabase no pudo enviar el correo. Revisa Authentication > Logs y la configuración SMTP del proyecto.'
  }
  return error.message
}

export default function ForgotPasswordView() {
  const captchaRef = useRef<TurnstileWidgetHandle>(null)
  const [email, setEmail] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captchaToken) {
      setError('Completa la verificación de seguridad antes de continuar.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/confirm`,
        captchaToken,
      })

      if (requestError) {
        const isUnknownEmail = /user not found|email not found|no user/i.test(requestError.message)
        if (!isUnknownEmail) {
          setError(`No se pudo solicitar el restablecimiento: ${getAuthErrorMessage(requestError)}`)
          return
        }
      }

      setMessage('Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva. Revisa también correo no deseado. Si no llega, verifica Authentication > Logs y SMTP en Supabase.')
    } catch (requestFailure) {
      console.error('Error al solicitar el restablecimiento de contraseña.', requestFailure)
      setError('No fue posible enviar la solicitud. Revisa tu conexión e inténtalo nuevamente.')
    } finally {
      captchaRef.current?.reset()
      setCaptchaToken('')
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-bold text-emerald-400">Recuperar contraseña</h1>
        <p className="mt-3 text-center text-sm text-slate-400">
          Te enviaremos un enlace seguro al correo asociado a tu cuenta.
        </p>

        {message && <p role="status" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-300">
            Correo electrónico
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <TurnstileWidget ref={captchaRef} siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-500 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? 'Enviando enlace...' : 'Enviar enlace de recuperación'}
          </button>
        </form>

        <Link href="/login" className="mt-6 block text-center text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">
          Volver al inicio de sesión
        </Link>
      </section>
    </main>
  )
}
