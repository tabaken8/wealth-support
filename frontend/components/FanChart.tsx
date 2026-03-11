'use client';

import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import { SimulateResponse, AssetStat, FutureChange, LumpSumAddition } from '@/types';

interface FanChartProps {
  data: SimulateResponse;
  goal: number;
  years: number;
  age: number;
  savings: number;
  monthly: number;
  futureChanges?: FutureChange[];
  lumpSumAdditions?: LumpSumAddition[];
  activeScenario?: 'p10' | 'p50' | 'p90';
  /** Backend-computed deposit terminal — passed in to keep arrow in sync with stats panel */
  depositTerminalValue?: number;
}

// 定期預金の年利（0.3%） — 日本の定期預金の目安
const DEPOSIT_ANNUAL_RATE = 0.003;

/** Deterministic deposit path — same every render (no randomness) */
function generateDepositPath(
  savings: number,
  monthly: number,
  months: number,
  futureChanges: FutureChange[],
  lumpSumAdditions: LumpSumAddition[],
): number[] {
  const rMonthly = Math.pow(1 + DEPOSIT_ANNUAL_RATE, 1 / 12) - 1;

  const contribs = Array.from({ length: months }, () => monthly);
  for (const chg of futureChanges) {
    const from = Math.max(0, Math.min(chg.from_month, months));
    for (let m = from; m < months; m++) contribs[m] += chg.monthly_delta;
  }
  const lumps = new Array(months + 1).fill(0);
  for (const ls of lumpSumAdditions) {
    if (ls.at_month >= 0 && ls.at_month <= months) lumps[ls.at_month] += ls.amount;
  }

  const path: number[] = [savings + lumps[0]];
  let v = savings + lumps[0];
  for (let m = 0; m < months; m++) {
    v = v * (1 + rMonthly) + contribs[m] + lumps[m + 1];
    path.push(Math.max(0, v));
  }
  return path;
}

// ── Gaussian random (Box-Muller) ──────────────────────────────────────────────
function gauss(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateAssetPath(
  savings: number,
  monthly: number,
  months: number,
  annualReturn: number,
  annualVol: number,
  futureChanges: FutureChange[],
  lumpSumAdditions: LumpSumAddition[],
): number[] {
  const mu = annualReturn / 12;
  const sigma = annualVol / Math.sqrt(12);

  const contribs = Array.from({ length: months }, () => monthly);
  for (const chg of futureChanges) {
    const from = Math.max(0, Math.min(chg.from_month, months));
    for (let m = from; m < months; m++) contribs[m] += chg.monthly_delta;
  }

  const lumps = new Array(months + 1).fill(0);
  for (const ls of lumpSumAdditions) {
    if (ls.at_month >= 0 && ls.at_month <= months) lumps[ls.at_month] += ls.amount;
  }

  const path: number[] = [savings + lumps[0]];
  let v = savings + lumps[0];
  for (let m = 0; m < months; m++) {
    const r = mu + sigma * gauss();
    v = v * (1 + r) + contribs[m] + lumps[m + 1];
    path.push(v);
  }
  return path;
}

/** Portfolio path with jump-diffusion — matches backend's run_monte_carlo exactly.
 *  equityWeight controls jump intensity (same formula as backend). */
function generatePortfolioPath(
  savings: number,
  monthly: number,
  months: number,
  annualReturn: number,
  annualVol: number,
  equityWeight: number,
  futureChanges: FutureChange[],
  lumpSumAdditions: LumpSumAddition[],
): number[] {
  const mu          = annualReturn / 12;
  const sigma       = annualVol / Math.sqrt(12);
  // Merton jump params — identical to backend
  const lambdaJump  = equityWeight * 0.030;
  const jumpMean    = -0.12 * equityWeight;
  const jumpStd     =  0.06 * equityWeight;

  const contribs = Array.from({ length: months }, () => monthly);
  for (const chg of futureChanges) {
    const from = Math.max(0, Math.min(chg.from_month, months));
    for (let m = from; m < months; m++) contribs[m] += chg.monthly_delta;
  }
  const lumps = new Array(months + 1).fill(0);
  for (const ls of lumpSumAdditions) {
    if (ls.at_month >= 0 && ls.at_month <= months) lumps[ls.at_month] += ls.amount;
  }

  const path: number[] = [savings + lumps[0]];
  let v = savings + lumps[0];
  for (let m = 0; m < months; m++) {
    let r = mu + sigma * gauss();
    // Random crash event (Bernoulli) — same probability as backend
    if (Math.random() < lambdaJump) {
      r += jumpMean + jumpStd * gauss();
    }
    v = v * (1 + r) + contribs[m] + lumps[m + 1];
    path.push(v);
  }
  return path;
}

function fmtJPY(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}億円`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000)}万円`;
  return `${Math.round(v).toLocaleString()}円`;
}

// ── Right-edge arrow annotation (recharts Customized) ────────────────────────

interface EdgeArrowProps {
  xAxisMap?: Record<string, { scale: (v: number) => number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  totalMonths?: number;
  scenarioTerminal?: number;
  depositTerminal?: number;
  yMax?: number;
}

function EdgeArrow({
  xAxisMap, yAxisMap,
  totalMonths, scenarioTerminal, depositTerminal, yMax,
}: EdgeArrowProps) {
  if (totalMonths == null || scenarioTerminal == null || depositTerminal == null || yMax == null) return null;
  const xAxis = xAxisMap ? (Object.values(xAxisMap)[0] as any) : null;
  const yAxis = yAxisMap ? (Object.values(yAxisMap)[0] as any) : null;
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const x = xAxis.scale(totalMonths);
  // Clamp to yMax so values above domain still get a sensible pixel position
  const yS = yAxis.scale(Math.min(scenarioTerminal, yMax));
  const yD = yAxis.scale(Math.min(depositTerminal, yMax));

  if (Math.abs(yS - yD) < 12) return null; // gap too small to draw

  const surplus = scenarioTerminal - depositTerminal;
  const isUp = surplus >= 0;
  const color = isUp ? '#10b981' : '#ef4444';
  const topY = Math.min(yS, yD);
  const botY = Math.max(yS, yD);
  const midY = (topY + botY) / 2;
  const ax = x + 8; // annotation x (inside right margin)

  const abs = Math.abs(surplus);
  const shortLabel = abs >= 100_000_000
    ? `${isUp ? '+' : '-'}${(abs / 100_000_000).toFixed(1)}億`
    : abs >= 10_000
      ? `${isUp ? '+' : '-'}${Math.round(abs / 10_000)}万`
      : `${isUp ? '+' : '-'}${Math.round(abs)}円`;

  // deposit end y (the horizontal tick)
  const tickY = isUp ? botY : topY;
  // arrowhead y (where the investment advantage ends)
  const arrowY = isUp ? topY : botY;

  return (
    <g>
      {/* Dashed vertical line */}
      <line
        x1={ax} y1={topY + 4} x2={ax} y2={botY - 4}
        stroke={color} strokeWidth={1.5} strokeDasharray="3 2"
      />
      {/* Arrowhead pointing toward the investment value */}
      {isUp ? (
        <polygon points={`${ax},${arrowY} ${ax - 4},${arrowY + 9} ${ax + 4},${arrowY + 9}`} fill={color} />
      ) : (
        <polygon points={`${ax},${arrowY} ${ax - 4},${arrowY - 9} ${ax + 4},${arrowY - 9}`} fill={color} />
      )}
      {/* Tick at deposit baseline */}
      <line x1={ax - 4} y1={tickY} x2={ax + 4} y2={tickY} stroke={color} strokeWidth={1.5} />
      {/* Label pill */}
      <rect
        x={ax + 6} y={midY - 9} width={48} height={18} rx={3}
        fill={isUp ? '#f0fdf4' : '#fff1f2'} stroke={color} strokeWidth={0.5} fillOpacity={0.95}
      />
      <text
        x={ax + 30} y={midY} fill={color} fontSize={10} fontWeight="bold"
        textAnchor="middle" dominantBaseline="middle"
      >
        {shortLabel}
      </text>
    </g>
  );
}

function fmtAxis(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}億`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}万`;
  return `${Math.round(v)}`;
}

const CustomTooltip = ({
  active, payload, age, assetStats,
}: {
  active?: boolean;
  payload?: any[];
  age: number;
  assetStats: AssetStat[];
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const ageAt = age + d.month / 12;
  const label = Number.isInteger(ageAt) ? `${ageAt}歳` : `${d.month}ヶ月目`;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[170px]">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      {[
        { l: '上位10%', v: d.p90, cls: 'text-blue-300' },
        { l: '上位25%', v: d.p75, cls: 'text-blue-400' },
        { l: '中央値',  v: d.p50, cls: 'text-blue-600 font-bold' },
        { l: '下位25%', v: d.p25, cls: 'text-blue-400' },
        { l: '下位10%', v: d.p10, cls: 'text-blue-300' },
      ].map(({ l, v, cls }) => (
        <div key={l} className="flex justify-between gap-3">
          <span className="text-slate-400">{l}</span>
          <span className={cls}>{fmtJPY(v)}</span>
        </div>
      ))}
      {/* Deposit comparison */}
      {d['deposit'] != null && (
        <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-slate-100">
          <span className="text-amber-600">定期預金</span>
          <span className="font-medium text-amber-600">{fmtJPY(d['deposit'])}</span>
        </div>
      )}
      {assetStats.map(s => {
        const val = d[`path_${s.ticker}`];
        if (val == null) return null;
        return (
          <div key={s.ticker} className="flex justify-between gap-3 mt-1 pt-1 border-t border-slate-100">
            <span style={{ color: s.color }}>{s.label.split('（')[0]}</span>
            <span className="font-medium" style={{ color: s.color }}>{fmtJPY(val)}</span>
          </div>
        );
      })}
      {assetStats.length > 0 && d['path_portfolio'] != null && (
        <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-slate-200">
          <span className="font-semibold text-slate-700">合計</span>
          <span className="font-bold text-slate-800">{fmtJPY(d['path_portfolio'])}</span>
        </div>
      )}
    </div>
  );
};

export default function FanChart({
  data, goal, years, age, savings, monthly,
  futureChanges = [], lumpSumAdditions = [],
  activeScenario = 'p50',
  depositTerminalValue,
}: FanChartProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPaths, setShowPaths] = useState(true);
  const { percentiles, asset_stats } = data;
  const totalMonths = years * 12;
  const step = totalMonths > 120 ? 3 : totalMonths > 60 ? 2 : 1;

  // Y-axis domain: zoom into the interesting range so the fan looks like a proper spread.
  // yMin: just below initial savings (removes the large empty bottom area)
  // yMax: p90 × 1.15 instead of × 1.5 (removes large empty top area)
  // Together these make the fan occupy ~50-60% of chart height, like Bollinger Bands.
  const yMin = Math.max(0, savings * 0.8);
  const yMax = useMemo(() => {
    const finalP90 = percentiles['90'][totalMonths] ?? 0;
    const raw = finalP90 > 0 ? finalP90 * 1.15 : (goal * 1.5 || 1_000_000);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return Math.ceil(raw / mag) * mag;
  }, [data, totalMonths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate one representative path per asset on refresh
  const assetPaths = useMemo(() => {
    return asset_stats.map(stat => ({
      ...stat,
      path: generateAssetPath(
        savings, monthly, totalMonths,
        stat.annual_return, stat.annual_vol,
        futureChanges, lumpSumAdditions,
      ),
    }));
  // refreshKey intentionally included to trigger re-generation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, savings, monthly, years, refreshKey]);

  // Deterministic deposit path (never changes on refresh)
  const depositPath = useMemo(() => generateDepositPath(
    savings, monthly, totalMonths, futureChanges, lumpSumAdditions,
  ), [savings, monthly, totalMonths, futureChanges, lumpSumAdditions]);

  // Equity weight: needed for jump-diffusion intensity (same as backend)
  const equityWeight = useMemo(() =>
    asset_stats
      .filter(s => ['VT', 'SPY', 'EWJ', 'FNGS', 'BTC-USD'].includes(s.ticker))
      .reduce((sum, s) => sum + s.weight, 0),
  [asset_stats]);

  // Portfolio path with Merton jump-diffusion — matches backend run_monte_carlo exactly,
  // so the black line is drawn from the same distribution as the blue fan band.
  const portfolioPath = useMemo(() => {
    return generatePortfolioPath(
      savings, monthly, totalMonths,
      data.expected_annual_return, data.annual_volatility,
      equityWeight,
      futureChanges, lumpSumAdditions,
    );
  // refreshKey triggers re-generation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, savings, monthly, years, equityWeight, refreshKey]);

  // Terminal values for right-edge annotation
  // depositTerminalValue from backend takes priority to stay in sync with the stats panel below
  const scenarioPctKey = activeScenario === 'p10' ? '10' : activeScenario === 'p90' ? '90' : '50';
  const scenarioTerminal = percentiles[scenarioPctKey as keyof typeof percentiles][totalMonths] ?? 0;
  const depositTerminal = depositTerminalValue ?? depositPath[totalMonths] ?? 0;

  const chartData = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= totalMonths; i += step) {
      const p10 = Math.max(0, percentiles['10'][i] ?? 0);
      const p25 = Math.max(0, percentiles['25'][i] ?? 0);
      const p50 = Math.max(0, percentiles['50'][i] ?? 0);
      const p75 = Math.max(0, percentiles['75'][i] ?? 0);
      const p90 = Math.max(0, percentiles['90'][i] ?? 0);
      const pt: Record<string, number> = {
        month: i,
        p10, p25, p50, p75, p90,
        base: p10,
        d10_25: Math.max(0, p25 - p10),
        d25_50: Math.max(0, p50 - p25),
        d50_75: Math.max(0, p75 - p50),
        d75_90: Math.max(0, p90 - p75),
      };
      // Deposit always included (deterministic, never changes on refresh)
      pt['deposit'] = depositPath[i] ?? 0;

      if (showPaths) {
        for (const ap of assetPaths) {
          pt[`path_${ap.ticker}`] = Math.max(0, ap.path[i] ?? 0);
        }
        pt['path_portfolio'] = portfolioPath[i] ?? 0;
      }
      pts.push(pt);
    }
    return pts;
  }, [percentiles, assetPaths, portfolioPath, depositPath, totalMonths, step, showPaths]);

  // Age-based x-axis
  const xTicks = Array.from({ length: years + 1 }, (_, i) => i * 12);
  const xTickFormatter = (v: number) =>
    v % 12 === 0 ? `${age + v / 12}歳` : '';

  // Event markers
  const lumpLines = lumpSumAdditions.filter(
    ls => ls.at_month > 0 && ls.at_month <= totalMonths,
  );
  const changeLines = futureChanges.filter(
    fc => fc.from_month > 0 && fc.from_month <= totalMonths,
  );

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="section-title mb-0">あなたが{age + years}歳に出金するまでの資産シミュレーション</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Checkbox-style individual asset toggle */}
          <button
            onClick={() => setShowPaths(p => !p)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 hover:border-blue-300 transition-colors"
          >
            <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              showPaths ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
            }`}>
              {showPaths && (
                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 8 8">
                  <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            個別資産を表示
          </button>
          {showPaths && (
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-500
                         hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              🔀 シナリオを変える
            </button>
          )}
        </div>
      </div>

      <div className="w-full h-72 md:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 82, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="outerBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#93c5fd" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#93c5fd" stopOpacity={0.20} />
              </linearGradient>
              <linearGradient id="innerBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.65} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.30} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="month"
              ticks={xTicks}
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={52}
              domain={[yMin, yMax]}
              allowDataOverflow
            />
            <Tooltip content={
              <CustomTooltip age={age} assetStats={showPaths ? assetPaths : []} />
            } />

            {/* Lump-sum / expense event markers */}
            {lumpLines.map((ls, i) => (
              <ReferenceLine
                key={`ls-${i}`}
                x={ls.at_month}
                stroke={ls.amount >= 0 ? '#10b981' : '#f87171'}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: ls.amount >= 0
                    ? `+${fmtJPY(ls.amount)}`
                    : `${fmtJPY(ls.amount)}`,
                  fill: ls.amount >= 0 ? '#10b981' : '#f87171',
                  fontSize: 10,
                  position: 'top',
                }}
              />
            ))}

            {/* Income change markers — lines only, no label to avoid clutter */}
            {changeLines.map((fc, i) => (
              <ReferenceLine
                key={`fc-${i}`}
                x={fc.from_month}
                stroke={fc.monthly_delta >= 0 ? '#6366f1' : '#fb923c'}
                strokeDasharray="2 4"
                strokeWidth={1}
              />
            ))}

            {/* Fan bands (stacked Areas) */}
            <Area type="monotone" dataKey="base"   stackId="fan" fill="transparent"      stroke="none" isAnimationActive animationDuration={1500} animationEasing="ease-out" />
            <Area type="monotone" dataKey="d10_25" stackId="fan" fill="url(#outerBand)" stroke="none" isAnimationActive animationDuration={1500} animationEasing="ease-out" />
            <Area type="monotone" dataKey="d25_50" stackId="fan" fill="url(#innerBand)" stroke="none" isAnimationActive animationDuration={1500} animationEasing="ease-out" />
            <Area type="monotone" dataKey="d50_75" stackId="fan" fill="url(#innerBand)" stroke="none" isAnimationActive animationDuration={1500} animationEasing="ease-out" />
            <Area type="monotone" dataKey="d75_90" stackId="fan" fill="url(#outerBand)" stroke="none" isAnimationActive animationDuration={1500} animationEasing="ease-out" />

            {/* Representative paths per asset */}
            {showPaths && assetPaths.map(ap => (
              <Line
                key={ap.ticker}
                type="monotone"
                dataKey={`path_${ap.ticker}`}
                stroke={ap.color}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                name={ap.label}
              />
            ))}

            {/* Combined portfolio path */}
            {showPaths && portfolioPath.length > 0 && (
              <Line
                type="monotone"
                dataKey="path_portfolio"
                stroke="#1e293b"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                name="ポートフォリオ合計"
              />
            )}

            {/* Deposit comparison — deterministic, solid prominent line */}
            <Line
              type="monotone"
              dataKey="deposit"
              stroke="#d97706"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              name="定期預金（年利0.3%）"
            />

            {/* Right-edge annotation: investment vs deposit gap arrow */}
            <Customized
              component={EdgeArrow}
              totalMonths={totalMonths}
              scenarioTerminal={scenarioTerminal}
              depositTerminal={depositTerminal}
              yMax={yMax}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legends */}
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-3 rounded bg-blue-500 opacity-90" />
          中間50%の幅
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-3 rounded bg-blue-300 opacity-60" />
          10〜90%の幅
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 border-t-[2.5px] border-amber-500" />
          <span className="text-amber-600">定期預金比較</span>
        </span>
      </div>

      {showPaths && assetPaths.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 text-xs">
          {assetPaths.map(ap => (
            <span key={ap.ticker} className="flex items-center gap-1">
              <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: ap.color }} />
              <span style={{ color: ap.color }}>{ap.label.split('（')[0]}</span>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block w-5 border-t-[2.5px] border-slate-800" />
            <span className="text-slate-700 font-medium">合計</span>
          </span>
          <span className="text-slate-400">（参考シナリオ例）</span>
        </div>
      )}
    </div>
  );
}
