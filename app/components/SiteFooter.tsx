export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 px-6 pb-20 pt-8 text-slate-300">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold text-white">PractiHub</p>
          <p className="mt-1 text-sm">Conectando estudiantes con oportunidades de práctica.</p>
          <p className="mt-2 text-xs text-slate-400">
            Desarrollado por Juan Diego de la Ossa Carmona
          </p>
        </div>
        <address className="flex flex-col gap-1 text-sm not-italic">
          <a className="hover:text-emerald-400" href="mailto:delaossajuan18@Gmail.com">
            delaossajuan18@Gmail.com
          </a>
          <a className="hover:text-emerald-400" href="tel:+573043192943">
            +57 304 319 2943
          </a>
        </address>
      </div>
    </footer>
  )
}
