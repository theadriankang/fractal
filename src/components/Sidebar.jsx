import { useMemo, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import {
  PanelLeftClose, SquarePen, Search, BookOpenCheck, MoreHorizontal, Pin, PinOff, Pencil, Trash2,
  Settings, RotateCcw, ShieldCheck, UserRound, Folder, ChevronDown, ChevronRight, Mic, Mail,
} from 'lucide-react'
import { useStore, reviewCount } from '../store'
import { DEMO_USERS } from '../data/users'
import { Logo, Dropdown } from './ui'

function groupChats(chats) {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const groups = { Today: [], Yesterday: [], 'Previous 7 days': [], 'Previous 30 days': [], Older: [] }
  chats.forEach((c) => {
    const t = new Date(c.updatedAt).getTime()
    const days = (startOfToday - t) / 864e5
    if (t >= startOfToday) groups.Today.push(c)
    else if (days <= 1) groups.Yesterday.push(c)
    else if (days <= 7) groups['Previous 7 days'].push(c)
    else if (days <= 30) groups['Previous 30 days'].push(c)
    else groups.Older.push(c)
  })
  return Object.entries(groups).filter(([, v]) => v.length)
}

function ChatItem({ chat }) {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const { renameChat, togglePin, deleteChat } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const active = chatId === chat.id

  if (editing)
    return (
      <input
        autoFocus
        className="input py-1.5"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { renameChat(chat.id, title || chat.title); setEditing(false) }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    )

  return (
    <div className={`group relative flex items-center rounded-lg ${active ? 'bg-gray-200 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-850'}`}>
      <NavLink to={`/c/${chat.id}`} className="flex-1 truncate px-2.5 py-1.5 text-sm" title={chat.title}>
        {chat.title}
      </NavLink>
      <div className={`absolute right-1 ${active ? 'flex' : 'hidden group-hover:flex'}`}>
        <Dropdown align="right" trigger={() => <button className="icon-btn p-1"><MoreHorizontal size={15} /></button>}>
          <button className="menu-item" onClick={() => togglePin(chat.id)}>
            {chat.pinned ? <PinOff size={15} /> : <Pin size={15} />} {chat.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="menu-item" onClick={() => setEditing(true)}><Pencil size={15} /> Rename</button>
          <button
            className="menu-item text-red-500"
            onClick={() => { deleteChat(chat.id); if (active) navigate('/') }}
          >
            <Trash2 size={15} /> Delete
          </button>
        </Dropdown>
      </div>
    </div>
  )
}

function Section({ title, icon, children, collapsible = false }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-2">
      <button
        className="flex w-full items-center gap-1 px-2.5 pb-1 pt-2 text-xs font-medium text-gray-500"
        onClick={() => collapsible && setOpen(!open)}
      >
        {collapsible && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        {icon}
        {title}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { chats, toggleSidebar, newChat, openSettings, user, switchUser, resetDemo } = useStore()
  const pending = useStore(reviewCount)
  const [q, setQ] = useState('')

  const filtered = useMemo(
    () => [...chats].filter((c) => c.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [chats, q],
  )
  const pinned = filtered.filter((c) => c.pinned)
  const folders = [...new Set(filtered.filter((c) => c.folder && !c.pinned).map((c) => c.folder))]
  const loose = filtered.filter((c) => !c.pinned && !c.folder)

  const navCls = ({ isActive }) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${isActive ? 'bg-gray-200 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-850'}`

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col bg-gray-50 dark:bg-gray-950">
      {/* header */}
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <button className="flex items-center gap-2 rounded-lg px-1 py-1" onClick={() => navigate('/')}>
          <Logo size={26} />
          <span className="text-[15px] font-semibold tracking-tight">Fractal</span>
        </button>
        <button className="icon-btn" onClick={toggleSidebar} title="Close sidebar"><PanelLeftClose size={18} /></button>
      </div>

      {/* primary nav */}
      <div className="space-y-0.5 px-2 pt-2">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-850"
          onClick={() => navigate(`/c/${newChat()}`)}
        >
          <SquarePen size={17} /> New Chat
        </button>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-lg bg-transparent py-2 pl-9 pr-2 text-sm outline-none placeholder:text-gray-500 hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-850 dark:focus:bg-gray-850"
            placeholder="Search chats"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <NavLink to="/expertise" className={navCls}>
          <BookOpenCheck size={17} />
          <span className="flex-1">Expertise</span>
          {pending > 0 && (
            <span className="rounded-full bg-accent-500/15 px-1.5 text-[11px] font-semibold text-accent-500" title="Waiting for review">
              {pending}
            </span>
          )}
        </NavLink>
        <NavLink to="/meetings" className={navCls}>
          <Mic size={17} />
          <span className="flex-1">Meeting Recorder</span>
        </NavLink>
        <NavLink to="/writing" className={navCls}>
          <Mail size={17} />
          <span className="flex-1">Writing Assistant</span>
        </NavLink>
      </div>

      {/* chats */}
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && <Section title="Pinned">{pinned.map((c) => <ChatItem key={c.id} chat={c} />)}</Section>}
        {folders.map((f) => (
          <Section key={f} title={f} icon={<Folder size={12} />} collapsible>
            {filtered.filter((c) => c.folder === f && !c.pinned).map((c) => <ChatItem key={c.id} chat={c} />)}
          </Section>
        ))}
        {groupChats(loose).map(([label, list]) => (
          <Section key={label} title={label}>{list.map((c) => <ChatItem key={c.id} chat={c} />)}</Section>
        ))}
        {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-gray-500">No chats found</p>}
      </div>

      {/* user */}
      <div className="border-t border-gray-200 p-2 dark:border-gray-850">
        <Dropdown
          className="bottom-full mb-1 w-full"
          trigger={() => (
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-850">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent-500 to-indigo-500 text-sm font-semibold text-white">
                {user.name[0]}
              </span>
              <span className="flex-1 text-left">
                <span className="block text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-gray-500">
                  {user.role === 'reviewer' ? 'Reviewer' : `Contributor · ${(user.domains || []).join(', ')}`}
                </span>
              </span>
            </button>
          )}
        >
          <button className="menu-item" onClick={() => openSettings()}><Settings size={15} /> Settings</button>
          <div className="my-1 h-px bg-gray-200 dark:bg-gray-800" />
          <p className="px-2.5 pb-1 pt-1.5 text-xs text-gray-500">Sign in as (demo)</p>
          {DEMO_USERS.map((u) => (
            <button key={u.id} className="menu-item items-start" onClick={() => switchUser(u.id)}>
              {u.role === 'reviewer' ? <ShieldCheck size={15} className="mt-0.5 shrink-0" /> : <UserRound size={15} className="mt-0.5 shrink-0" />}
              <span className="min-w-0 flex-1 text-left">
                <span className="block">{u.name} {user.id === u.id && '✓'}</span>
                <span className="block truncate text-[11px] text-gray-500">
                  {u.role === 'reviewer' ? 'Reviewer · approves all domains' : `Contributor · ${u.domains.join(', ')}`}
                </span>
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-gray-200 dark:bg-gray-800" />
          <button className="menu-item" onClick={() => { resetDemo(); navigate('/') }}><RotateCcw size={15} /> Reset demo data</button>
        </Dropdown>
      </div>
    </aside>
  )
}
