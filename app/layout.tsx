import './globals.css'

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
    <html lang="es">
      <body className="bg-slate-900 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  )
}