'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface ModuleLink {
  label: string
  href?: string
}

const linksByRole: Record<string, ModuleLink[]> = {
  estudiante: [
    { label: 'Mi práctica', href: '/mi-practica' },
    { label: 'Mi perfil', href: '/perfil' },
  ],
  tutor: [
    { label: 'Estudiantes asignados', href: '/estudiantes' },
    { label: 'Evaluaciones', href: '/evaluaciones' },
    { label: 'Mi perfil', href: '/perfil' },
  ],
  empresa: [
    { label: 'Postulaciones y practicantes', href: '/empresa/seguimiento' },
    { label: 'Mi perfil', href: '/perfil' },
  ],
}

function BackArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M12.5 4.5 7 10l5.5 5.5M7.5 10h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ModuleNavigation() {
  const pathname = usePathname()
  const [role, setRole] = useState<string | null>(null)
  const [hasStudentPractice, setHasStudentPractice] = useState(false)
  const [studentPracticeError, setStudentPracticeError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadRole() {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) return

      const { data, error: profileError } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return
      if (profileError || !data) return
      setRole(data.rol)
      if (data.rol === 'estudiante') {
        const { data: assignments, error: assignmentsError } = await supabase
          .from('tutor_estudiantes')
          .select('id')
          .eq('estudiante_id', user.id)
          .limit(1)
        if (cancelled) return
        if (assignmentsError) {
          setStudentPracticeError('No se pudo comprobar si el instructor habilitó tu práctica. Ejecuta supabase/student_module.sql en Supabase.')
        } else {
          setHasStudentPractice(Boolean(assignments?.length))
        }
      }
    }

    void loadRole()
    return () => {
      cancelled = true
    }
  }, [])

  const links = role
    ? (linksByRole[role] || []).filter((item) => item.href !== '/mi-practica' || hasStudentPractice)
    : []

  return (
    <nav aria-label="Navegación del módulo" className="border-b border-slate-800 bg-slate-950/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Volver al panel principal"
            title="Volver al panel principal"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-emerald-400/60 hover:text-emerald-300"
          >
            <BackArrow />
          </Link>
          <Link href="/" className="text-sm font-bold tracking-wide text-white">
            PractiHub
          </Link>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
          <Link
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
              pathname === '/' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            Panel principal
          </Link>
          {links.map((item) => item.href ? (
            <Link
              key={item.label}
              href={item.href}
              aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              aria-disabled="true"
              title="Esta sección estará disponible próximamente"
              className="shrink-0 cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-600"
            >
              {item.label} <span className="text-[10px]">PRÓXIMAMENTE</span>
            </span>
          ))}
        </div>
      </div>
      {studentPracticeError && role === 'estudiante' && (
        <p role="alert" className="mx-auto max-w-7xl px-4 pb-3 text-xs text-amber-300 sm:px-6 lg:px-10">{studentPracticeError}</p>
      )}
    </nav>
  )
}
