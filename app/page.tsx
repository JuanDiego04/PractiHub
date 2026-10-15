'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Perfil {
  id: string
  nombre: string
  email: string
  rol: string
}

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  useEffect(() => {
    async function checkAuthAndFetchProfile() {
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        router.push('/login')
        return
      }

      // Usamos .maybeSingle() para evitar el error si no se encuentra la fila
      const { data, error: profileError } = await supabase
        .from('perfiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        console.error('Error al cargar perfil:', profileError.message)
      } else if (data) {
        setPerfil(data)
      }

      setLoading(false)
    }

    checkAuthAndFetchProfile()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p className="text-slate-400 font-medium animate-pulse">Cargando datos de usuario...</p>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-900 text-white">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 text-center">
        <h1 className="text-3xl font-extrabold text-emerald-400 mb-2">PractiHub</h1>
        <p className="text-slate-400 text-sm mb-6">Panel Principal del Usuario</p>

        {perfil ? (
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 text-left mb-6 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Perfil Autenticado</p>
            <p className="text-xl font-bold text-white">{perfil.nombre}</p>
            <p className="text-sm text-slate-400">{perfil.email}</p>
            <span className="inline-block mt-2 px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Rol: {perfil.rol}
            </span>
          </div>
        ) : (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 text-sm text-slate-400">
            ⚠️ Cuenta activa, pero sin perfil vinculado en la nueva tabla.
          </div>
        )}

        <button
          onClick={handleLogout}
          className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 font-bold rounded-lg text-white transition shadow-lg"
        >
          Cerrar Sesión
        </button>
      </div>
    </main>
  )
}