import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, BookmarkPlus, ChevronDown, Loader2, Send, Upload } from 'lucide-react'
import { useStore } from '../store'
import { insightsApi } from '../lib/api'
import { DOMAINS } from '../data/expertise'
import TopBar from '../components/TopBar'
import ChartBlock from '../components/ChartBlock'

/**
 * Data Insights — a general-purpose capability, not tied to one Intelligence Pill: upload
 * any tabular data and get back an Expertise-grounded briefing (analysis, blind spots,
 * prioritised issues, potential resolutions — "as if management were talking to the
 * relevant domain expert"), kept historically. Follow-up Q&A persists alongside the report,
 * and either the report's own finding or a specific exchange can be captured into governed
 * Expertise through the normal propose -> review -> approve loop, so discussions here
 * compound into the organisation's knowledge instead of evaporating once the tab closes.
 */
export default function Insights() {
  const { user, expertise, showToast } = useStore()
  const api = insightsApi(user)
  const fileRef = useRef(null)
  const approved = expertise.filter((e) => e.status === 'approved')

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [active, setActive] = useState(null)
  const [title, setTitle] = useState('')
  const [domains, setDomains] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      setHistory(await api.listReports())
    } catch (e) {
      showToast?.(e.message || 'Could not load past reports.')
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => { loadHistory() }, [])

  const toggleDomain = (d) => setDomains((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  const onFile = async (file) => {
    if (!file) return
    setUploading(true); setError('')
    try {
      const report = await api.generateReport(file, { title, domains })
      setActive(report)
      setTitle(''); setDomains([])
      await loadHistory()
    } catch (e) {
      setError(e.message || 'Could not generate a report from this file.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const openPast = async (id) => {
    try {
      setActive(await api.getReport(id))
    } catch (e) {
      showToast?.(e.message || 'Could not open this report.')
    }
  }

  const refreshActive = async () => {
    if (!active) return
    try {
      setActive(await api.getReport(active.id))
    } catch { /* keep showing what we have */ }
  }

  const ask = async (e) => {
    e.preventDefault()
    if (!question.trim() || !active || asking) return
    const q = question.trim()
    setAsking(true); setQuestion('')
    try {
      await api.askReport(active.id, q)
      await refreshActive() // qaHistory is persisted server-side — re-fetch so it's the source of truth
    } catch (err) {
      showToast?.(err.message || 'Could not get an answer.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar>
        <h1 className="flex items-center gap-2 text-[15px] font-semibold"><BarChart3 size={17} /> Data Insights</h1>
      </TopBar>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]">
          {/* Upload + history */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <h2 className="mb-2 text-sm font-semibold">Generate a report</h2>
              <p className="mb-3 text-xs text-gray-500">
                Upload any CSV with a category, period and numeric value column. Works for any
                domain — usage data, costs, tickets, occupancy — the agent guesses the columns
                and grounds its analysis in whichever Expertise actually matches.
              </p>
              <input
                className="mb-2 w-full rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 dark:border-gray-700"
                placeholder="Report title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="mb-3 flex flex-wrap gap-1.5">
                {DOMAINS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDomain(d)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${domains.includes(d) ? 'border-accent-500 bg-accent-500/10 text-accent-600' : 'border-gray-200 text-gray-500 dark:border-gray-700'}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <button
                className="btn-accent w-full justify-center"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Analysing…' : 'Upload CSV'}
              </button>
              {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            </div>

            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <h2 className="mb-2 text-sm font-semibold">History</h2>
              {loadingHistory ? (
                <p className="text-xs text-gray-500">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-gray-500">No reports yet — upload a CSV to generate the first one.</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => openPast(r.id)}
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-850 ${active?.id === r.id ? 'bg-gray-100 dark:bg-gray-850' : ''}`}
                      >
                        <div className="truncate font-medium">{r.title}</div>
                        <div className="text-gray-500">{new Date(r.createdAt).toLocaleString()} · {r.topIssueCount} issue{r.topIssueCount === 1 ? '' : 's'}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Active report + Q&A */}
          <div className="space-y-4">
            {!active ? (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 dark:border-gray-800">
                Upload a CSV, or pick a past report, to see the grounded analysis here.
              </div>
            ) : (
              <>
                {active.chartSpec && Object.keys(active.chartSpec).length > 0 && (
                  <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                    <ChartBlock spec={active.chartSpec} />
                  </div>
                )}
                <div
                  className="rounded-xl border border-gray-200 p-4 dark:border-gray-800 [&_table]:text-sm"
                  dangerouslySetInnerHTML={{ __html: active.html }}
                />
                {active.narrative && (
                  <CaptureInline
                    reportId={active.id}
                    initialText={active.narrative.slice(0, 400)}
                    domainHint={active.domainsCoordinated?.[0] || active.domains?.[0]}
                    approved={approved}
                    onSaved={refreshActive}
                    label="Save this analysis as Expertise"
                  />
                )}

                <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <h2 className="mb-3 text-sm font-semibold">Ask about this report</h2>
                  <div className="mb-3 space-y-4">
                    {(active.qaHistory || []).map((row, i) => (
                      <div key={i} className="space-y-1.5 border-b border-gray-100 pb-3 last:border-0 last:pb-0 dark:border-gray-850">
                        <p className="text-sm font-medium">{row.question}</p>
                        <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{row.answer}</p>
                        {row.domainsCoordinated?.length > 0 && (
                          <p className="flex items-center gap-1 text-[11px] text-gray-500">
                            <AlertTriangle size={11} /> Drew on: {row.domainsCoordinated.join(', ')}
                          </p>
                        )}
                        <CaptureInline
                          reportId={active.id}
                          qaIndex={i}
                          initialText={row.answer}
                          domainHint={row.domainsCoordinated?.[0] || active.domains?.[0]}
                          approved={approved}
                          onSaved={refreshActive}
                          label="Save this answer as Expertise"
                          compact
                        />
                      </div>
                    ))}
                    {(active.qaHistory || []).length === 0 && (
                      <p className="text-xs text-gray-500">No questions asked yet.</p>
                    )}
                  </div>
                  <form onSubmit={ask} className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 dark:border-gray-700"
                      placeholder="e.g. What are the costs involved? How does this change in the hottest month?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={asking}
                    />
                    <button className="btn-accent" disabled={asking || !question.trim()}>
                      {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Inline "capture this into Expertise" control. Lets a contributor review/edit the exact
 * text before it's sent — either as a revision Proposal against an existing approved
 * Expertise, or as a new draft — so nothing reaches governed content without a human
 * choosing the wording. Goes through api.captureInsight -> the normal Review Queue.
 */
function CaptureInline({ reportId, qaIndex, initialText, domainHint, approved, onSaved, label, compact }) {
  const { user, showToast } = useStore()
  const api = insightsApi(user)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(initialText || '')
  const [domain, setDomain] = useState(domainHint || DOMAINS[0])
  const [topic, setTopic] = useState('')
  const [expertiseId, setExpertiseId] = useState('')
  const [showDecision, setShowDecision] = useState(false)
  const [condition, setCondition] = useState('')
  const [action, setAction] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [escalateIf, setEscalateIf] = useState('')
  const [saving, setSaving] = useState(false)

  const canContribute = user?.role === 'contributor' && (user?.domains || []).includes(domain)
  const domainOptions = approved.filter((e) => e.domain === domain)

  const save = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      const body = {
        text: text.trim(),
        domain,
        topic,
        expertiseId: expertiseId || undefined,
        qaIndex,
        decisionStep: showDecision
          ? { text: text.trim(), condition, action, reasoning, escalateIf }
          : undefined,
      }
      const res = await api.captureInsight(reportId, body)
      showToast?.(res.kind === 'proposal' ? 'Sent to the Review Queue as a revision proposal.' : 'Saved as a new draft Expertise — submit it for review when ready.')
      setOpen(false)
      onSaved?.()
    } catch (e) {
      showToast?.(e.message || 'Could not save this.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1 text-[11px] text-accent-600 hover:underline ${compact ? '' : 'mt-1'}`}
      >
        <BookmarkPlus size={12} /> {label}
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <textarea
        className="w-full rounded-lg border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 dark:border-gray-700"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setExpertiseId('') }}
        >
          {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
          placeholder="Topic (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <select
          className="min-w-[180px] flex-1 rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
          value={expertiseId}
          onChange={(e) => setExpertiseId(e.target.value)}
        >
          <option value="">New draft Expertise</option>
          {domainOptions.map((e) => <option key={e.id} value={e.id}>Revise: {e.name}</option>)}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setShowDecision((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ChevronDown size={12} className={showDecision ? 'rotate-180 transition-transform' : 'transition-transform'} />
        Add structured decision logic (optional)
      </button>
      {showDecision && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700" placeholder="Condition (if...)" value={condition} onChange={(e) => setCondition(e.target.value)} />
          <input className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700" placeholder="Action (then...)" value={action} onChange={(e) => setAction(e.target.value)} />
          <input className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700" placeholder="Reasoning (because...)" value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
          <input className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-gray-700" placeholder="Escalate if..." value={escalateIf} onChange={(e) => setEscalateIf(e.target.value)} />
        </div>
      )}

      {!canContribute && (
        <p className="text-[11px] text-amber-600">You're not a {domain} contributor — this will likely be rejected server-side. Pick a domain you contribute to, or ask that expert to save it.</p>
      )}
      <div className="flex gap-2">
        <button className="btn-accent text-xs" disabled={saving || !text.trim()} onClick={save}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
        </button>
        <button className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}
