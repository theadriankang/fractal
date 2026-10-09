import { useState } from 'react'
import { ChevronDown, Check, Plus, X, Search, Sparkles, Zap, Coins } from 'lucide-react'
import { useStore } from '../store'
import { MODELS, PROVIDERS, getModel } from '../data/models'
import { ProviderIcon, useClickOutside } from './ui'

function Dots({ n, icon: Icon, title }) {
  return (
    <span className="flex items-center gap-0.5" title={title}>
      <Icon size={11} className="text-gray-400" />
      {[1, 2, 3, 4, 5].slice(0, title.startsWith('Cost') ? 3 : 5).map((i) => (
        <span key={i} className={`h-1 w-1 rounded-full ${i <= n ? 'bg-gray-500 dark:bg-gray-300' : 'bg-gray-300 dark:bg-gray-700'}`} />
      ))}
    </span>
  )
}

function Picker({ value, onChange, onRemove }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('all')
  const ref = useClickOutside(() => setOpen(false))
  const connections = useStore((s) => s.settings.connections)
  const model = getModel(value)

  const list = MODELS.filter(
    (m) =>
      (provider === 'all' || m.provider === provider) &&
      (m.name.toLowerCase().includes(q.toLowerCase()) || m.tags.some((t) => t.includes(q.toLowerCase()))),
  )

  const pick = (id) => { onChange(id); setOpen(false); setQ('') }

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[15px] font-medium hover:bg-gray-100 dark:hover:bg-gray-850"
        onClick={() => setOpen(!open)}
      >
        <ProviderIcon providerId={model?.provider} auto={value === 'auto'} size={20} />
        {value === 'auto' ? 'Auto' : model?.name}
        <ChevronDown size={15} className="text-gray-400" />
      </button>
      {onRemove && (
        <button className="icon-btn p-1" onClick={onRemove} title="Remove model"><X size={14} /></button>
      )}

      {open && (
        <div className="menu left-0 top-full w-[380px] p-0">
          <div className="border-b border-gray-200 p-2 dark:border-gray-800">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus className="input pl-8" placeholder="Search models or capabilities…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {[{ id: 'all', name: 'All' }, ...PROVIDERS].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${provider === p.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto p-1">
            {provider === 'all' && !q && (
              <button className="menu-item items-start py-2.5" onClick={() => pick('auto')}>
                <ProviderIcon auto size={22} />
                <span className="flex-1">
                  <span className="flex items-center gap-1.5 font-medium">Auto <span className="rounded bg-accent-500/15 px-1 text-[10px] font-semibold text-accent-500">RECOMMENDED</span></span>
                  <span className="block text-xs text-gray-500">Fractal routes each prompt to the best model for the task — coding, reasoning, live info, long docs…</span>
                </span>
                {value === 'auto' && <Check size={16} className="mt-1" />}
              </button>
            )}
            {PROVIDERS.filter((p) => list.some((m) => m.provider === p.id)).map((p) => (
              <div key={p.id}>
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {p.name} {!connections[p.id]?.enabled && <span className="normal-case text-red-400">· disabled</span>}
                </p>
                {list.filter((m) => m.provider === p.id).map((m) => (
                  <button
                    key={m.id}
                    disabled={!connections[p.id]?.enabled}
                    className="menu-item disabled:opacity-40"
                    onClick={() => pick(m.id)}
                  >
                    <ProviderIcon providerId={p.id} size={20} />
                    <span className="flex-1">
                      <span className="block font-medium">{m.name}</span>
                      <span className="flex items-center gap-2 text-[11px] text-gray-500">
                        {m.tags.slice(0, 3).join(' · ')} <span className="text-gray-400">· {m.context}</span>
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Dots n={m.speed} icon={Zap} title="Speed" />
                      <Dots n={m.cost} icon={Coins} title="Cost" />
                    </span>
                    {value === m.id && <Check size={16} />}
                  </button>
                ))}
              </div>
            ))}
            {list.length === 0 && <p className="p-4 text-center text-sm text-gray-500">No models match</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ModelSelector() {
  const { selectedModels, setSelectedModels } = useStore()
  const set = (i, id) => setSelectedModels(selectedModels.map((m, k) => (k === i ? id : m)))
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {selectedModels.map((m, i) => (
        <div key={i} className="flex items-center">
          {i > 0 && <span className="px-1 text-xs text-gray-400">vs</span>}
          <Picker
            value={m}
            onChange={(id) => set(i, id)}
            onRemove={selectedModels.length > 1 ? () => setSelectedModels(selectedModels.filter((_, k) => k !== i)) : null}
          />
        </div>
      ))}
      {selectedModels.length < 3 && (
        <button
          className="icon-btn"
          title="Compare with another model"
          onClick={() => setSelectedModels([...selectedModels, selectedModels.includes('claude-sonnet') ? 'gpt-5' : 'claude-sonnet'])}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  )
}

export function ModelBadge({ response }) {
  const m = getModel(response.modelId)
  return (
    <div className="flex items-center gap-2">
      <ProviderIcon providerId={m?.provider} size={22} />
      <span className="text-sm font-semibold">{m?.name}</span>
      {response.auto && (
        <span
          className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          title={response.auto.reason}
        >
          <Sparkles size={11} className="text-accent-500" /> Auto · {response.auto.category}
        </span>
      )}
    </div>
  )
}
