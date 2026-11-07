import './globals.css'
import SiteFooter from '@/app/components/SiteFooter'
import ThemeToggle from '@/app/components/ThemeToggle'

export const metadata = {
  title: 'PractiHub',
  description: 'Plataforma de prácticas profesionales para estudiantes y empresas',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" data-theme="dark">
      <body className="flex min-h-screen flex-col bg-slate-900 text-slate-100 antialiased">
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <ThemeToggle />
      </body>
    </html>
  )
}