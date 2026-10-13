import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Square, Plus, BookOpenCheck, Mic, X, FileText, Sparkles, Hash, Loader2, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { USE_MOCK, FILE_ACCEPT, MAX_FILES, checkFile, uploadFile } from '../lib/api'
import { routeAuto, getModel } from '../data/models'
import { ProviderIcon } from './ui'

export default function Composer({
  onSend, streaming, onStop, autoFocus = true, initialAttached = [],
  showRouting = true, allowExpertise = true, placeholder = 'Ask anything — type # to attach Expertise',
}) {
  const { expertise, selectedModels } = useStore()
  const [text, setText] = useState('')
  const [files, setFiles] = useState([]) // { key, name, size, status: 'uploading' | 'ready' | 'error', id?, kind?, error? }
  const [attached, setAttached] = useState(initialAttached)
  const [picker, setPicker] = useState(null) // null | { query }
  const [pickIdx, setPickIdx] = useState(0)
  const ta = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])

  const options = useMemo(() => {
    if (!picker) return []
    const q = picker.query.toLowerCase()
    return expertise
      .filter((e) => e.status === 'approved' && !attached.includes(e.id))
      .filter((e) => e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q))
      .slice(0, 6)
  }, [picker, expertise, attached])

  const onChange = (v) => {
    setText(v)
    const m = allowExpertise && v.match(/(?:^|\s)#([\w-]*)$/)
    if (m) { setPicker({ query: m[1] }); setPickIdx(0) } else setPicker(null)
  }

  const attach = (id) => {
    setAttached((a) => [...a, id])
    setText((t) => t.replace(/(?:^|\s)#[\w-]*$/, (s) => (s.startsWith(' ') ? ' ' : '')))
    setPicker(null)
    ta.current?.focus()
  }

  // Each file uploads as soon as it is picked; the message only keeps the returned id.
  const updateFile = (key, patch) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  const addFiles = (list) => {
    const room = MAX_FILES - files.length
    const added = [...list].map((file, i) => {
      const key = Math.random().toString(36).slice(2)
      const error = i >= room ? `Max ${MAX_FILES} files` : checkFile(file)
      const entry = { key, name: file.name, size: file.size, status: error ? 'error' : USE_MOCK ? 'ready' : 'uploading', error }
      if (entry.status === 'uploading') {
        uploadFile(file)
          .then((meta) => updateFile(key, { status: 'ready', id: meta.id, kind: meta.kind }))
          .catch((e) => updateFile(key, { status: 'error', error: e.message }))
      }
      return entry
    })
    setFiles((fs) => [...fs, ...added])
  }
  const uploading = files.some((f) => f.status === 'uploading')
  const failed = files.some((f) => f.status === 'error')

  const send = () => {
    if (!text.trim() || streaming || uploading || failed) return
    onSend(text.trim(), { attachedExpertise: attached, files: files.map(({ id, name, size, kind }) => ({ id, name, size, kind })) })
    setText(''); setFiles([]); setAttached([])
  }

  const onKeyDown = (e) => {
    if (picker && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickIdx((i) => (i + 1) % options.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickIdx((i) => (i - 1 + options.length) % options.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); attach(options[pickIdx].id); return }
      if (e.key === 'Escape') { setPicker(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const route = showRouting && selectedModels.length === 1 && selectedModels[0] === 'auto' && text.trim().length > 6 ? routeAuto(text) : null
  const routed = route && getModel(route.modelId)

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {/* # expertise picker */}
      {picker && (
        <div className="menu bottom-full left-0 mb-2 w-full max-w-md">
          <p className="flex items-center gap-1 px-2.5 pb-1 pt-1.5 text-xs text-gray-500"><Hash size={12} /> Attach Expertise</p>
          {options.map((e, i) => (
            <button key={e.id} className={`menu-item ${i === pickIdx ? 'bg-gray-100 dark:bg-gray-800' : ''}`} onMouseDown={(ev) => { ev.preventDefault(); attach(e.id) }}>
              <BookOpenCheck size={15} className="text-accent-500" />
              <span className="flex-1">
                <span className="block">{e.name}</span>
                <span className="block text-xs text-gray-500">{e.domain} · v{e.version}</span>
              </span>
            </button>
          ))}
          {options.length === 0 && <p className="px-2.5 py-2 text-sm text-gray-500">No approved Expertise matches</p>}
        </div>
      )}

      <div className="rounded-3xl bg-gray-50 px-3 pb-2.5 pt-3 ring-1 ring-gray-200 transition focus-within:ring-gray-300 dark:bg-gray-850 dark:ring-gray-800 dark:focus-within:ring-gray-700">
        {(files.length > 0 || attached.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {attached.map((id) => {
              const e = expertise.find((x) => x.id === id)
              return (
                <span key={id} className="flex items-center gap-1.5 rounded-lg bg-accent-500/10 py-1 pl-2 pr-1 text-xs text-accent-600 ring-1 ring-accent-500/30 dark:text-accent-400">
                  <BookOpenCheck size={13} /> {e?.name}
                  <button className="rounded p-0.5 hover:bg-accent-500/20" onClick={() => setAttached((a) => a.filter((x) => x !== id))}><X size={12} /></button>
                </span>
              )
            })}
            {files.map((f) => (
              <span
                key={f.key}
                title={f.error || (f.status === 'uploading' ? 'Uploading…' : f.name)}
                className={`flex items-center gap-1.5 rounded-lg bg-white py-1 pl-2 pr-1 text-xs ring-1 dark:bg-gray-800 ${f.status === 'error' ? 'text-red-500 ring-red-500/40' : 'ring-gray-200 dark:ring-gray-700'}`}
              >
                {f.status === 'uploading' ? <Loader2 size={13} className="animate-spin" /> : f.status === 'error' ? <AlertCircle size={13} /> : <FileText size={13} />}
                {f.name}{f.status === 'error' && <span className="max-w-[16rem] truncate">· {f.error}</span>}
                <button className="rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700" onClick={() => setFiles((a) => a.filter((x) => x.key !== f.key))} title="Remove"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 outline-none placeholder:text-gray-400"
        />

        <div className="mt-2 flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={FILE_ACCEPT}
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
          <button className="icon-btn" title="Attach files" onClick={() => fileRef.current.click()}><Plus size={18} /></button>
          {allowExpertise && (
          <button
            className="btn rounded-full px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => { onChange(text + (text && !text.endsWith(' ') ? ' #' : '#')); ta.current.focus() }}
          >
            <BookOpenCheck size={14} /> Expertise
          </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            {routed && (
              <span className="mr-1 hidden items-center gap-1.5 text-xs text-gray-500 animate-fadeIn sm:flex" title={route.reason}>
                <Sparkles size={12} className="text-accent-500" /> Auto →
                <ProviderIcon providerId={routed.provider} size={14} /> {routed.name}
              </span>
            )}
            <button className="icon-btn" title="Voice input (coming soon)"><Mic size={18} /></button>
            {streaming ? (
              <button className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900" onClick={onStop} title="Stop">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white transition disabled:bg-gray-300 dark:bg-white dark:text-gray-900 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
                disabled={!text.trim() || uploading || failed}
                onClick={send}
                title={uploading ? 'Waiting for files to upload' : failed ? 'Remove the files that failed to upload' : 'Send'}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
