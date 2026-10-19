import { Suspense } from 'react'
import ModuleNavigation from '@/app/components/ModuleNavigation'

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      <Suspense fallback={<div className="h-16 border-b border-slate-800 bg-slate-950/70" />}>
        <ModuleNavigation />
      </Suspense>
      {children}
    </>
  )
}