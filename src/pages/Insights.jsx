import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, Loader2, Send, Upload } from 'lucide-react'
import { useStore } from '../store'
import { insightsApi } from '../lib/api'
import { DOMAINS } from '../data/expertise'
import TopBar from '../components/TopBar'

const SEVERITY_STYLE = {
  high: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
}

/**
 * Data Insights — a general-purpose capability, not tied to one Intelligence Pill: upload
 * any tabular data, get an automated analysis report with proactively-flagged top issues
 * (kept historically), then ask follow-up questions the platform answers by pulling in
 * whichever domains' approved Expertise are actually relevant. This is the direct answer
 * to the Keppel webinar's worked example — "an agent that takes raw data, generates
 * analysis and a report automatically ... and proactively flags the top 5 issues ... [and
 * can] discuss the data ... as if it were the [domain] manager" — built domain-agnostic.
 */
export default function Insights() {
  const { user, showToast } = useStore()
  const api = insightsApi(user)
  const fileRef = useRef(null)

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [active, setActive] = useState(null)
  const [title, setTitle] = useState('')
  const [domains, setDomains] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [qa, setQa] = useState([]) // [{question, answer, expertiseUsed, domainsCoordinated}]

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const rows = await api.listReports()
      setHistory(rows)
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
      setQa([])
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
      const report = await api.getReport(id)
      setActive(report)
      setQa([])
    } catch (e) {
      showToast?.(e.message || 'Could not open this report.')
    }
  }

  const ask = async (e) => {
    e.preventDefault()
    if (!question.trim() || !active || asking) return
    const q = question.trim()
    setAsking(true); setQuestion('')
    try {
      const res = await api.askReport(active.id, q)
      setQa((rows) => [...rows, { question: q, ...res }])
    } catch (err) {
      setQa((rows) => [...rows, { question: q, answer: `(Error: ${err.message || 'could not answer'})`, expertiseUsed: [], domainsCoordinated: [] }])
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
                domain — usage data, costs, tickets, occupancy — the agent guesses the columns.
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
                Upload a CSV, or pick a past report, to see the automated analysis here.
              </div>
            ) : (
              <>
                <div
                  className="rounded-xl border border-gray-200 p-4 dark:border-gray-800 [&_table]:text-sm"
                  dangerouslySetInnerHTML={{ __html: active.html }}
                />

                <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <h2 className="mb-3 text-sm font-semibold">Ask about this report</h2>
                  <div className="mb-3 space-y-3">
                    {qa.map((row, i) => (
                      <div key={i} className="space-y-1.5">
                        <p className="text-sm font-medium">{row.question}</p>
                        <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{row.answer}</p>
                        {row.domainsCoordinated?.length > 0 && (
                          <p className="flex items-center gap-1 text-[11px] text-gray-500">
                            <AlertTriangle size={11} /> Drew on: {row.domainsCoordinated.join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
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
