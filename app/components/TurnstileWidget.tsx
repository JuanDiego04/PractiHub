'use client'

import Script from 'next/script'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

interface CloudflareTurnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      size: 'normal'
      appearance: 'always'
      theme: 'auto'
      language: 'es'
      retry: 'never'
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': (errorCode: string) => void
      'timeout-callback': () => void
    },
  ): string
  reset(widgetId?: string): void
}

declare global {
  interface Window {
    turnstile?: CloudflareTurnstile
  }
}

export interface TurnstileWidgetHandle {
  reset(): void
}

interface TurnstileWidgetProps {
  siteKey: string
  onTokenChange: (token: string) => void
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, onTokenChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptReady, setScriptReady] = useState(false)
    const [scriptError, setScriptError] = useState(false)
    const [widgetError, setWidgetError] = useState('')

    useImperativeHandle(ref, () => ({
      reset() {
        onTokenChange('')
        if (widgetIdRef.current !== null) {
          window.turnstile?.reset(widgetIdRef.current)
        }
      },
    }), [onTokenChange])

    useEffect(() => {
      if (!siteKey || !scriptReady || !window.turnstile || !containerRef.current) return

      let cancelled = false
      const container = containerRef.current
      if (cancelled) return

      container.replaceChildren()
      try {
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: siteKey,
          size: 'normal',
          appearance: 'always',
          theme: 'auto',
          language: 'es',
          retry: 'never',
          callback: (token) => {
            onTokenChange(token)
            setScriptError(false)
            setWidgetError('')
          },
          'expired-callback': () => onTokenChange(''),
          'error-callback': (errorCode) => {
            onTokenChange('')
            setWidgetError(errorCode)
          },
          'timeout-callback': () => onTokenChange(''),
        })
      } catch (error) {
        console.error('No se pudo inicializar Cloudflare Turnstile.', error)
        setWidgetError('No se pudo crear el widget')
      }

      return () => {
        cancelled = true
      }
    }, [onTokenChange, scriptReady, siteKey])

    if (!siteKey) {
      return (
        <div role="alert" className="space-y-1 text-sm text-amber-300">
          <p>Falta configurar Cloudflare Turnstile; el inicio de sesión y el registro están temporalmente bloqueados.</p>
          <p>
            Añade <code className="font-mono">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> a <code className="font-mono">.env.local</code>,
            configura la clave secreta en Supabase y reinicia el servidor.
          </p>
          <a
            href="https://dash.cloudflare.com/?to=/:account/turnstile"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block underline hover:text-amber-200"
          >
            Abrir Cloudflare Turnstile
          </a>
        </div>
      )
    }

    return (
      <div>
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => setScriptError(true)}
        />
        <div ref={containerRef} />
        {scriptError && (
          <p role="alert" className="mt-2 text-sm text-amber-300">
            No se pudo cargar el servicio de Turnstile. Revisa tu conexión a Internet o si la red bloquea Cloudflare.
          </p>
        )}
        {widgetError && (
          <div className="mt-2 space-y-2 text-sm text-amber-300">
            <p role="alert">
              {widgetError === '110200'
                ? 'Cloudflare rechazó la Site Key (error 110200). Copia la Site Key pública completa del widget de Turnstile —no la Secret Key— en .env.local y reinicia el servidor.'
                : `Turnstile no pudo validar el widget (${widgetError}). Confirma que la Site Key pública sea correcta y que el dominio actual esté permitido en Cloudflare.`}
            </p>
            <button
              type="button"
              onClick={() => {
                setWidgetError('')
                setScriptError(false)
                if (widgetIdRef.current !== null) {
                  window.turnstile?.reset(widgetIdRef.current)
                }
              }}
              className="underline hover:text-amber-200"
            >
              Reintentar verificación
            </button>
          </div>
        )}
      </div>
    )
  },
)

export default TurnstileWidget
