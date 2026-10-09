// Review Queue pieces for the feedback loop (docs/FEEDBACK_LOOP.md): what a 👎 proposal says,
// its before/after test, and Expertise whose ratings say it needs attention.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Loader2, AlertTriangle, ChevronDown, ChevronRight, Users, RotateCcw, Activity } from 'lucide-react'
import { useStore } from '../store'
import { DIAGNOSIS, casesForRun, healthOf } from '../lib/feedbackLoop'

const TONE = {
  red: 'bg-red-500/10 text-red-500 ring-red-500/25',
  amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400',
  indigo: 'bg-indigo-500/10 text-indigo-500 ring-indigo-500/25',
  gray: 'bg-gray-500/10 text-gray-500 ring-gray-500/25',
  green: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400',
}
const Chip = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE[tone]}`}>{children}</span>
)

/** Badges + operator reports for a proposal that came from 👎 corrections. */
export function CorrectionInfo({ p, e }) {
  if (p.origin !== 'feedback') return null
  const d = DIAGNOSIS[p.diagnosis]
  const reports = p.reports || []
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {d && <Chip tone={d.tone}>{d.label}</Chip>}
        {(p.reportCount || 1) > 1 && <Chip tone="amber"><Users size={11} /> {p.reportCount} reports</Chip>}
        {p.confidence != null && <Chip>{Math.round(p.confidence * 100)}% confidence</Chip>}
        {p.engine === 'offline' && <Chip tone="amber" title="The backend was unavailable, so keyword rules filed this. Check the section before approving.">Offline rules</Chip>}
        {p.baseVersion && p.baseVersion !== e.version && (
          <Chip tone="amber" title="The Expertise changed after this correction was made.">Based on v{p.baseVersion} · live is v{e.version}</Chip>
        )}
      </div>
      {reports.slice(-3).map((r, i) => (
        <p key={i} className="text-sm text-gray-600 dark:text-gray-400">
          <span className="italic">“{r.comment}”</span> <span className="text-xs text-gray-500">— {r.user}</span>
        </p>
      ))}
      {reports.length > 3 && <p className="text-xs text-gray-500">+ {reports.length - 3} more</p>}
    </div>
  )
}

/** Extra change lines the standard diff doesn't show: step position and "when to use". */
export function ChangeExtras({ p, e }) {
  const at = p.changes?.decisionLogic?.insertAfter
  const showAt = at != null && !(p.changes.decisionLogic.remove || []).length
  if (!showAt && !p.set?.whenToUse) return null
  return (
    <div className="space-y-2">
      {showAt && <p className="font-sans text-xs text-gray-500">↳ new step goes {at < 0 ? 'first' : `after step ${at + 1}`}</p>}
      {p.set?.whenToUse && (
        <div>
          <p className="mb-1 font-sans text-xs font-medium text-gray-500">When to use</p>
          {e.whenToUse && <p className="text-red-500">− {e.whenToUse}</p>}
          <p className="text-emerald-500">+ {p.set.whenToUse}</p>
        </div>
      )}
    </div>
  )
}

const VERDICT = {
  fixed: { label: 'Fixed', tone: 'green' },
  broke: { label: 'Broke', tone: 'red' },
  same_pass: { label: 'Both pass', tone: 'gray' },
  same_fail: { label: 'Both fail', tone: 'amber' },
  error: { label: 'Error', tone: 'amber' },
}

function Answer({ label, g }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-white p-2 ring-1 ring-gray-200 dark:bg-gray-850 dark:ring-gray-800">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
        {label} {g.ok === true ? <Chip tone="green">pass</Chip> : g.ok === false ? <Chip tone="red">fail</Chip> : <Chip tone="amber">n/a</Chip>}
      </p>
      {g.why && <p className="text-xs text-gray-600 dark:text-gray-400">{g.why}</p>}
      {g.answer && <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-gray-500">{g.answer}</p>}
    </div>
  )
}

/** "Test change": re-asks saved questions with the current and the proposed version. */
export function ChangeTest({ p, e }) {
  const runProposalTest = useStore((s) => s.runProposalTest)
  const [open, setOpen] = useState(null)
  const run = p.testRun
  const n = casesForRun(e, p).length

  if (!run) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-outline px-3 py-1.5 text-xs" disabled={!n} onClick={() => runProposalTest(p.id)}
          title={n ? '' : 'No test questions yet — 👍 good answers or submit corrections to build them up'}>
          <FlaskConical size={14} /> Test change
        </button>
        <span className="text-xs text-gray-500">
          {n ? `Re-asks ${n} question${n > 1 ? 's' : ''} with v${e.version} and the proposed version, graded blind.` : 'No test questions saved for this Expertise yet.'}
        </span>
      </div>
    )
  }
  if (run.status === 'running') {
    return <p className="mt-3 flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Testing {run.total} question{run.total > 1 ? 's' : ''} with both versions…</p>
  }

  const s = run.summary
  const simulated = run.engine === 'offline'
  const stale = run.baseVersion && run.baseVersion !== e.version
  return (
    <div className="mt-3 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FlaskConical size={15} className="text-gray-500" />
        <span className="font-medium">Proposed {s.newPass}/{s.total}</span>
        <span className="text-gray-500">· current v{run.baseVersion || e.version} {s.oldPass}/{s.total}</span>
        {s.fixed > 0 && <Chip tone="green">{s.fixed} fixed</Chip>}
        {s.broke > 0 ? <Chip tone="red">{s.broke} broke</Chip> : <Chip tone="green">nothing broke</Chip>}
        {s.errors > 0 && <Chip tone="amber">{s.errors} errors</Chip>}
        <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => runProposalTest(p.id)}>Re-run</button>
      </div>
      {simulated && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Simulated — the backend wasn't available{run.offlineReason ? ` (${run.offlineReason})` : ''}. Start it for a real test.
        </p>
      )}
      {stale && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Run against v{run.baseVersion}; the Expertise is now v{e.version}. Re-run before approving.</p>}
      <div className="mt-2 space-y-1">
        {run.results.map((r, i) => (
          <div key={r.caseId + i}>
            <button className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setOpen(open === i ? null : i)}>
              {open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Chip tone={VERDICT[r.verdict]?.tone}>{VERDICT[r.verdict]?.label || r.verdict}</Chip>
              <span className="min-w-0 flex-1 truncate">{r.question}</span>
              {r.caseId === 'proposal' && <span className="shrink-0 text-gray-500">from this correction</span>}
            </button>
            {open === i && !simulated && (
              <div className="mt-1 flex flex-col gap-2 pl-6 sm:flex-row">
                <Answer label={`Current v${run.baseVersion || e.version}`} g={r.old} />
                <Answer label="Proposed" g={r.new} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** True when approving should ask for a second look: the last real test broke something. */
export const testBroke = (p) => p.testRun?.status === 'done' && p.testRun.engine !== 'offline' && p.testRun.summary?.broke > 0

/** Approved Expertise whose ratings on the live version say a reviewer should look again. */
export function NeedsAttention() {
  const { expertise, user, rollbackExpertise } = useStore()
  const flagged = expertise
    .filter((e) => e.status === 'approved')
    .map((e) => ({ e, h: healthOf(e) }))
    .filter(({ h }) => h.flag || h.rollbackTo)
  if (!flagged.length) return null
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold">Needs attention <span className="text-sm font-normal text-gray-500">{flagged.length}</span></h2>
      <p className="mb-3 text-sm text-gray-500">Live Expertise whose recent ratings dropped. Nothing changes on its own — a reviewer decides.</p>
      <div className="space-y-3">
        {flagged.map(({ e, h }) => {
          const cur = h.byVersion[e.version]
          return (
            <div key={e.id} className="card flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500"><Activity size={17} /></span>
              <div className="min-w-0 flex-1">
                <Link to={`/expertise/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                <p className="text-sm text-amber-600 dark:text-amber-400">{h.flag?.text || `v${e.version} is rated lower than v${h.rollbackTo.version}`}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {Object.entries(h.byVersion).map(([v, x]) => `v${v}: ${Math.round(x.rate * 100)}% 👍 (${x.rated})`).join(' · ')}
                  {!cur && ' · no version-tagged ratings on the live version yet'}
                </p>
              </div>
              {h.rollbackTo && (
                <button className="btn-outline shrink-0" disabled={user.role !== 'reviewer'} title={user.role !== 'reviewer' ? 'Reviewer only' : ''}
                  onClick={() => rollbackExpertise(e.id, h.rollbackTo.version)}>
                  <RotateCcw size={14} /> Roll back to v{h.rollbackTo.version}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
