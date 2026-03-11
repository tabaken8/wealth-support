'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Ticker registry ─────────────────────────────────────────────────────────

interface TickerInfo {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  emoji: string;
  tags: string[];
}

const TICKER_REGISTRY: TickerInfo[] = [
  { id: 'VT',  name: 'オルカン',    nameEn: '全世界株 (VT)',     color: '#3b82f6', emoji: '🌍', tags: ['オルカン','全世界','vt','全世界株式'] },
  { id: 'SPY', name: 'S&P500',     nameEn: '米国株 (SPY)',       color: '#8b5cf6', emoji: '🇺🇸', tags: ['s&p500','spy','米国株'] },
  { id: 'EWJ', name: '日本株',      nameEn: '日本株 (EWJ)',       color: '#f43f5e', emoji: '🗾', tags: ['日本','日本株','ewj','nikkei'] },
  { id: 'AGG', name: '米国債',      nameEn: '米国債券 (AGG)',     color: '#14b8a6', emoji: '📋', tags: ['債券','agg','米国債','bond'] },
  { id: 'GLD', name: '金',          nameEn: 'ゴールド (GLD)',     color: '#f59e0b', emoji: '🥇', tags: ['金','ゴールド','gold','gld'] },
  { id: 'SHV', name: '現金/短期債', nameEn: '現金・短期債 (SHV)', color: '#94a3b8', emoji: '💵', tags: ['現金','shv','短期','cash'] },
];

interface DataPoint {
  date: string;
  [key: string]: string | number | null;
}

function ChartTooltip({
  active, payload, label, visible,
}: {
  active?: boolean;
  payload?: { color: string; dataKey: string; value: number }[];
  label?: string;
  visible: string[];
}) {
  if (!active || !payload?.length) return null;
  const reg = Object.fromEntries(TICKER_REGISTRY.map(t => [t.id, t]));
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-xs space-y-1 min-w-[150px]">
      <p className="font-semibold text-slate-600 pb-1 border-b border-slate-100">{label}</p>
      {[...payload]
        .filter(p => visible.includes(p.dataKey as string))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .map(p => {
          const info = reg[p.dataKey];
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-3">
              <span style={{ color: p.color }} className="font-medium flex items-center gap-1">
                <span>{info?.emoji}</span><span>{info?.name ?? p.dataKey}</span>
              </span>
              <span className="font-bold text-slate-700">×{p.value?.toFixed(2)}</span>
            </div>
          );
        })}
    </div>
  );
}

export default function AssetReturnChart({ activeTickers }: { activeTickers: string[] }) {
  const [data, setData]       = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [visible, setVisible] = useState<string[]>(TICKER_REGISTRY.map(t => t.id));
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/api/asset-history`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d  => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const availableTickers = useMemo(() => {
    if (!data.length) return TICKER_REGISTRY.map(t => t.id);
    const last = data[data.length - 1] ?? {};
    return TICKER_REGISTRY.filter(t => last[t.id] != null).map(t => t.id);
  }, [data]);

  const latestValues = useMemo(() => {
    const last = data[data.length - 1] ?? {};
    return Object.fromEntries(availableTickers.map(id => [id, last[id] as number | null]));
  }, [data, availableTickers]);

  const filteredTickers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const base = TICKER_REGISTRY.filter(t => availableTickers.includes(t.id));
    if (!q) return base;
    return base.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.nameEn.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [searchQuery, availableTickers]);

  const toggle = (id: string) => {
    setVisible(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  };

  const xTicks = data
    .filter(d => d.date?.endsWith('-01'))
    .filter((_, i) => i % 2 === 0)
    .map(d => d.date);

  const visibleInChart = visible.filter(id => availableTickers.includes(id));

  if (loading) {
    return (
      <div className="h-52 flex flex-col items-center justify-center gap-2 text-slate-400">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-xs">リターンデータ取得中 (Yahoo Finance)…</p>
      </div>
    );
  }

  if (error || !data.length) {
    return <p className="text-xs text-slate-400 py-4 text-center">リターンデータを取得できませんでした</p>;
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-600">
          直近10年のリターン推移
          <span className="text-xs font-normal text-slate-400 ml-1.5">（開始時点 = ×1.0）</span>
        </p>
        <p className="text-[10px] text-slate-400">出典: Yahoo Finance</p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-2.5 py-1.5">
        <span className="text-slate-300 text-xs">🔍</span>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="銘柄を検索（例: オルカン、S&P500、金…）"
          className="flex-1 text-xs text-slate-700 focus:outline-none bg-transparent placeholder:text-slate-300"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-slate-300 hover:text-slate-500 text-xs">✕</button>
        )}
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5">
        {filteredTickers.map(t => {
          const isOn = visible.includes(t.id);
          const isPF  = activeTickers.includes(t.id);
          const val   = latestValues[t.id];
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all ${
                isOn ? 'bg-white shadow-sm' : 'opacity-35 bg-slate-50 border-slate-200 text-slate-400'
              }`}
              style={isOn ? { borderColor: t.color + '88', color: t.color } : {}}
              title={t.nameEn}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: isOn ? t.color : '#cbd5e1' }} />
              <span>{t.emoji}</span>
              <span>{t.name}</span>
              {isPF && isOn && (
                <span className="text-[8px] font-bold px-1 rounded" style={{ backgroundColor: t.color + '22' }}>PF</span>
              )}
              {val != null && isOn && (
                <span className="text-slate-600 font-bold">×{val.toFixed(2)}</span>
              )}
              {isOn && (
                <span
                  className="text-[10px] text-slate-300 hover:text-rose-400 ml-0.5"
                  onClick={e => { e.stopPropagation(); toggle(t.id); }}
                >×</span>
              )}
            </button>
          );
        })}
        {filteredTickers.length === 0 && (
          <p className="text-xs text-slate-400">「{searchQuery}」に一致する銘柄が見つかりません</p>
        )}
      </div>

      {/* Quick controls */}
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <button onClick={() => setVisible(availableTickers)} className="hover:text-blue-500 underline">すべて表示</button>
        <span>·</span>
        <button onClick={() => setVisible(activeTickers.filter(id => availableTickers.includes(id)))} className="hover:text-blue-500 underline">PFのみ</button>
        <span>·</span>
        <button onClick={() => setVisible([])} className="hover:text-rose-400 underline">すべて非表示</button>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            ticks={xTicks}
            tickFormatter={d => d?.slice(0, 4)}
            tickLine={false}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={v => `×${Number(v).toFixed(1)}`}
            tickLine={false}
            axisLine={false}
            width={42}
            domain={['auto', 'auto']}
          />
          <ReferenceLine y={1} stroke="#cbd5e1" strokeDasharray="4 2" strokeWidth={1} />
          <Tooltip content={<ChartTooltip visible={visibleInChart} />} />
          {TICKER_REGISTRY.map(t => {
            if (!availableTickers.includes(t.id)) return null;
            const isOn = visibleInChart.includes(t.id);
            return (
              <Line
                key={t.id}
                dataKey={t.id}
                stroke={t.color}
                strokeWidth={isOn ? 2.5 : 1}
                opacity={isOn ? 1 : 0}
                dot={false}
                activeDot={isOn ? { r: 4, strokeWidth: 1, stroke: '#fff' } : false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        ※ チップをクリックして表示/非表示を切替。「PF」バッジはあなたのPFに含まれる資産。過去のリターンは将来の成果を保証しません。
      </p>
    </div>
  );
}
