import { useState } from 'react'
import { Settings2, Plug, Sparkles, BookOpenCheck, Info, Sun, Moon, Monitor, Eye, EyeOff, CheckCircle2, Lock, X } from 'lucide-react'
import { useStore } from '../store'
import { PROVIDERS, ROUTES, getModel } from '../data/models'
import { Modal, Toggle, ProviderIcon, Logo } from './ui'

const TABS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'routing', label: 'Auto routing', icon: Sparkles },
  { id: 'expertise', label: 'Expertise', icon: BookOpenCheck },
  { id: 'about', label: 'About', icon: Info },
]

function Row({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-gray-500">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function General() {
  const { settings, updateSettings } = useStore()
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      <Row title="Theme">
        <div className="flex rounded-xl p-0.5 ring-1 ring-gray-200 dark:ring-gray-800">
          {[['light', Sun], ['dark', Moon], ['system', Monitor]].map(([t, Icon]) => (
            <button
              key={t}
              onClick={() => updateSettings({ theme: t })}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs capitalize ${settings.theme === t ? 'bg-gray-100 dark:bg-gray-800' : 'text-gray-500'}`}
            >
              <Icon size={13} /> {t}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Streaming speed" desc="Speed of the simulated responses (mock mode).">
        <select className="input w-auto" value={settings.streamSpeed} onChange={(e) => updateSettings({ streamSpeed: Number(e.target.value) })}>
          <option value={0.5}>Slow</option>
          <option value={1}>Normal</option>
          <option value={3}>Fast</option>
        </select>
      </Row>
      <Row title="Language"><select className="input w-auto"><option>English</option><option>中文</option></select></Row>
    </div>
  )
}

function Connections() {
  const { settings, updateConnection, showToast } = useStore()
  const [show, setShow] = useState({})
  return (
    <div className="space-y-2">
      <p className="mb-3 text-sm text-gray-500">
        Add a key per provider. Keys will be stored server-side once the backend exists — in this prototype they stay in your browser only.
      </p>
      {PROVIDERS.map((p) => {
        const c = settings.connections[p.id]
        return (
          <div key={p.id} className="rounded-2xl p-3 ring-1 ring-gray-200 dark:ring-gray-800">
            <div className="flex items-center gap-3">
              <ProviderIcon providerId={p.id} size={26} />
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              {c.apiKey && <span className="flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 size={13} /> Key added</span>}
              <Toggle checked={c.enabled} onChange={(v) => updateConnection(p.id, { enabled: v })} />
            </div>
            {c.enabled && (
              <div className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={show[p.id] ? 'text' : 'password'}
                    className="input pr-9 font-mono text-xs"
                    placeholder={`${p.name} API key`}
                    value={c.apiKey}
                    onChange={(e) => updateConnection(p.id, { apiKey: e.target.value })}
                  />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setShow({ ...show, [p.id]: !show[p.id] })}>
                    {show[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button className="btn-outline text-xs" onClick={() => showToast(c.apiKey ? `${p.name}: connection OK (mock)` : 'Add a key first')}>Test</button>
              </div>
            )}
          </div>
        )
      })}
      <button className="btn-outline mt-2 w-full" onClick={() => showToast('Custom OpenAI-compatible endpoints — coming with the backend')}>
        + Add OpenAI-compatible endpoint (Ollama, OpenRouter, vLLM…)
      </button>
    </div>
  )
}

function Routing() {
  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        When <b className="text-gray-700 dark:text-gray-200">Auto</b> is selected, Fractal classifies each prompt and sends it to the model best suited for that task. The real router will use a small classifier model plus cost/latency budgets — this is the mock rule table.
      </p>
      <div className="overflow-hidden rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800">
        <div className="grid grid-cols-2 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 dark:bg-gray-900">
          <span>Task type</span><span>Routed to</span>
        </div>
        {[...ROUTES, { category: 'Quick question (short prompt)', model: 'gemini-flash' }, { category: 'General (fallback)', model: 'gpt-5-mini' }].map((r) => {
          const m = getModel(r.model)
          return (
            <div key={r.category} className="grid grid-cols-2 items-center border-t border-gray-100 px-4 py-2.5 text-sm dark:border-gray-800">
              <span>{r.category}</span>
              <span className="flex items-center gap-2"><ProviderIcon providerId={m.provider} size={18} /> {m.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExpertiseSettings() {
  const { settings, updateSettings } = useStore()
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      <Row title="Auto-apply Expertise" desc="Automatically ground answers in relevant approved Expertise.">
        <Toggle checked={settings.autoApply} onChange={(v) => updateSettings({ autoApply: v })} />
      </Row>
      <Row title="Detect new Expertise in chats" desc="Suggest capturing reusable know-how when someone shares it in a conversation.">
        <Toggle checked={settings.autoDetect} onChange={(v) => updateSettings({ autoDetect: v })} />
      </Row>
      <Row title="Require human approval" desc="New Expertise and revisions must be approved by a Reviewer before use.">
        <span className="flex items-center gap-1 text-xs text-gray-500"><Lock size={13} /> Always on</span>
      </Row>
      <Row title="Only use approved Expertise" desc="Drafts and in-review Expertise are never applied to answers.">
        <span className="flex items-center gap-1 text-xs text-gray-500"><Lock size={13} /> Always on</span>
      </Row>
    </div>
  )
}

function About() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <Logo size={48} />
      <h3 className="mt-3 text-lg font-semibold">Fractal</h3>
      <p className="text-sm text-gray-500">v0.1.0 · front-end prototype</p>
      <p className="mt-4 max-w-sm text-sm text-gray-600 dark:text-gray-400">
        One workspace for every frontier model — and a governed memory of how your experts actually work.
      </p>
    </div>
  )
}

export default function SettingsModal() {
  const { settingsOpen, closeSettings, settingsTab, setSettingsTab } = useStore()
  const Body = { general: General, connections: Connections, routing: Routing, expertise: ExpertiseSettings, about: About }[settingsTab]
  return (
    <Modal open={settingsOpen} onClose={closeSettings} wide>
      <div className="flex h-[560px] max-h-[80vh]">
        <nav className="w-48 shrink-0 space-y-0.5 border-r border-gray-100 p-3 dark:border-gray-800">
          <p className="px-2.5 pb-2 text-lg font-semibold">Settings</p>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSettingsTab(id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${settingsTab === id ? 'bg-gray-100 dark:bg-gray-800' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-850'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">{TABS.find((t) => t.id === settingsTab)?.label}</h3>
            <button className="icon-btn" onClick={closeSettings}><X size={18} /></button>
          </div>
          <Body />
        </div>
      </div>
    </Modal>
  )
}
