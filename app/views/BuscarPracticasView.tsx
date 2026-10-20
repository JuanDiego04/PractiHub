'use client'

import Link from 'next/link'

export default function BuscarPracticasView() {
  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · SEGUIMIENTO ACADÉMICO</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Conexión con tu instructor</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Estamos priorizando el seguimiento entre instructores y practicantes. La exploración de ofertas laborales estará disponible más adelante.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-white">¿Ya tienes una práctica registrada?</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Cuando tu instructor registre tu práctica en PractiHub, podrás enviar bitácoras, recibir retroalimentación y consultar tus evaluaciones desde el seguimiento.
          </p>
          <Link
            href="/mi-practica"
            className="mt-6 inline-flex rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Ir a mi seguimiento
          </Link>
        </section>
      </div>
    </main>
  )
}
