import { useNavigate } from 'react-router-dom'
import { PanelLeftOpen, SquarePen, Settings2 } from 'lucide-react'
import { useStore } from '../store'

export default function TopBar({ children, right }) {
  const { sidebarOpen, toggleSidebar, newChat, openSettings } = useStore()
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 bg-white/80 px-3 backdrop-blur dark:bg-gray-900/80">
      {!sidebarOpen && (
        <>
          <button className="icon-btn" onClick={toggleSidebar} title="Open sidebar"><PanelLeftOpen size={18} /></button>
          <button className="icon-btn" onClick={() => navigate(`/c/${newChat()}`)} title="New chat"><SquarePen size={18} /></button>
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {right}
      <button className="icon-btn" onClick={() => openSettings()} title="Settings"><Settings2 size={18} /></button>
    </header>
  )
}
