import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatPage from './pages/ChatPage'
import ExpertiseLayout from './pages/ExpertiseLayout'
import ExpertiseHome, { ExpertiseDomain } from './pages/ExpertiseHome'
import ExpertiseDetail from './pages/ExpertiseDetail'
import ReviewQueue from './pages/ReviewQueue'
import MeetingRecorder from './pages/MeetingRecorder'
import Landing from './pages/Landing'

function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div key={toast.id} className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl animate-fadeIn dark:bg-white dark:text-gray-900">
      {toast.msg}
    </div>
  )
}

function Shell() {
  const { sidebarOpen } = useStore()

  return (
    <div className="flex h-full overflow-hidden">
      <div className={`transition-[width] duration-200 ${sidebarOpen ? 'w-[260px]' : 'w-0'} overflow-hidden`}>
        <Sidebar />
      </div>
      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/c/:chatId" element={<ChatPage />} />
          <Route path="/expertise" element={<ExpertiseLayout />}>
            <Route index element={<ExpertiseHome />} />
            <Route path="review" element={<ReviewQueue />} />
            <Route path="d/:slug" element={<ExpertiseDomain />} />
            <Route path=":id" element={<ExpertiseDetail />} />
          </Route>
          <Route path="/meetings" element={<MeetingRecorder />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
      <SettingsModal />
    </div>
  )
}

export default function App() {
  const { settings } = useStore()

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
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
      <Toast />
    </>
  )
}
