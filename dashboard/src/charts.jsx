import React from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from 'recharts';
import { METRICS, YEAR_COLORS, fmtCompact, fmtMoney } from './pnl.js';

const axisTick = { fill: 'var(--text-muted)', fontSize: 12 };
const axisProps = { tick: axisTick, tickLine: false, axisLine: { stroke: 'var(--baseline)' } };
const grid = <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />;
const MAX_BAR = 24;

// ---------- shared pieces ----------

export function Legend({ items }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`key${it.line ? ' line' : ''}`} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="t-title">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div className="t-row" key={p.dataKey}>
          <span><span className="key" style={{ background: p.color || p.payload?.fill }} />{p.name}</span>
          <b>{fmtMoney(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

/** Rect with a 4px rounded data-end and a square baseline end, for positive and negative values. */
function roundedPath(x, y, w, h, r, end) {
  r = Math.min(r, w / 2, h / 2);
  const tl = end === 'top' || end === 'left' ? r : 0;
  const tr = end === 'top' || end === 'right' ? r : 0;
  const br = end === 'bottom' || end === 'right' ? r : 0;
  const bl = end === 'bottom' || end === 'left' ? r : 0;
  return `M${x + tl},${y} H${x + w - tr} Q${x + w},${y} ${x + w},${y + tr} V${y + h - br} Q${x + w},${y + h} ${x + w - br},${y + h} H${x + bl} Q${x},${y + h} ${x},${y + h - bl} V${y + tl} Q${x},${y} ${x + tl},${y} Z`;
}

const dataEndBar = (dataKey, horizontal) => (props) => {
  let { x, y, width, height, fill, payload } = props;
  if (width < 0) { x += width; width = -width; }
  if (height < 0) { y += height; height = -height; }
  if (!width || !height) return null;
  const v = payload?.[dataKey] ?? 0;
  const end = horizontal ? (v >= 0 ? 'right' : 'left') : v >= 0 ? 'top' : 'bottom';
  return <path d={roundedPath(x, y, width, height, 4, end)} fill={fill} />;
};

/** Direct label at the last point of a line (selective labelling: endpoint only). */
const endLabel = (lastIndex, text) => ({ x, y, index }) =>
  index === lastIndex ? (
    <text x={x + 8} y={y} dy={4} fill="var(--text-secondary)" fontSize={12}>{text}</text>
  ) : null;

const activeDot = { r: 5, stroke: 'var(--surface-1)', strokeWidth: 2 };

// ---------- charts ----------

/** Monthly / quarterly: revenue and costs as columns, net income as a line - all dollars on one axis. */
export function TrendChart({ buckets }) {
  const last = buckets.length - 1;
  return (
    <>
      <Legend
        items={[
          { label: METRICS.revenue.label, color: METRICS.revenue.color },
          { label: METRICS.costs.label, color: METRICS.costs.color },
          { label: METRICS.netIncome.label, color: METRICS.netIncome.color, line: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={buckets} margin={{ top: 8, right: 72, bottom: 0, left: 8 }} barGap={2}>
          {grid}
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={fmtCompact} width={64} />
          <ReferenceLine y={0} stroke="var(--baseline)" />
          <Tooltip
            content={<ChartTooltip labelFormatter={(l, p) => (p[0]?.payload.partial ? `${l} (partial)` : l)} />}
            cursor={{ fill: 'var(--grid)', opacity: 0.5 }}
          />
          <Bar dataKey="revenue" name="Revenue" fill={METRICS.revenue.color} maxBarSize={MAX_BAR} shape={dataEndBar('revenue')} isAnimationActive={false} />
          <Bar dataKey="costs" name="Costs" fill={METRICS.costs.color} maxBarSize={MAX_BAR} shape={dataEndBar('costs')} isAnimationActive={false} />
          <Line
            dataKey="netIncome" name="Net income" stroke={METRICS.netIncome.color} strokeWidth={2}
            dot={false} activeDot={activeDot} isAnimationActive={false}
            label={endLabel(last, `Net ${fmtCompact(buckets[last]?.netIncome)}`)}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

/** YOY: one line per calendar year across Jan-Dec. Year colors are keyed off all years in the data so they don't shift. */
export function YoyChart({ years, allYears, data, metric }) {
  const colorOf = (y) => YEAR_COLORS[allYears.indexOf(y) % YEAR_COLORS.length];
  const lastIdx = (y) => data.reduce((last, d, i) => (d[y] != null ? i : last), -1);
  return (
    <>
      <Legend items={years.map((y) => ({ label: y, color: colorOf(y), line: true }))} />
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 48, bottom: 0, left: 8 }}>
          {grid}
          <XAxis dataKey="month" {...axisProps} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={fmtCompact} width={64} />
          <ReferenceLine y={0} stroke="var(--baseline)" />
          <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} - ${METRICS[metric].label}`} />} cursor={{ stroke: 'var(--baseline)' }} />
          {years.map((y) => (
            <Line
              key={y} dataKey={y} name={y} stroke={colorOf(y)} strokeWidth={2} connectNulls={false}
              dot={{ r: 3, strokeWidth: 0, fill: colorOf(y) }} activeDot={activeDot} isAnimationActive={false}
              label={endLabel(lastIdx(y), y)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

function TruncTick({ x, y, payload, max = 26 }) {
  const s = String(payload.value);
  const short = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--text-secondary)" fontSize={12}>
      <title>{s}</title>
      {short}
    </text>
  );
}

const tipLabel = ({ x, y, width, height, value }) => {
  const neg = value < 0;
  return (
    <text x={neg ? x + width - 6 : x + width + 6} y={y + height / 2} dy={4} textAnchor={neg ? 'end' : 'start'} fill="var(--text-secondary)" fontSize={12}>
      {fmtCompact(value)}
    </text>
  );
};

/** Ranked horizontal bars: office comparison and top accounts. Single series, so no legend - the card title names it. */
export function RankedBars({ items, color, name, labelWidth = 170 }) {
  const height = Math.max(120, items.length * 30 + 32);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={items} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }} barCategoryGap={4}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={fmtCompact} />
        <YAxis type="category" dataKey="name" width={labelWidth} tick={<TruncTick />} tickLine={false} axisLine={{ stroke: 'var(--baseline)' }} interval={0} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--grid)', opacity: 0.5 }} />
        <Bar dataKey="value" name={name} fill={color} maxBarSize={20} shape={dataEndBar('value', true)} isAnimationActive={false}>
          <LabelList dataKey="value" content={tipLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
