'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/app/components/TurnstileWidget'

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

function getAuthErrorMessage(error: { message: string }) {
  if (error.message.includes('invalid-input-secret')) {
    return 'Supabase rechazó la clave secreta de Turnstile. En Cloudflare copia la Secret Key del mismo widget, actualízala en Supabase > Authentication > Bot and Abuse Protection y guarda los cambios.'
  }

  if (error.message.includes('captcha protection')) {
    return `No se pudo validar Turnstile: ${error.message}`
  }

  return error.message
}

export default function LoginView() {
  const router = useRouter()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState('estudiante')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef<TurnstileWidgetHandle>(null)

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!captchaToken) {
      setMessage('Completa la verificación de seguridad antes de continuar.')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken },
        })

        if (error) {
          setMessage(`❌ Error al iniciar sesión: ${getAuthErrorMessage(error)}`)
        } else {
          setMessage('✅ ¡Inicio de sesión exitoso! Redirigiendo...')
          setTimeout(() => router.push('/'), 1000)
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { captchaToken },
        })

        if (error) {
          setMessage(`❌ Error en el registro: ${getAuthErrorMessage(error)}`)
        } else if (data.user) {
          const { error: profileError } = await supabase.from('perfiles').insert([
            {
              id: data.user.id,
              nombre,
              email,
              rol,
            },
          ])

          if (profileError) {
            setMessage(`⚠️ Usuario creado, pero hubo un detalle en el perfil: ${profileError.message}`)
          } else {
            setMessage('✅ ¡Cuenta creada exitosamente!')
            setIsLogin(true)
          }
        }
      }
    } catch (error) {
      console.error('Error al procesar la autenticación.', error)
      setMessage('No fue posible completar la solicitud. Revisa tu conexión e inténtalo nuevamente.')
    } finally {
      captchaRef.current?.reset()
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-900 text-white">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
        <h1 className="text-3xl font-extrabold text-center text-emerald-400 mb-2">
          PractiHub
        </h1>
        <p className="text-slate-400 text-center text-sm mb-6">
          {isLogin ? 'Inicia sesión en tu cuenta' : 'Crea tu nueva cuenta'}
        </p>

        {message && (
          <div className="mb-4 p-3 rounded-lg text-sm bg-slate-950 border border-slate-700 text-center">
            {message}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Rol</label>
                <select
                  value={rol}
                  onChange={(e) => setRol(e.target.value)}
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="estudiante">Estudiante</option>
                  <option value="tutor">Instructor</option>
                  <option value="empresa">Empresa</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Correo Electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <TurnstileWidget
            ref={captchaRef}
            siteKey={turnstileSiteKey}
            onTokenChange={setCaptchaToken}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 font-bold rounded-lg text-slate-950 transition"
          >
            {loading ? 'Procesando...' : isLogin ? 'Iniciar Sesión' : 'Registrarse'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {isLogin ? '¿No tienes una cuenta?' : '¿Ya tienes una cuenta?'}{' '}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin)
              setMessage('')
              setCaptchaToken('')
              captchaRef.current?.reset()
            }}
            className="text-emerald-400 underline hover:text-emerald-300 font-medium ml-1"
          >
            {isLogin ? 'Regístrate aquí' : 'Inicia sesión'}
          </button>
        </div>
      </div>
    </main>
  )
}