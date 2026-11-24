import { Suspense } from 'react'
import UpdatePasswordView from '@/app/views/UpdatePasswordView'

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-400">Verificando enlace...</main>}>
      <UpdatePasswordView />
    </Suspense>
  )
}
