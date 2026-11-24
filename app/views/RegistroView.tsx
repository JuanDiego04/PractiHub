'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/app/components/TurnstileWidget'

type TipoCuenta = 'aprendiz' | 'instructor' | 'empresa'

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

export default function RegistroView() {
  const router = useRouter()
  const captchaRef = useRef<TurnstileWidgetHandle>(null)
  const [tipoCuenta, setTipoCuenta] = useState<TipoCuenta>('aprendiz')
  const [nombre, setNombre] = useState('')
  const [documento, setDocumento] = useState('')
  const [telefono, setTelefono] = useState('')
  const [centroFormacion, setCentroFormacion] = useState('')
  const [nombreEmpresa, setNombreEmpresa] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captchaToken) {
      setError('Completa la verificación de seguridad antes de continuar.')
      return
    }
    if (!/^[0-9]{10}$/.test(telefono.replace(/\D/g, ''))) {
      setError('Ingresa un teléfono válido de exactamente 10 dígitos.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          captchaToken,
          data: {
            account_type: tipoCuenta,
            nombre: nombre.trim(),
            documento_identidad: documento.trim() || null,
            telefono: telefono.trim(),
            centro_formacion: tipoCuenta === 'instructor' ? centroFormacion.trim() : null,
            nombre_empresa: tipoCuenta === 'empresa' ? nombreEmpresa.trim() : null,
          },
        },
      })

      if (signUpError) {
        setError(`No se pudo crear la cuenta: ${signUpError.message}`)
        return
      }

      if (!data.session) {
        setMessage('Te enviamos un correo para confirmar tu dirección. Después de confirmarlo, inicia sesión para continuar.')
        return
      }

      router.replace(tipoCuenta === 'aprendiz' ? '/' : '/cuenta-pendiente')
    } catch (registrationError) {
      console.error('Error al procesar el registro.', registrationError)
      setError('No fue posible completar el registro. Revisa tu conexión e inténtalo nuevamente.')
    } finally {
      captchaRef.current?.reset()
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 text-white">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl sm:p-8">
        <h1 className="text-center text-3xl font-extrabold text-emerald-400">Crear cuenta PractiHub</h1>
        <p className="mt-2 text-center text-sm text-slate-400">Elige el tipo de cuenta para completar tus datos.</p>

        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
        {message && <p role="status" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}

        <form onSubmit={(event) => void handleRegistration(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-300">
            Tipo de cuenta
            <select
              value={tipoCuenta}
              onChange={(event) => setTipoCuenta(event.target.value as TipoCuenta)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="aprendiz">Aprendiz</option>
              <option value="instructor">Instructor</option>
              <option value="empresa">Empresa</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-300">
              {tipoCuenta === 'empresa' ? 'Nombre del contacto principal' : 'Nombre completo'}
              <input required minLength={2} maxLength={100} value={nombre} onChange={(event) => setNombre(event.target.value)} autoComplete="name" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
            </label>

            {tipoCuenta !== 'empresa' && (
              <label className="block text-sm font-medium text-slate-300">
                Documento de identidad (opcional)
                <input value={documento} onChange={(event) => setDocumento(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
            )}

            <label className="block text-sm font-medium text-slate-300">
              Teléfono de contacto
              <input required type="tel" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={telefono} onChange={(event) => setTelefono(event.target.value.replace(/\D/g, '').slice(0, 10))} autoComplete="tel" placeholder="3000000000" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
            </label>

            {tipoCuenta === 'instructor' && (
              <label className="block text-sm font-medium text-slate-300">
                Centro de formación
                <input required minLength={2} value={centroFormacion} onChange={(event) => setCentroFormacion(event.target.value)} placeholder="Centro de Comercio y Servicios" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
              </label>
            )}

            {tipoCuenta === 'empresa' && (
              <>
                <label className="block text-sm font-medium text-slate-300">
                  NIT o documento (opcional)
                  <input value={documento} onChange={(event) => setDocumento(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
                </label>
                <label className="block text-sm font-medium text-slate-300 sm:col-span-2">
                  Nombre de la empresa
                  <input required minLength={2} value={nombreEmpresa} onChange={(event) => setNombreEmpresa(event.target.value)} autoComplete="organization" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
                </label>
              </>
            )}

            <label className="block text-sm font-medium text-slate-300">
              Correo electrónico
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
            </label>

            <label className="block text-sm font-medium text-slate-300">
              Contraseña
              <input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white focus:border-emerald-500 focus:outline-none" />
            </label>
          </div>

          {tipoCuenta !== 'aprendiz' && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
              La solicitud quedará pendiente hasta que un administrador verifique tus datos.
            </p>
          )}

          <TurnstileWidget ref={captchaRef} siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} />

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-emerald-500 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          ¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-emerald-300 underline">Inicia sesión</Link>
        </p>
      </section>
    </main>
  )
}
