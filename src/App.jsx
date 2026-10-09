import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatPage from './pages/ChatPage'
import ExpertiseLibrary from './pages/ExpertiseLibrary'
import ExpertiseDetail from './pages/ExpertiseDetail'
import ReviewQueue from './pages/ReviewQueue'

function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div key={toast.id} className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl animate-fadeIn dark:bg-white dark:text-gray-900">
      {toast.msg}
    </div>
  )
}

export default function App() {
  const { sidebarOpen, settings } = useStore()

  useEffect(() => {
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  return (
    <div className="flex h-full overflow-hidden">
      <div className={`transition-[width] duration-200 ${sidebarOpen ? 'w-[260px]' : 'w-0'} overflow-hidden`}>
        <Sidebar />
      </div>
      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:chatId" element={<ChatPage />} />
          <Route path="/expertise" element={<ExpertiseLibrary />} />
          <Route path="/expertise/review" element={<ReviewQueue />} />
          <Route path="/expertise/:id" element={<ExpertiseDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <SettingsModal />
      <Toast />
    </div>
  )
}
