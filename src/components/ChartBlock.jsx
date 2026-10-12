import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

// A small, print/demo-friendly palette — distinct enough at a glance, consistent across
// every chart type so a domain's color (e.g. a specific category) can stay recognizable
// across different charts in the same conversation.
const PALETTE = ['#2dd4bf', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#84cc16', '#06b6d4']

const AXIS_STYLE = { fontSize: 12, fill: 'currentColor' }

/**
 * Generic chart renderer driven by a small JSON spec — the same spec shape a model can
 * emit in a fenced ```chart block in chat (see Message.jsx), or that a Data Insights
 * report can embed. One component, several real-world chart types, so both surfaces
 * share the exact same rendering and never drift.
 *
 * Spec shapes by `type`:
 *   line | bar | area : { data: [{...}], xKey, series: [key,...] | [{key,name,color},...] }
 *   radar              : { data: [{...}], xKey, series: [...] }  (xKey = the axis labels)
 *   pie | donut         : { data: [{...}], nameKey, valueKey }
 *   scatter             : { data: [{...}], xKey, yKey, seriesKey? }  (seriesKey groups points into colored series)
 *   heatmap             : { data: [{x,y,value}], xKey?, yKey?, valueKey? }  (defaults x/y/value)
 */
export default function ChartBlock({ spec }) {
  if (!spec || typeof spec !== 'object') return null
  const { type, title, data } = spec
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800">No data to chart.</div>
  }

  const series = normalizeSeries(spec.series)

  let body
  switch (type) {
    case 'line': body = <LineChartBlock data={data} xKey={spec.xKey} series={series} />; break
    case 'bar': body = <BarChartBlock data={data} xKey={spec.xKey} series={series} stacked={spec.stacked} />; break
    case 'area': body = <AreaChartBlock data={data} xKey={spec.xKey} series={series} stacked={spec.stacked !== false} />; break
    case 'radar': body = <RadarChartBlock data={data} xKey={spec.xKey} series={series} />; break
    case 'pie': body = <PieChartBlock data={data} nameKey={spec.nameKey || 'name'} valueKey={spec.valueKey || 'value'} />; break
    case 'donut': body = <PieChartBlock data={data} nameKey={spec.nameKey || 'name'} valueKey={spec.valueKey || 'value'} donut />; break
    case 'scatter': body = <ScatterChartBlock data={data} xKey={spec.xKey || 'x'} yKey={spec.yKey || 'y'} seriesKey={spec.seriesKey} />; break
    case 'heatmap': body = <HeatmapBlock data={data} xKey={spec.xKey || 'x'} yKey={spec.yKey || 'y'} valueKey={spec.valueKey || 'value'} />; break
    default: return <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800">Unsupported chart type: {String(type)}</div>
  }

  return (
    <div className="my-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      {title && <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</p>}
      {body}
    </div>
  )
}

function normalizeSeries(series) {
  if (!series) return []
  return series.map((s, i) => (typeof s === 'string' ? { key: s, name: s, color: PALETTE[i % PALETTE.length] } : { name: s.key, color: PALETTE[i % PALETTE.length], ...s }))
}

function LineChartBlock({ data, xKey, series }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarChartBlock({ data, xKey, series, stacked }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'stack' : undefined} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function AreaChartBlock({ data, xKey, series, stacked }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.25} stackId={stacked ? 'stack' : undefined} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function RadarChartBlock({ data, xKey, series }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data}>
        <PolarGrid stroke="currentColor" opacity={0.15} />
        <PolarAngleAxis dataKey={xKey} tick={AXIS_STYLE} />
        <PolarRadiusAxis tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Radar key={s.key} dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.3} />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  )
}

function PieChartBlock({ data, nameKey, valueKey, donut }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data} dataKey={valueKey} nameKey={nameKey}
          cx="50%" cy="50%" outerRadius={90} innerRadius={donut ? 55 : 0}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function ScatterChartBlock({ data, xKey, yKey, seriesKey }) {
  const groups = seriesKey
    ? [...new Set(data.map((d) => d[seriesKey]))].map((name, i) => ({ name, color: PALETTE[i % PALETTE.length], points: data.filter((d) => d[seriesKey] === name) }))
    : [{ name: null, color: PALETTE[0], points: data }]
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} type="number" name={xKey} />
        <YAxis dataKey={yKey} tick={AXIS_STYLE} type="number" name={yKey} />
        <ZAxis range={[60, 60]} />
        <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ strokeDasharray: '3 3' }} />
        {groups.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {groups.map((g) => (
          <Scatter key={g.name ?? 'all'} name={g.name || 'Points'} data={g.points} fill={g.color} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/** Hand-rolled grid heatmap — recharts has no built-in heatmap. Good for e.g. category x
 * period intensity (exactly the "which level, which month" anomaly-grid use case). */
function HeatmapBlock({ data, xKey, yKey, valueKey }) {
  const xs = [...new Set(data.map((d) => d[xKey]))]
  const ys = [...new Set(data.map((d) => d[yKey]))]
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const at = (x, y) => data.find((d) => d[xKey] === x && d[yKey] === y)
  const colorFor = (v) => {
    if (v == null || max === min) return 'rgba(45,212,191,0.15)'
    const t = (v - min) / (max - min)
    // teal (low) -> amber (mid) -> red (high)
    const stops = [[45, 212, 191], [245, 158, 11], [239, 68, 68]]
    const seg = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2]
    const [a, b, f] = seg
    const mix = a.map((c, i) => Math.round(c + (b[i] - c) * f))
    return `rgb(${mix.join(',')})`
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="p-1" />
            {xs.map((x) => <th key={x} className="whitespace-nowrap p-1 font-medium text-gray-500">{x}</th>)}
          </tr>
        </thead>
        <tbody>
          {ys.map((y) => (
            <tr key={y}>
              <td className="whitespace-nowrap p-1 pr-2 text-right font-medium text-gray-500">{y}</td>
              {xs.map((x) => {
                const cell = at(x, y)
                const v = cell ? Number(cell[valueKey]) : null
                return (
                  <td key={x} className="p-0.5">
                    <div
                      className="flex h-9 w-14 items-center justify-center rounded text-[10px] font-medium text-gray-900"
                      style={{ background: colorFor(v) }}
                      title={`${y} / ${x}: ${v ?? '—'}`}
                    >
                      {v != null ? v.toLocaleString() : '—'}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
