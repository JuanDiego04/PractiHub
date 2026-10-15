'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Perfil {
  id: string
  nombre: string
  email: string
  rol: string
}

export default function Home() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('estudiante')
  const [loading, setLoading] = useState(false)

  // Cargar registros desde Supabase
  const fetchPerfiles = async () => {
    const { data, error } = await supabase.from('perfiles').select('*')
    if (error) {
      console.error('Error al cargar perfiles:', error.message)
    } else if (data) {
      setPerfiles(data)
    }
  }

  useEffect(() => {
    fetchPerfiles()
  }, [])

  // Enviar un nuevo registro a Supabase
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.from('perfiles').insert([
      { nombre, email, rol }
    ])

    if (error) {
      alert(`Error de escritura: ${error.message}`)
    } else {
      setNombre('')
      setEmail('')
      fetchPerfiles() // Recargar la lista automáticamente
    }
    setLoading(false)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-slate-900 text-white">
      <div className="max-w-xl w-full bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-3xl font-extrabold mb-2 text-emerald-400 text-center">PractiHub</h1>
        <p className="text-slate-300 mb-6 text-center">Prueba de lectura y escritura en Supabase</p>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <h2 className="text-lg font-bold text-slate-200">Añadir Perfil</h2>
          <input
            type="text"
            placeholder="Nombre completo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
          />
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
          />
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="estudiante">Estudiante</option>
            <option value="tutor">Tutor</option>
            <option value="administrador">Administrador</option>
          </select>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 font-semibold rounded-lg text-slate-950 transition"
          >
            {loading ? 'Guardando...' : 'Guardar en Supabase'}
          </button>
        </form>

        {/* Lista de perfiles almacenados */}
        <div>
          <h2 className="text-lg font-bold text-slate-200 mb-3">Registros en la base de datos:</h2>
          {perfiles.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No hay registros aún o falta configurar la política RLS de inserción.</p>
          ) : (
            <ul className="space-y-2">
              {perfiles.map((p) => (
                <li key={p.id} className="p-3 bg-slate-900 rounded-lg border border-slate-700 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-semibold text-white">{p.nombre}</p>
                    <p className="text-xs text-slate-400">{p.email}</p>
                  </div>
                  <span className="px-2.5 py-1 text-xs rounded-full bg-slate-800 text-emerald-400 border border-emerald-500/30">
                    {p.rol}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
