import { useEffect, useRef } from 'react'
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom'
import { BookOpenCheck, ArrowRight, Eye } from 'lucide-react'
import { useStore, chatOwner } from '../store'
import { userById } from '../data/users'
import { canOpenQueue } from '../lib/permissions'
import { SUGGESTIONS } from '../data/chats'
import ModelSelector from '../components/ModelSelector'
import Composer from '../components/Composer'
import { UserMessage, AssistantMessage } from '../components/Message'
import { Logo } from '../components/ui'
import TopBar from '../components/TopBar'

function Welcome({ onSend }) {
  const { user, expertise } = useStore()
  const location = useLocation()
  const initial = location.state?.attach ? [location.state.attach] : []
  const approved = expertise.filter((e) => e.status === 'approved').length
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
      <div className="mb-8 flex items-center gap-3 animate-fadeIn">
        <Logo size={40} />
        <h1 className="text-3xl font-medium tracking-tight">{greet}, {user.name.split(' ')[0]}</h1>
      </div>
      <Composer key={initial.join()} onSend={onSend} initialAttached={initial} />
      <div className="mx-auto mt-6 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onSend(s.prompt, {})}
            className="group rounded-2xl px-4 py-3 text-left ring-1 ring-gray-200 transition hover:bg-gray-50 dark:ring-gray-800 dark:hover:bg-gray-850"
          >
            <p className="text-sm font-medium">{s.title}</p>
            <p className="text-sm text-gray-500">{s.sub}</p>
          </button>
        ))}
      </div>
      <Link to="/expertise" className="mt-6 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
        <BookOpenCheck size={13} className="text-accent-500" />
        {approved} approved Expertise will be applied automatically when relevant <ArrowRight size={12} />
      </Link>
    </div>
  )
}

export default function ChatPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const { chats, newChat, sendMessage, stopGeneration, user } = useStore()
  const found = chats.find((c) => c.id === chatId)
  // Someone else's chat opens read-only, and only for people who review (e.g. a Review Queue source link).
  const mine = !found || chatOwner(found) === user.id
  const chat = mine || canOpenQueue(user) ? found : undefined
  const owner = found && !mine ? userById(chatOwner(found)) : null
  const bottom = useRef(null)
  const scroller = useRef(null)

  const streaming = chat?.messages.some((m) => m.responses?.some((r) => r.streaming))
  const lastContent = chat?.messages.at(-1)?.responses?.map((r) => r.content.length).join() + (chat?.messages.at(-1)?.detectionState || '')

  useEffect(() => {
    if (chatId && !chat) navigate('/', { replace: true })
  }, [chatId, chat, navigate])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom) bottom.current?.scrollIntoView({ block: 'end' })
  }, [lastContent, chat?.messages.length])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [chatId])

  const onSend = (text, opts) => {
    let id = chatId
    if (!id) { id = newChat(); navigate(`/c/${id}`) }
    sendMessage(id, text, opts)
  }

  const empty = !chat || chat.messages.length === 0

  return (
    <div className="flex h-full flex-col">
      <TopBar><ModelSelector /></TopBar>
      {empty ? (
        <Welcome onSend={onSend} />
      ) : (
        <>
          <div ref={scroller} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-8 px-4 pb-10 pt-6">
              {chat.messages.map((m) =>
                m.role === 'user' ? <UserMessage key={m.id} msg={m} /> : <AssistantMessage key={m.id} chatId={chat.id} msg={m} />,
              )}
              <div ref={bottom} />
            </div>
          </div>
          {!mine ? (
            <p className="flex items-center justify-center gap-1.5 px-4 pb-4 text-xs text-gray-500">
              <Eye size={13} /> Viewing {owner?.name || 'another person'}’s conversation as the source of a review. It’s read-only.
            </p>
          ) : (
          <div className="px-4 pb-3">
            <Composer onSend={onSend} streaming={streaming} onStop={() => stopGeneration(chat.id)} />
            <p className="mt-2 text-center text-[11px] text-gray-500">
              Fractal can make mistakes. Recommendations should be verified by a qualified person.
            </p>
          </div>
          )}
        </>
      )}
    </div>
  )
}
