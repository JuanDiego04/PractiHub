'use client'

import { useEffect, useSyncExternalStore } from 'react'

type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'practichub-theme'

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function getServerThemeSnapshot(): Theme {
  return 'dark'
}

function subscribeToThemeChanges(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  function handleStorageChange(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY || (event.newValue !== 'light' && event.newValue !== 'dark')) return
    document.documentElement.dataset.theme = event.newValue
    onChange()
  }

  window.addEventListener('storage', handleStorageChange)
  return () => {
    observer.disconnect()
    window.removeEventListener('storage', handleStorageChange)
  }
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getThemeSnapshot,
    getServerThemeSnapshot,
  )

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedTheme === 'light' || savedTheme === 'dark') {
      document.documentElement.dataset.theme = savedTheme
    }
  }, [])

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = nextTheme
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Cambiar a modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
      aria-pressed={theme === 'light'}
      className="fixed bottom-4 right-4 z-50 rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 shadow-lg transition hover:border-emerald-400 hover:text-emerald-300"
    >
      {theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'}
    </button>
  )
}
