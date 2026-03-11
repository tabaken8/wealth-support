'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import AssetReturnChart from './AssetReturnChart';

interface AllocationPieChartProps {
  allocation: Record<string, number>;
  allocationLabels: Record<string, string>;
}

const COLORS: Record<string, string> = {
  VT:  '#3b82f6',  // blue   — 全世界株式
  SPY: '#8b5cf6',  // violet — S&P500
  EWJ: '#f43f5e',  // rose   — 日本株
  AGG: '#14b8a6',  // teal   — 債券
  GLD: '#f59e0b',  // amber  — 金
  SHV: '#94a3b8',  // slate  — 現金
  // Legacy fallback
  VTI: '#3b82f6',
};

const REND_LABELS: Record<string, string> = {
  VT:  '全世界株式（オルカン）',
  SPY: '米国株式（S&P500）',
  EWJ: '日本株',
  AGG: '債券',
  GLD: '金',
  SHV: '現金・短期債',
  VTI: '株式',
};

interface LabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}

const RADIAN = Math.PI / 180;
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: LabelProps) => {
  if (percent < 0.04) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-md p-2 text-xs">
      <p className="font-semibold text-slate-700">{REND_LABELS[name] ?? name}</p>
      <p className="text-slate-500">{(value * 100).toFixed(1)}%</p>
    </div>
  );
};

export default function AllocationPieChart({ allocation, allocationLabels }: AllocationPieChartProps) {
  const data = Object.entries(allocation)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: key,
      value,
      label: allocationLabels[key] ?? key,
    }));

  return (
    <div>
      <h3 className="section-title">アセットアロケーション</h3>
      <div className="w-full h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={85}
              dataKey="value"
              nameKey="name"
              labelLine={false}
              label={renderCustomLabel as any}
              isAnimationActive
              animationDuration={1200}
              animationEasing="ease-out"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name] ?? '#cbd5e1'} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: COLORS[entry.name] ?? '#cbd5e1' }}
            />
            <span className="text-slate-600">{REND_LABELS[entry.name] ?? entry.name}</span>
            <span className="ml-auto font-semibold text-slate-800">
              {(entry.value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {/* 10-year return chart (normalized, live from Yahoo Finance) */}
      <AssetReturnChart activeTickers={data.map(d => d.name)} />
    </div>
  );
}
