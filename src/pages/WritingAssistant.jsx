import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BookOpenCheck, Copy, FileText, Loader2, Mail, Search, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { DOMAINS } from '../data/expertise'
import { generateWriting, gmailCompose, MAX_WRITING_REFERENCES, writingReference } from '../lib/writingService'
import TopBar from '../components/TopBar'

export default function WritingAssistant() {
  const { expertise, user, showToast } = useStore()
  const location = useLocation()
  const [ids, setIds] = useState(() => location.state?.expertiseId ? [location.state.expertiseId] : [])
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState('All')
  const [mode, setMode] = useState('summary')
  const [instructions, setInstructions] = useState('')
  const [recipient, setRecipient] = useState('')
  const [tone, setTone] = useState('professional')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const request = useRef(null)
  const approved = useMemo(() => expertise.filter((e) => e.status === 'approved'), [expertise])
  const selected = useMemo(() => ids.map((id) => approved.find((e) => e.id === id)).filter(Boolean), [ids, approved])
  const visible = approved.filter((e) => (domain === 'All' || e.domain === domain) && `${e.name} ${e.summary} ${e.keywords.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const stale = result?.references.some((ref) => !approved.some((e) => e.id === ref.id && e.version === ref.version))

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (location.state?.expertiseId) {
      setIds([location.state.expertiseId])
      setResult(null)
    }
  }, [location.key])

  const change = (setter, value) => { setter(value); setResult(null); setError('') }
  const toggle = (id) => {
    const activeIds = selected.map((e) => e.id)
    if (!activeIds.includes(id) && activeIds.length >= MAX_WRITING_REFERENCES) {
      setError('Select up to 10 references at a time.'); return
    }
    change(setIds, activeIds.includes(id) ? activeIds.filter((x) => x !== id) : [...activeIds, id])
  }
  const generate = async (event) => {
    event.preventDefault()
    if (busy) return
    const references = selected.map(writingReference)
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setResult(null)
    try {
      const output = await generateWriting({ mode, instructions, recipient, sender: user.name, tone, expertise: references }, controller.signal)
      if (!controller.signal.aborted) setResult({ ...output, mode, references })
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const cancel = () => { request.current?.abort(); setBusy(false) }
  const copy = async () => {
    const text = result.mode === 'email' ? `Subject: ${result.email.subject}\n\n${result.email.body}` : result.summary
    try { await navigator.clipboard.writeText(text); showToast(result.mode === 'email' ? 'Email draft copied' : 'Summary copied') }
    catch { setError('Could not copy. Select the text and copy it manually.') }
  }
  const gmail = result?.mode === 'email' ? gmailCompose({ to: recipient, ...result.email }) : null
  const openGmail = () => {
    if (gmail.includesBody) return showToast('Draft opened in Gmail. Review it before sending.')
    // Start the copy before the new tab takes focus; Gmail opens with the subject only.
    navigator.clipboard.writeText(result.email.body)
      .then(() => showToast('Message too long for a Gmail link. It is copied — paste it into the draft.'))
      .catch(() => setError('The message is too long to open in Gmail. Copy it and paste it into the draft.'))
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar><span className="flex items-center gap-2 px-2 text-[15px] font-semibold"><Mail size={18} /> Writing Assistant</span></TopBar>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">Turn company know-how into clear communication</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">Summarize approved Expertise or draft an email with company guidance as your reference. Select the pages to use, then describe what you need.</p>
          <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <form onSubmit={generate} className="space-y-5">
              <fieldset disabled={busy} className="card min-w-0 p-5 disabled:opacity-60">
                <legend className="sr-only">Writing task</legend>
                <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-850" role="group" aria-label="Writing task">
                  {[['summary', FileText, 'Summary'], ['email', Mail, 'Email draft']].map(([value, Icon, label]) => (
                    <button key={value} type="button" aria-pressed={mode === value} onClick={() => change(setMode, value)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ${mode === value ? 'bg-white font-medium shadow-sm dark:bg-gray-700' : 'text-gray-500'}`}><Icon size={15} />{label}</button>
                  ))}
                </div>
                <label className="mt-4 block text-sm font-medium" htmlFor="writing-instructions">{mode === 'summary' ? 'What should the summary focus on?' : 'What should the email say?'}</label>
                <textarea id="writing-instructions" className="input mt-2 min-h-[100px] resize-y" value={instructions} maxLength={4000} required={mode === 'email'} onChange={(e) => change(setInstructions, e.target.value)} placeholder={mode === 'summary' ? 'e.g. Summarize the response steps and escalation rules for a new employee.' : 'e.g. Draft an update to a tenant about a water shutdown. Leave the date and affected floors as placeholders.'} />
                {mode === 'email' && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium">Recipient / audience<input className="input mt-2" value={recipient} maxLength={200} onChange={(e) => change(setRecipient, e.target.value)} placeholder="e.g. Tenant contact" /></label>
                    <label className="text-sm font-medium">Tone<select className="input mt-2" value={tone} onChange={(e) => change(setTone, e.target.value)}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option></select></label>
                  </div>
                )}
              </fieldset>
              <fieldset disabled={busy} className="card min-w-0 p-5 disabled:opacity-60">
                <legend className="sr-only">Company references</legend>
                <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-medium"><BookOpenCheck size={17} /> Company references</h2><span className="text-xs text-gray-500">{selected.length} / {MAX_WRITING_REFERENCES} selected</span></div>
                <p className="mt-1 text-xs text-gray-500">Only approved Expertise can be used.</p>
                {selected.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{selected.map((e) => <button key={e.id} type="button" onClick={() => toggle(e.id)} className="flex max-w-full items-center gap-1 rounded-lg bg-accent-500/10 px-2 py-1 text-xs text-accent-600 dark:text-accent-400" aria-label={`Remove ${e.name}`}><span className="truncate">{e.name}</span><X size={12} className="shrink-0" /></button>)}</div>}
                <div className="relative mt-4"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input aria-label="Search approved Expertise" className="input pl-9" placeholder="Search company guidance" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
                <select aria-label="Filter references by domain" className="input mt-2 text-sm" value={domain} onChange={(e) => setDomain(e.target.value)}><option value="All">All domains</option>{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                  {visible.map((e) => <label key={e.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-gray-850"><input type="checkbox" className="mt-1 accent-accent-500" checked={ids.includes(e.id)} onChange={() => toggle(e.id)} /><span className="min-w-0"><span className="block text-sm font-medium">{e.name}</span><span className="mt-0.5 block text-xs text-gray-500">{e.domain} · v{e.version} · {e.owner}</span></span></label>)}
                  {visible.length === 0 && <p className="py-5 text-center text-sm text-gray-500">{approved.length ? 'No references match your search.' : 'No approved Expertise yet. Approve a page to use it here.'}</p>}
                </div>
              </fieldset>
              {error && <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy || !selected.length || (mode === 'email' && !instructions.trim())} className="btn-primary">{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{busy ? 'Generating…' : mode === 'summary' ? 'Generate summary' : 'Draft email'}</button>
                {busy && <button type="button" onClick={cancel} className="btn-outline">Cancel</button>}
              </div>
            </form>
            <section className="card min-w-0 p-5 sm:p-6" aria-label="Writing result" aria-live="polite" aria-busy={busy}>
              <div className="flex items-center justify-between gap-3"><h2 className="font-medium">{result?.mode === 'email' ? 'Your email draft' : 'Your summary'}</h2>{result && <div className="flex shrink-0 gap-2">{gmail && <a href={gmail.url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs" onClick={openGmail}><Mail size={14} /> Open in Gmail</a>}<button type="button" className="btn-outline text-xs" onClick={copy}><Copy size={14} /> Copy</button></div>}</div>
              {!result && <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center text-gray-500"><FileText size={30} className="mb-4 text-gray-400" /><p className="text-sm">{busy ? 'Reading selected Expertise and preparing your result…' : 'Select company references to get started.'}</p><p className="mt-2 max-w-xs text-xs leading-relaxed">The result will include source pages and versions so you can check the supporting guidance.</p></div>}
              {result && <>
                {result.demo && <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">Demo preview: source excerpts only. Connect Claude for a tailored summary or email draft.</p>}
                {stale && <p role="alert" className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">A source has changed or is no longer approved. Generate again using the current references.</p>}
                {result.mode === 'summary' ? <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-gray-700 dark:text-gray-300">{result.summary}</p> : <div className="mt-5 space-y-4"><p className="text-xs text-gray-500">Editable draft · prepared for {user.name}</p><label className="block text-sm font-medium">Subject<input className="input mt-2" value={result.email.subject} onChange={(e) => setResult((r) => ({ ...r, email: { ...r.email, subject: e.target.value } }))} /></label><label className="block text-sm font-medium">Message<textarea className="input mt-2 min-h-[360px] resize-y font-normal leading-6" value={result.email.body} onChange={(e) => setResult((r) => ({ ...r, email: { ...r.email, body: e.target.value } }))} /></label></div>}
                {result.missingInformation.length > 0 && <div className="mt-6 rounded-xl bg-gray-50 p-4 dark:bg-gray-850"><h3 className="text-sm font-medium">Details to confirm</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-gray-500">{result.missingInformation.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800"><h3 className="text-sm font-medium">Supporting Expertise</h3><div className="mt-3 space-y-4">{result.citations.map((citation, i) => {
                  const ref = result.references.find((e) => e.id === citation.expertiseId)
                  return <div key={i}><Link to={`/expertise/${ref.id}`} className="text-sm font-medium text-accent-600 hover:underline dark:text-accent-400">{ref.name} · v{citation.version}</Link><p className="mt-1 text-xs text-gray-500">Owned by {ref.owner}</p><blockquote className="mt-2 border-l-2 border-gray-200 pl-3 text-sm leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-400">{citation.excerpt}</blockquote></div>
                })}</div></div>
              </>}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
