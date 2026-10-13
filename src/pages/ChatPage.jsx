import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom'
import { BookOpenCheck, ArrowRight, Eye } from 'lucide-react'
import { useStore, chatOwner } from '../store'
import { userById } from '../data/users'
import { canOpenQueue, isReviewer, isContributor } from '../lib/permissions'
import { apiFor, fromApiChat, ApiError, USE_MOCK } from '../lib/api'
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
  const { chats, newChat, sendMessage, stopGeneration, user, showToast } = useStore()
  const found = chats.find((c) => c.id === chatId)
  // Someone else's chat opens read-only, and only for people who review (e.g. a Review Queue source link).
  const mine = !found || chatOwner(found) === user.id
  const chat = mine || canOpenQueue(user) ? found : undefined
  const owner = found && !mine ? userById(chatOwner(found)) : null
  const bottom = useRef(null)
  const scroller = useRef(null)

  // Fetched source chat (from the API) when the chat isn't in the local store.
  const [sourceChat, setSourceChat] = useState(null)
  const [sourceOwner, setSourceOwner] = useState(null)

  useEffect(() => {
    // When the chat is in the local store, clear any fetched copy.
    if (found || !chatId) { setSourceChat(null); setSourceOwner(null); return }
    if (!canOpenQueue(user) || USE_MOCK) return

    let cancelled = false
    apiFor(user).getChat(chatId)
      .then((data) => {
        if (cancelled) return
        setSourceOwner({ id: data.ownerId, name: data.ownerName })
        setSourceChat(fromApiChat(data, data.ownerId))
      })
      .catch((err) => {
        if (cancelled) return
        showToast(err instanceof ApiError && err.status === 404
          ? "You don't have access to that conversation"
          : `Couldn't load the conversation — ${err.message}`)
        navigate('/', { replace: true })
      })
    return () => { cancelled = true }
  }, [chatId, found, user, navigate, showToast])

  const viewChat = chat || sourceChat
  // A chat fetched from the API (not in this person's own list) always belongs to someone else.
  const viewMine = sourceChat ? false : mine
  const viewOwner = owner || sourceOwner
  const streaming = viewChat?.messages.some((m) => m.responses?.some((r) => r.streaming))
  const lastContent = viewChat?.messages.at(-1)?.responses?.map((r) => r.content.length).join() + (viewChat?.messages.at(-1)?.detectionState || '')

  useEffect(() => {
    if (chatId && !viewChat) {
      // Mock mode or non-reviewer: no fetch fallback; go home.
      if (!USE_MOCK && canOpenQueue(user)) return // fetch is in flight
      navigate('/', { replace: true })
    }
  }, [chatId, viewChat, navigate, user])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom) bottom.current?.scrollIntoView({ block: 'end' })
  }, [lastContent, viewChat?.messages.length])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [chatId])

  const onSend = (text, opts) => {
    let id = chatId
    if (!id) { id = newChat(); navigate(`/c/${id}`) }
    sendMessage(id, text, opts)
  }

  const empty = !viewChat || viewChat.messages.length === 0

  return (
    <div className="flex h-full flex-col">
      <TopBar><ModelSelector /></TopBar>
      {empty ? (
        <Welcome onSend={onSend} />
      ) : (
        <>
          <div ref={scroller} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-8 px-4 pb-10 pt-6">
              {viewChat.messages.map((m) =>
                m.role === 'user' ? <UserMessage key={m.id} msg={m} /> : <AssistantMessage key={m.id} chatId={viewChat.id} msg={m} readOnly={!viewMine} />,
              )}
              <div ref={bottom} />
            </div>
          </div>
          {!viewMine ? (
            <p className="flex items-center justify-center gap-1.5 px-4 pb-4 text-xs text-gray-500">
              <Eye size={13} /> Viewing {viewOwner?.name || 'another person'}’s conversation as the source of a review. It’s read-only.
            </p>
          ) : (
          <div className="px-4 pb-3">
            <Composer onSend={onSend} streaming={streaming} onStop={() => stopGeneration(viewChat.id)} />
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
