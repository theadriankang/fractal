import { Link, Outlet } from 'react-router-dom'
import { BookOpenCheck } from 'lucide-react'
import TopBar from '../components/TopBar'
import ExpertiseNav from '../components/ExpertiseNav'
import { domainGradient } from '../data/taxonomy'

// Re-exported for older imports.
export { domainGradient }

export default function ExpertiseLayout() {
  return (
    <div className="flex h-full flex-col">
      <TopBar>
        <Link to="/expertise" className="flex items-center gap-2 px-2 text-[15px] font-semibold">
          <BookOpenCheck size={18} className="text-accent-500" /> Expertise
        </Link>
      </TopBar>
      <div className="flex min-h-0 flex-1 border-t border-gray-100 dark:border-gray-850">
        <ExpertiseNav />
        <div id="expertise-scroll" className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export function Breadcrumb({ items }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-300 dark:text-gray-700">›</span>}
          {it.to ? <Link to={it.to} className="hover:text-gray-900 dark:hover:text-gray-100">{it.label}</Link> : <span>{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}
