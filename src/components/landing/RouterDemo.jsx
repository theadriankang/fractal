import { useMemo, useState } from 'react'
import { MODELS, getProvider, routeAuto } from '../../data/models'

// A working preview of the composer's Auto router: it calls the same
// routeAuto() the app uses, so the landing page can't drift from the product.

const EXAMPLES = [
  'CHWST is rising and Level 23 is too warm. Is it the chiller?',
  'Why does this SQL query time out?',
  'Latest news on Singapore office rents',
  'Summarise the attached lease agreement',
  'Calculate the NPV of a chiller retrofit',
  '帮我写一份给租户的停水通知',
]

export default function RouterDemo() {
  const [prompt, setPrompt] = useState(EXAMPLES[0])
  const route = useMemo(() => (prompt.trim() ? routeAuto(prompt) : null), [prompt])
  const chosen = route && MODELS.find((m) => m.id === route.modelId)

  return (
    <div className="card p-4 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.25)] md:p-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="route-prompt" className="text-sm font-medium">Prompt</label>
        <input
          id="route-prompt"
          className="input py-3 text-base"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything"
          autoComplete="off"
        />
        <p className="text-sm text-gray-600 dark:text-gray-400" aria-live="polite">
          {chosen ? (
            <>
              Routed to <span className="font-medium text-gray-900 dark:text-gray-100">{chosen.name}</span>. Detected:{' '}
              {route.category}.
            </>
          ) : (
            'Type a prompt, or pick an example below.'
          )}
        </p>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto p-px pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            className={`btn shrink-0 whitespace-nowrap ring-1 active:scale-[0.98] ${
              ex === prompt
                ? 'bg-gray-900 text-gray-50 ring-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:ring-gray-100'
                : 'text-gray-600 ring-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-gray-800'
            }`}
          >
            {ex}
          </button>
        ))}
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {MODELS.map((m) => {
          const on = m.id === chosen?.id
          return (
            <li
              key={m.id}
              className={`rounded-xl px-3 py-2.5 ring-1 transition duration-300 ${
                on
                  ? 'bg-gray-900 text-gray-50 ring-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:ring-gray-100'
                  : `ring-gray-200 dark:ring-gray-800 ${chosen ? 'opacity-50' : ''}`
              }`}
            >
              <p className="text-sm font-medium">{m.name}</p>
              <p className={`text-xs ${on ? 'text-gray-300 dark:text-gray-600' : 'text-gray-600 dark:text-gray-400'}`}>{getProvider(m.provider).name}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
