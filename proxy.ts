import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { RolUsuario } from '@/lib/perfil'

const publicPaths = new Set([
  '/login',
  '/registro',
  '/admin/login',
  '/recuperar-contrasena',
  '/actualizar-contrasena',
  '/auth/confirm',
])
const roleProtectedPaths: {
  role: Exclude<RolUsuario, 'admin'>
  paths: readonly string[]
}[] = [
  { role: 'aprendiz', paths: ['/buscar-practicas', '/mi-practica'] },
  { role: 'instructor', paths: ['/estudiantes', '/evaluaciones'] },
  { role: 'empresa', paths: ['/empresa/dashboard', '/empresa/seguimiento', '/mis-ofertas', '/mis-practicantes', '/postulaciones'] },
]

function requiredRoleForPath(pathname: string): Exclude<RolUsuario, 'admin'> | null {
  for (const { role, paths } of roleProtectedPaths) {
    if (paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return role
    }
  }
  return null
}

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const destination = request.nextUrl.clone()
  destination.pathname = pathname
  destination.search = ''
  const redirectResponse = NextResponse.redirect(destination)

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  return redirectResponse
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const requiredRole = requiredRoleForPath(pathname)

  if (publicPaths.has(pathname)) return NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
      return NextResponse.redirect(new URL('/admin/login?error=config', request.url))
    }
    if (requiredRole) {
      return NextResponse.redirect(new URL('/login?error=config', request.url))
    }
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  if (isAdminRoute && !user) {
    return redirectWithCookies(request, response, '/admin/login')
  }

  if (requiredRole && !user) {
    return redirectWithCookies(request, response, '/login')
  }

  if (!user) return response

  const { data: profile, error: profileError } = await supabase
    .from('perfiles')
    .select('rol, estado_cuenta')
    .eq('id', user.id)
    .maybeSingle()

  if (authError || profileError || !profile) {
    if (isAdminRoute) return redirectWithCookies(request, response, '/admin/login')
    if (pathname === '/cuenta-pendiente') return response
    return redirectWithCookies(request, response, '/login')
  }

  if (isAdminRoute) {
    if (profile.rol !== 'admin') {
      return redirectWithCookies(request, response, '/admin/login')
    }
    if (profile.estado_cuenta !== 'activo') {
      return redirectWithCookies(request, response, '/cuenta-pendiente')
    }
    return response
  }

  if (pathname === '/cuenta-pendiente') {
    if (profile.estado_cuenta === 'activo') {
      return redirectWithCookies(request, response, profile.rol === 'admin' ? '/admin' : '/')
    }
    return response
  }

  if (profile.estado_cuenta !== 'activo') {
    return redirectWithCookies(request, response, '/cuenta-pendiente')
  }

  if (profile.rol === 'admin') {
    return redirectWithCookies(request, response, '/admin')
  }

  if (requiredRole && profile.rol !== requiredRole) {
    return redirectWithCookies(request, response, '/')
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
