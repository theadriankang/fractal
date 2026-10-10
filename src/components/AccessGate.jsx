import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { USE_MOCK, checkAccess, setAccessCode } from '../lib/api'

/**
 * Public-demo gate. When the backend has ACCESS_CODE set, visitors enter the shared
 * code once (stored in this browser) before the app loads. Mock mode, local dev
 * without a code, and an unreachable backend all pass straight through.
 */
export default function AccessGate({ children }) {
  const [state, setState] = useState(USE_MOCK ? 'open' : 'checking')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (USE_MOCK) return
    checkAccess()
      .then((r) => setState(r.required && !r.ok ? 'locked' : 'open'))
      .catch(() => setState('open')) // backend offline: let the app show its own offline handling
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const r = await checkAccess(code.trim())
      if (r.ok) { setAccessCode(code.trim()); setState('open') }
      else setError("That code isn't right.")
    } catch {
      setError('Could not reach the server. Try again in a moment.')
    }
  }

  if (state === 'open') return children
  if (state === 'checking') return <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading…</div>

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-500"><KeyRound size={18} /></span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Fractal demo</h1>
        <p className="mt-1 text-sm text-gray-500">Enter the access code you were given to try the demo.</p>
        <input
          autoFocus
          className="input mt-4 w-full py-2.5"
          placeholder="Access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <button className="btn-accent mt-4 w-full justify-center" disabled={!code.trim()}>Continue</button>
      </form>
    </div>
  )
}
