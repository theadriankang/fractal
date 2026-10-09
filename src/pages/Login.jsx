import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { DEMO_USERS, DEMO_PASSWORD } from '../data/users'
import { domainMeta } from '../data/taxonomy'
import { Logo } from '../components/ui'

export function Avatar({ user, size = 32 }) {
  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${user.color}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

function DomainTag({ domain }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
      <span className={`h-1.5 w-1.5 rounded-full ${domainMeta(domain).dot}`} />
      {domain}
    </span>
  )
}

const GROUPS = [
  { role: 'reviewer', title: 'Reviewer', note: 'Sees and decides every queue item, in every domain.' },
  { role: 'contributor', title: 'Domain experts', note: 'Contribute and review — only in their own domains, never their own work.' },
  { role: 'intern', title: 'Intern', note: 'Uses approved Expertise in chat. Can’t contribute or review.' },
]

/**
 * Simulated sign-in (every demo account uses the same password). `?add=1` adds another account
 * to this device, like Claude's account switcher; already signed-in accounts are marked.
 */
export default function Login() {
  const { login, session, user } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const adding = params.get('add') === '1' && !!user
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const finish = (e, p, id) => {
    setError(null)
    setBusy(id || 'form')
    // A short beat so the click registers before the app swaps in.
    setTimeout(() => {
      const res = login(e, p)
      setBusy(null)
      if (res.error) { setError(res.error); return }
      navigate(location.state?.from || '/', { replace: true })
    }, 250)
  }
  const submit = (ev) => {
    ev.preventDefault()
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    finish(email, password)
  }

  return (
    <div className="min-h-full bg-white dark:bg-gray-900">
      <div className="mx-auto grid min-h-full max-w-5xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16">
        {/* form */}
        <section className="min-w-0 max-w-sm">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">Fractal</span>
          </div>
          {adding && (
            <Link to="/" className="mt-8 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
              <ArrowLeft size={14} /> Back to {user.name.split(' ')[0]}’s workspace
            </Link>
          )}
          <h1 className={`${adding ? 'mt-4' : 'mt-10'} text-[28px] font-semibold leading-tight tracking-tight`}>
            {adding ? 'Add another account' : 'Sign in to Fractal'}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
            Your team’s approved know-how, applied to every answer. What you can add or approve depends on the account you sign in with.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-3" noValidate>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Email</span>
              <input className="input py-2.5 text-[15px]" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@fractal.demo" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Password</span>
              <input className="input py-2.5 text-[15px]" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
            <button type="submit" className="btn-primary w-full py-2.5 text-[15px]" disabled={!!busy}>
              {busy === 'form' ? <Loader2 size={16} className="animate-spin" /> : 'Continue'}
            </button>
          </form>
          <p className="mt-4 text-xs text-gray-500">Demo environment: every account’s password is <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{DEMO_PASSWORD}</code>.</p>
        </section>

        {/* roster */}
        <section aria-labelledby="roster-title" className="min-w-0 lg:border-l lg:border-gray-200 lg:pl-16 dark:lg:border-gray-800">
          <h2 id="roster-title" className="text-base font-semibold">Or pick a demo account</h2>
          <div className="mt-4 space-y-6">
            {GROUPS.map((g) => (
              <div key={g.role}>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{g.title}</p>
                <p className="text-xs text-gray-500">{g.note}</p>
                <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-850">
                  {DEMO_USERS.filter((u) => u.role === g.role).map((u) => {
                    const signedIn = session.signedIn.includes(u.id)
                    return (
                      <li key={u.id}>
                        <button
                          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-gray-850"
                          onClick={() => finish(u.email, DEMO_PASSWORD, u.id)}
                          title={`Sign in as ${u.email}`}
                          disabled={!!busy}
                        >
                          <Avatar user={u} size={34} />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="shrink-0 whitespace-nowrap text-sm font-medium">{u.name}</span>
                              <span className="min-w-0 truncate text-xs text-gray-500">{u.title}</span>
                            </span>
                            {u.domains.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-1">{u.domains.map((d) => <DomainTag key={d} domain={d} />)}</span>
                            )}
                          </span>
                          {busy === u.id ? <Loader2 size={15} className="animate-spin text-gray-400" />
                            : signedIn ? <span className="flex items-center gap-1 text-xs text-gray-500"><Check size={13} /> Signed in</span>
                              : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
