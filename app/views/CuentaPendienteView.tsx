'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { EstadoCuenta } from '@/lib/perfil'

const statusContent: Record<Exclude<EstadoCuenta, 'activo'>, { title: string; description: string }> = {
  pendiente: {
    title: 'Solicitud en revisión',
    description: 'Un administrador verificará la información que enviaste. Te notificaremos cuando tu cuenta esté habilitada.',
  },
  rechazado: {
    title: 'Solicitud no aprobada',
    description: 'Tu solicitud no fue aprobada. Comunícate con el equipo de PractiHub si necesitas más información.',
  },
  suspendido: {
    title: 'Cuenta suspendida',
    description: 'El acceso a los módulos está suspendido. Comunícate con el equipo de PractiHub para recibir asistencia.',
  },
}

export default function CuentaPendienteView() {
  const router = useRouter()
  const [status, setStatus] = useState<Exclude<EstadoCuenta, 'activo'> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadAccountStatus() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
          if (!cancelled) router.replace('/login')
          return
        }

        const { data, error: profileError } = await supabase
          .from('perfiles')
          .select('estado_cuenta, rol')
          .eq('id', user.id)
          .maybeSingle()

        if (cancelled) return
        if (profileError || !data) {
          setError(`No se pudo consultar el estado de tu cuenta: ${profileError?.message || 'No existe un perfil asociado.'}`)
          return
        }

        if (data.estado_cuenta === 'activo') {
          router.replace(data.rol === 'admin' ? '/admin' : '/')
          return
        }
        setStatus(data.estado_cuenta as Exclude<EstadoCuenta, 'activo'>)
      } catch (statusFailure) {
        if (!cancelled) {
          setError(statusFailure instanceof Error ? `No se pudo consultar el estado de tu cuenta: ${statusFailure.message}` : 'No se pudo consultar el estado de tu cuenta.')
        }
      }
    }

    void loadAccountStatus()
    return () => {
      cancelled = true
    }
  }, [router])

  const content = status ? statusContent[status] : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-white">
      <section className="w-full max-w-xl rounded-2xl border border-amber-500/30 bg-slate-800 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-2xl text-amber-300" aria-hidden="true">⌛</div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Verificación de cuenta</p>
        <h1 className="mt-2 text-2xl font-bold text-white">{content?.title || 'Consultando el estado de tu cuenta'}</h1>
        <p className="mt-3 leading-7 text-slate-300">{content?.description || 'Estamos cargando la información de tu solicitud.'}</p>
        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
        <Link href="/login" className="mt-7 inline-flex rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-300">
          Volver al inicio de sesión
        </Link>
      </section>
    </main>
  )
}
