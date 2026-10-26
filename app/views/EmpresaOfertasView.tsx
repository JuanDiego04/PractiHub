'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { readableDate } from '@/lib/tutorSeguimiento'

export interface Oferta {
  id: string
  empresa_id: string
  titulo: string
  descripcion: string
  requisitos: string
  estado: 'activa' | 'cerrada'
  created_at: string
}

export default function EmpresaOfertasView() {
  const [offers, setOffers] = useState<Oferta[]>([])
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingEditId, setSavingEditId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editRequirements, setEditRequirements] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadOffers = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión con tu cuenta de empresa para administrar ofertas.')

      const { data: profile, error: profileError } = await supabase.from('perfiles').select('rol, nombre_empresa').eq('id', user.id).maybeSingle()
      if (profileError) throw new Error(`No se pudo verificar tu perfil: ${profileError.message}`)
      if (profile?.rol !== 'empresa') throw new Error('Esta sección está disponible para cuentas de empresa.')
      setCompanyName(profile.nombre_empresa || '')

      const { data, error: offersError } = await supabase
        .from('ofertas')
        .select('id, empresa_id, titulo, descripcion, requisitos, estado, created_at')
        .eq('empresa_id', user.id)
        .order('created_at', { ascending: false })
      if (offersError) throw new Error(`No se pudieron cargar tus ofertas: ${offersError.message}`)
      setOffers((data || []) as Oferta[])
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'No se pudieron cargar tus ofertas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // State updates happen after the Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOffers()
  }, [loadOffers])

  async function createOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo verificar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión nuevamente para publicar una oferta.')

      const { data, error: insertError } = await supabase
        .from('ofertas')
        .insert({
          empresa_id: user.id,
          titulo: title.trim(),
          descripcion: description.trim(),
          requisitos: requirements.trim(),
          estado: 'activa',
        })
        .select('id, empresa_id, titulo, descripcion, requisitos, estado, created_at')
        .single()
      if (insertError) throw new Error(`No se pudo publicar la oferta: ${insertError.message}`)

      setOffers((current) => [data as Oferta, ...current])
      setTitle('')
      setDescription('')
      setRequirements('')
      setMessage('La oferta se publicó correctamente.')
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'No se pudo publicar la oferta.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleOffer(offer: Oferta) {
    const status: Oferta['estado'] = offer.estado === 'activa' ? 'cerrada' : 'activa'
    setUpdatingId(offer.id)
    setError('')
    setMessage('')
    try {
      const { data, error: updateError } = await supabase
        .from('ofertas')
        .update({ estado: status })
        .eq('id', offer.id)
        .eq('empresa_id', offer.empresa_id)
        .select('id')
      if (updateError) throw new Error(`No se pudo cambiar el estado de la oferta: ${updateError.message}`)
      if (!data?.length) throw new Error('La oferta no se actualizó. Recarga e inténtalo nuevamente.')

      setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, estado: status } : item))
      setMessage(status === 'cerrada' ? 'La oferta se cerró.' : 'La oferta volvió a estar activa.')
    } catch (updateFailure) {
      setError(updateFailure instanceof Error ? updateFailure.message : 'No se pudo actualizar la oferta.')
    } finally {
      setUpdatingId(null)
    }
  }

  function startEditing(offer: Oferta) {
    setEditingId(offer.id)
    setEditTitle(offer.titulo)
    setEditDescription(offer.descripcion)
    setEditRequirements(offer.requisitos)
    setError('')
    setMessage('')
  }

  async function saveOfferEdits(event: FormEvent<HTMLFormElement>, offer: Oferta) {
    event.preventDefault()
    setSavingEditId(offer.id)
    setError('')
    setMessage('')
    try {
      const { data, error: updateError } = await supabase
        .from('ofertas')
        .update({
          titulo: editTitle.trim(),
          descripcion: editDescription.trim(),
          requisitos: editRequirements.trim(),
        })
        .eq('id', offer.id)
        .eq('empresa_id', offer.empresa_id)
        .select('id')
      if (updateError) throw new Error(`No se pudo guardar la oferta: ${updateError.message}`)
      if (!data?.length) throw new Error('La oferta no se actualizó. Verifica que siga perteneciendo a tu empresa.')

      setOffers((current) => current.map((item) => item.id === offer.id
        ? { ...item, titulo: editTitle.trim(), descripcion: editDescription.trim(), requisitos: editRequirements.trim() }
        : item))
      setEditingId(null)
      setMessage('Los cambios de la oferta se guardaron correctamente.')
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'No se pudieron guardar los cambios de la oferta.')
    } finally {
      setSavingEditId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · EMPRESA</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Mis ofertas</h1>
            <p className="mt-2 max-w-2xl text-slate-400">Publica vacantes de práctica y administra su disponibilidad.</p>
          </div>
          <Link href="/postulaciones" className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800">Ver postulaciones</Link>
        </header>

        {message && <p role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
        {loadError && (
          <section role="alert" className="mb-6 rounded-2xl border border-rose-500/30 bg-slate-800 p-6">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button type="button" onClick={() => void loadOffers()} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-700">Reintentar</button>
          </section>
        )}

        <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Publicar nueva oferta</h2>
          {!companyName && (
            <p role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Antes de publicar, registra el nombre de tu empresa en <Link href="/perfil" className="font-semibold underline">Mi perfil</Link>.
            </p>
          )}
          <form onSubmit={(event) => void createOffer(event)} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-300 md:col-span-2">Título de la vacante
              <input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
            </label>
            <label className="block text-sm font-medium text-slate-300">Descripción
              <textarea required minLength={5} maxLength={5000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
            </label>
            <label className="block text-sm font-medium text-slate-300">Requisitos
              <textarea required minLength={3} maxLength={5000} rows={4} value={requirements} onChange={(event) => setRequirements(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
            </label>
            <div className="md:col-span-2">
              <button type="submit" disabled={saving || !companyName} className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                {saving ? 'Publicando...' : 'Publicar oferta'}
              </button>
            </div>
          </form>
        </section>

        <section aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="mb-4 text-xl font-semibold text-white">Ofertas publicadas</h2>
          {loading ? (
            <p className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Cargando ofertas...</p>
          ) : offers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 p-10 text-center">
              <h3 className="text-lg font-semibold text-white">Aún no has publicado ofertas</h3>
              <p className="mt-2 text-sm text-slate-400">Completa el formulario para atraer candidatos a tu empresa.</p>
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {offers.map((offer) => (
                <li key={offer.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
                  {editingId === offer.id ? (
                    <form onSubmit={(event) => void saveOfferEdits(event, offer)} className="space-y-4">
                      <label className="block text-sm font-medium text-slate-300">Título
                        <input required maxLength={150} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                      </label>
                      <label className="block text-sm font-medium text-slate-300">Descripción
                        <textarea required minLength={5} maxLength={5000} rows={4} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                      </label>
                      <label className="block text-sm font-medium text-slate-300">Requisitos
                        <textarea required minLength={3} maxLength={5000} rows={4} value={editRequirements} onChange={(event) => setEditRequirements(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={savingEditId === offer.id} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">{savingEditId === offer.id ? 'Guardando...' : 'Guardar cambios'}</button>
                        <button type="button" disabled={savingEditId === offer.id} onClick={() => setEditingId(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-700 disabled:opacity-60">Cancelar</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="mb-1 text-sm font-medium text-emerald-300">{companyName || 'Empresa'}</p>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-white">{offer.titulo}</h3>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${offer.estado === 'activa' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{offer.estado === 'activa' ? 'Activa' : 'Cerrada'}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{offer.descripcion}</p>
                      <h4 className="mt-4 text-sm font-semibold text-slate-200">Requisitos</h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">{offer.requisitos}</p>
                    </>
                  )}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-4">
                    <span className="text-xs text-slate-500">Publicada {readableDate(offer.created_at.slice(0, 10))}</span>
                    {editingId !== offer.id && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={updatingId === offer.id} onClick={() => startEditing(offer)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60">Editar oferta</button>
                        <button type="button" disabled={updatingId === offer.id} onClick={() => void toggleOffer(offer)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${offer.estado === 'activa' ? 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10' : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'}`}>
                          {updatingId === offer.id ? 'Actualizando...' : offer.estado === 'activa' ? 'Cerrar oferta' : 'Reactivar oferta'}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
