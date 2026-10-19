import { Suspense } from 'react'
import TutorEstudianteDetalleRoute from '@/app/views/TutorEstudianteDetalleRoute'

export default function EstudianteDetallePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-4xl animate-pulse space-y-5">
            <div className="h-5 w-32 rounded bg-slate-700" />
            <div className="h-40 rounded-2xl border border-slate-700 bg-slate-800" />
          </div>
        </main>
      }
    >
      <TutorEstudianteDetalleRoute />
    </Suspense>
  )
}
