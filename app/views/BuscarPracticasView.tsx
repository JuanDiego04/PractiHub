'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Definimos la estructura de datos que esperamos de Supabase
interface Oferta {
  id: string
  titulo: string
  descripcion: string
  requisitos: string
  created_at: string
  perfiles: { nombre: string } | null
}

export default function BuscarPracticasView() {
  const [ofertas, setOfertas] = useState<Oferta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchOfertas() {
      // Consultamos las ofertas activas y hacemos JOIN con 'perfiles' para traer el nombre de la empresa
      const { data, error } = await supabase
        .from('ofertas')
        .select(`
          id,
          titulo,
          descripcion,
          requisitos,
          created_at,
          perfiles ( nombre )
        `)
        .eq('estado', 'activa')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error al cargar las ofertas:', error.message)
      } else {
        // Asignamos los datos (casteamos al tipo Oferta para que TypeScript no se queje)
        setOfertas(data as unknown as Oferta[])
      }
      setLoading(false)
    }

    fetchOfertas()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-slate-400 font-medium animate-pulse">Buscando oportunidades...</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100">Explorar Prácticas</h1>
        <p className="text-slate-400 mt-2">Encuentra y postúlate a las mejores vacantes de nuestras empresas aliadas.</p>
      </header>

      {/* Renderizado Condicional: Si no hay ofertas (array vacío) o si hay datos */}
      {ofertas.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 border-dashed rounded-2xl p-16 text-center">
          <div className="text-6xl mb-4 opacity-80">📭</div>
          <h3 className="text-xl font-semibold text-white mb-2">Aún no hay ofertas disponibles</h3>
          <p className="text-slate-400 max-w-md mx-auto">
            Las empresas están preparando nuevas vacantes. Vuelve pronto para descubrir nuevas oportunidades para tu perfil.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ofertas.map((oferta) => (
            <div key={oferta.id} className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col shadow-sm hover:shadow-md hover:border-slate-600 transition group">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-emerald-400 mb-1 group-hover:text-emerald-300 transition">{oferta.titulo}</h3>
                <p className="text-sm text-slate-400 font-medium mb-4 flex items-center gap-2">
                  🏢 {oferta.perfiles?.nombre || 'Empresa Confidencial'}
                </p>
                <p className="text-slate-300 text-sm line-clamp-3 mb-4 leading-relaxed">
                  {oferta.descripcion}
                </p>
              </div>
              
              <button className="w-full py-2.5 bg-slate-700 hover:bg-emerald-500 hover:text-slate-900 text-slate-200 font-semibold rounded-lg transition mt-auto">
                Ver Detalles / Postularme
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}