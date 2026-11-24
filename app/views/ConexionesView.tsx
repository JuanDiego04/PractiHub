'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import ConnectionWorkspace from '@/app/components/ConnectionWorkspace'
import { supabase } from '@/lib/supabase'

type ConnectionRole = 'instructor' | 'empresa'
type ConnectionStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada' | 'desvinculada'
type ConnectionTab = 'directorio' | 'solicitudes' | 'conexiones' | 'historial'

interface ConnectionCandidate {
  profile_id: string
  display_name: string
  profile_role: ConnectionRole
}

interface InstructorCompanyConnection {
  connection_id: string
  other_profile_id: string
  other_name: string
  other_email: string | null
  other_role: ConnectionRole
  status: ConnectionStatus
  requester_id: string
  message: string | null
  created_at: string
  updated_at: string
}

const statusLabels: Record<ConnectionStatus, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Conectados',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  desvinculada: 'Finalizada',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function ConexionesView() {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<ConnectionRole | null>(null)
  const [candidates, setCandidates] = useState<ConnectionCandidate[]>([])
  const [connections, setConnections] = useState<InstructorCompanyConnection[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ConnectionTab>('directorio')
  const [search, setSearch] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeActionId, setActiveActionId] = useState<string | null>(null)

  const loadConnections = useCallback(async () => {
    const { data, error: connectionsError } = await supabase.rpc('list_instructor_company_connections')
    if (connectionsError) throw new Error(`No se pudieron cargar las conexiones: ${connectionsError.message}`)
    setConnections((data ?? []) as InstructorCompanyConnection[])
  }, [])

  const loadCandidates = useCallback(async (query: string) => {
    const { data, error: candidatesError } = await supabase.rpc('list_instructor_company_candidates', {
      p_search: query || null,
    })
    if (candidatesError) throw new Error(`No se pudo cargar el directorio: ${candidatesError.message}`)
    setCandidates((data ?? []) as ConnectionCandidate[])
  }, [])

  const loadModule = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error(`No se pudo validar la sesión: ${authError.message}`)
      if (!user) throw new Error('Inicia sesión para consultar las conexiones.')

      const { data: profile, error: profileError } = await supabase
        .from('perfiles')
        .select('rol, estado_cuenta')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) throw new Error(`No se pudo validar tu perfil: ${profileError.message}`)
      if (profile?.estado_cuenta !== 'activo' || !['instructor', 'empresa'].includes(profile.rol)) {
        throw new Error('Este módulo está disponible para instructores y empresas con cuenta activa.')
      }

      setUserId(user.id)
      setRole(profile.rol as ConnectionRole)
      await Promise.all([loadCandidates(''), loadConnections()])
      setLoadFailed(false)
      setError('')
    } catch (loadError) {
      setLoadFailed(true)
      setError(loadError instanceof Error ? loadError.message : 'Ocurrió un error inesperado.')
    } finally {
      setLoading(false)
    }
  }, [loadCandidates, loadConnections])

  useEffect(() => {
    // The initial load updates component state after its Supabase requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModule()
  }, [loadModule])

  async function searchDirectory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearching(true)
    setError('')

    try {
      await loadCandidates(search.trim())
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'No se pudo buscar en el directorio.')
    } finally {
      setSearching(false)
    }
  }

  async function requestConnection(candidate: ConnectionCandidate) {
    setActiveActionId(candidate.profile_id)
    setError('')
    setNotice('')

    try {
      const { error: requestError } = await supabase.rpc('request_instructor_company_connection', {
        p_target_profile_id: candidate.profile_id,
        p_message: requestMessage.trim() || null,
      })

      if (requestError) throw new Error(`No se pudo enviar la solicitud: ${requestError.message}`)

      await loadConnections()
      setRequestMessage('')
      setNotice(`Solicitud enviada a ${candidate.display_name}.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ocurrió un error inesperado.')
    } finally {
      setActiveActionId(null)
    }
  }

  async function updateConnection(connection: InstructorCompanyConnection, action: string) {
    if (action === 'desvincular' && !window.confirm(`¿Finalizar la conexión con ${connection.other_name}?`)) return

    setActiveActionId(connection.connection_id)
    setError('')
    setNotice('')

    try {
      const { error: updateError } = await supabase.rpc('respond_instructor_company_connection', {
        p_connection_id: connection.connection_id,
        p_action: action,
      })

      if (updateError) throw new Error(`No se pudo actualizar la conexión: ${updateError.message}`)

      await loadConnections()
      setNotice(
        action === 'aceptar'
          ? `Conexión aceptada con ${connection.other_name}.`
          : action === 'rechazar'
            ? `Solicitud de ${connection.other_name} rechazada.`
            : action === 'cancelar'
              ? `Solicitud a ${connection.other_name} cancelada.`
              : `Conexión con ${connection.other_name} finalizada.`,
      )
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Ocurrió un error inesperado.')
    } finally {
      setActiveActionId(null)
    }
  }

  const activeConnections = connections.filter((connection) => (
    connection.status === 'pendiente' || connection.status === 'aceptada'
  ))
  const incomingCount = connections.filter((connection) => (
    connection.status === 'pendiente' && connection.requester_id !== userId
  )).length
  const connectedCount = connections.filter((connection) => connection.status === 'aceptada').length
  const selectedConnection = connections.find((connection) => (
    connection.connection_id === selectedConnectionId && connection.status === 'aceptada'
  ))

  const tabs: { id: ConnectionTab; label: string; count?: number }[] = [
    { id: 'directorio', label: role === 'empresa' ? 'Buscar instructores' : 'Buscar empresas' },
    { id: 'solicitudes', label: 'Solicitudes', count: incomingCount },
    { id: 'conexiones', label: 'Conexiones', count: connectedCount },
    { id: 'historial', label: 'Historial' },
  ]

  const visibleConnections = connections.filter((connection) => {
    if (activeTab === 'solicitudes') return connection.status === 'pendiente'
    if (activeTab === 'conexiones') return connection.status === 'aceptada'
    if (activeTab === 'historial') return !['pendiente', 'aceptada'].includes(connection.status)
    return false
  })

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold text-emerald-400">PRACTIHUB · COLABORACIÓN</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {role === 'empresa' ? 'Conexiones con instructores' : 'Conexiones con empresas'}
          </h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Encuentra organizaciones o instructores, envía solicitudes y administra las conexiones desde un solo lugar.
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p>{error}</p>
            {loadFailed && (
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  setLoadFailed(false)
                  setError('')
                  void loadModule()
                }}
                className="mt-2 font-semibold underline underline-offset-4"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {notice}
          </p>
        )}

        {loading ? (
          <div className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-8 text-slate-400">
            Cargando directorio y conexiones...
          </div>
        ) : loadFailed ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/60 px-6 py-12 text-center text-slate-400">
            No se pudo cargar el módulo de conexiones.
          </div>
        ) : role ? (
          <>
            <section className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
                <p className="text-sm text-slate-400">Solicitudes recibidas</p>
                <p className="mt-2 text-3xl font-bold text-white">{incomingCount}</p>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
                <p className="text-sm text-slate-400">Conexiones activas</p>
                <p className="mt-2 text-3xl font-bold text-white">{connectedCount}</p>
              </div>
            </section>

            {selectedConnection ? (
              <ConnectionWorkspace
                connection={selectedConnection}
                role={role}
                userId={userId}
                onBack={() => setSelectedConnectionId(null)}
              />
            ) : (
            <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 sm:p-6">
              <div role="tablist" aria-label="Secciones de conexiones" className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-700 pb-3">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold ${
                      activeTab === tab.id
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tab.label}{tab.count ? ` (${tab.count})` : ''}
                  </button>
                ))}
              </div>

              {activeTab === 'directorio' ? (
                <>
                  <form onSubmit={(event) => void searchDirectory(event)} className="mb-5 flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="connection-search">Buscar por nombre</label>
                    <input
                      id="connection-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={role === 'empresa' ? 'Buscar instructor por nombre' : 'Buscar empresa por nombre'}
                      className="min-h-11 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-emerald-400"
                    />
                    <button
                      type="submit"
                      disabled={searching}
                      className="min-h-11 rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:cursor-wait disabled:opacity-60"
                    >
                      {searching ? 'Buscando...' : 'Buscar'}
                    </button>
                  </form>

                  <label className="mb-5 block text-sm font-medium text-slate-300">
                    Mensaje para la solicitud (opcional)
                    <textarea
                      maxLength={500}
                      rows={3}
                      value={requestMessage}
                      onChange={(event) => setRequestMessage(event.target.value)}
                      placeholder="Cuéntale brevemente por qué quieres conectar."
                      className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-emerald-400"
                    />
                    <span className="mt-1 block text-right text-xs text-slate-500">{requestMessage.length}/500</span>
                  </label>

                  {candidates.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-400">
                      No encontramos resultados. Prueba otra búsqueda o vuelve a intentarlo más tarde.
                    </p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {candidates.map((candidate) => {
                        const existing = activeConnections.find((connection) => (
                          connection.other_profile_id === candidate.profile_id
                        ))
                        const isPending = existing?.status === 'pendiente'
                        const isConnected = existing?.status === 'aceptada'

                        return (
                          <article key={candidate.profile_id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                                  {candidate.profile_role === 'empresa' ? 'Empresa' : 'Instructor'}
                                </p>
                                <h2 className="mt-2 text-lg font-semibold text-white">{candidate.display_name}</h2>
                              </div>
                              <button
                                type="button"
                                disabled={Boolean(existing) || activeActionId === candidate.profile_id}
                                onClick={() => void requestConnection(candidate)}
                                className="min-h-10 shrink-0 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                              >
                                {activeActionId === candidate.profile_id
                                  ? 'Enviando...'
                                  : isConnected
                                    ? 'Conectados'
                                    : isPending
                                      ? 'Solicitud pendiente'
                                      : 'Solicitar conexión'}
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                  {candidates.length === 100 && (
                    <p className="mt-4 text-xs text-slate-500">
                      Mostramos hasta 100 resultados; utiliza la búsqueda para encontrar otros perfiles.
                    </p>
                  )}
                </>
              ) : visibleConnections.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-400">
                  {activeTab === 'solicitudes'
                    ? 'No tienes solicitudes pendientes.'
                    : activeTab === 'conexiones'
                      ? 'Aún no tienes conexiones activas.'
                      : 'Todavía no hay solicitudes anteriores.'}
                </p>
              ) : (
                <div className="space-y-4">
                  {visibleConnections.map((connection) => {
                    const incoming = connection.status === 'pendiente' && connection.requester_id !== userId
                    const outgoing = connection.status === 'pendiente' && connection.requester_id === userId

                    return (
                      <article key={connection.connection_id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-semibold text-white">{connection.other_name}</h2>
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                connection.status === 'aceptada'
                                  ? 'bg-emerald-400/10 text-emerald-300'
                                  : connection.status === 'pendiente'
                                    ? 'bg-amber-400/10 text-amber-200'
                                    : 'bg-slate-700 text-slate-300'
                              }`}>
                                {statusLabels[connection.status]}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-400">
                              {connection.other_role === 'empresa' ? 'Empresa' : 'Instructor'} · {formatDate(connection.updated_at)}
                            </p>
                            {connection.message && (
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{connection.message}</p>
                            )}
                            {connection.status === 'aceptada' && connection.other_email && (
                              <a
                                href={`mailto:${connection.other_email}`}
                                className="mt-3 inline-block text-sm font-medium text-emerald-300 underline underline-offset-4"
                              >
                                {connection.other_email}
                              </a>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            {incoming && (
                              <>
                                <button
                                  type="button"
                                  disabled={activeActionId === connection.connection_id}
                                  onClick={() => void updateConnection(connection, 'aceptar')}
                                  className="min-h-10 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                                >
                                  Aceptar
                                </button>
                                <button
                                  type="button"
                                  disabled={activeActionId === connection.connection_id}
                                  onClick={() => void updateConnection(connection, 'rechazar')}
                                  className="min-h-10 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                                >
                                  Rechazar
                                </button>
                              </>
                            )}
                            {outgoing && (
                              <button
                                type="button"
                                disabled={activeActionId === connection.connection_id}
                                onClick={() => void updateConnection(connection, 'cancelar')}
                                className="min-h-10 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                              >
                                Cancelar solicitud
                              </button>
                            )}
                            {connection.status === 'aceptada' && (
                              <>
                              <button
                                type="button"
                                onClick={() => setSelectedConnectionId(connection.connection_id)}
                                className="min-h-10 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300"
                              >
                                Abrir colaboración
                              </button>
                              <button
                                type="button"
                                disabled={activeActionId === connection.connection_id}
                                onClick={() => void updateConnection(connection, 'desvincular')}
                                className="min-h-10 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                              >
                                Finalizar conexión
                              </button>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}
