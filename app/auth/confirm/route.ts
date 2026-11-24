import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const supportedTypes = new Set<EmailOtpType>(['invite', 'recovery'])

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  if (tokenHash && type && supportedTypes.has(type)) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })
    if (error) redirect('/actualizar-contrasena?error=invalid-link')
    redirect('/actualizar-contrasena')
  }

  redirect('/actualizar-contrasena?error=invalid-link')
}
