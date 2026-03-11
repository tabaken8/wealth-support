'use client';

import { useState, useEffect, useRef } from 'react';

// ── Available tickers for custom allocation ────────────────────────────────

export interface CustomTicker {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  emoji: string;
  category: 'equity' | 'bond' | 'commodity' | 'cash' | 'crypto';
  risk: 1 | 2 | 3 | 4 | 5;
  hint: string;
  isEstimated?: boolean;
}

export const CUSTOM_TICKERS: CustomTicker[] = [
  { id: 'VT',      name: 'オルカン',      nameEn: '全世界株式 (VT)',         color: '#3b82f6', emoji: '🌍', category: 'equity',    risk: 3, hint: '47カ国の株式に広く分散' },
  { id: 'SPY',     name: 'S&P500',       nameEn: '米国株式 (SPY)',           color: '#8b5cf6', emoji: '🇺🇸', category: 'equity',    risk: 3, hint: '米国を代表する500社' },
  { id: 'EWJ',     name: '日本株',        nameEn: '日本株 (EWJ)',             color: '#f43f5e', emoji: '🗾', category: 'equity',    risk: 3, hint: '日本株式市場 (TOPIX連動)' },
  { id: 'FNGS',    name: 'FANG+',        nameEn: 'FANG+テック (FNGS)',       color: '#f97316', emoji: '🔥', category: 'equity',    risk: 5, hint: 'META・AMZN・GOOG・MSFTなど10社集中 ⚠️高リスク', isEstimated: true },
  { id: 'AGG',     name: '米国債',        nameEn: '米国債券 (AGG)',           color: '#14b8a6', emoji: '📋', category: 'bond',      risk: 1, hint: '幅広い満期の米国債インデックス' },
  { id: 'GLD',     name: '金',            nameEn: 'ゴールド (GLD)',           color: '#f59e0b', emoji: '🥇', category: 'commodity', risk: 2, hint: 'インフレ・地政学リスクのヘッジ' },
  { id: 'SHV',     name: '短期国債/現金', nameEn: '現金・短期債 (SHV)',       color: '#94a3b8', emoji: '💵', category: 'cash',      risk: 1, hint: '残存期間1年未満の米国短期国債' },
];

const RISK_BADGE: Record<number, { label: string; color: string }> = {
  1: { label: '低リスク', color: 'bg-emerald-100 text-emerald-700' },
  2: { label: 'やや低',   color: 'bg-blue-100 text-blue-700' },
  3: { label: '中',       color: 'bg-yellow-100 text-yellow-700' },
  4: { label: 'やや高',   color: 'bg-orange-100 text-orange-700' },
  5: { label: '高リスク', color: 'bg-rose-100 text-rose-700' },
};

export type CustomAllocation = Record<string, number>; // ticker -> weight 0..1

interface Props {
  value: CustomAllocation;
  onChange: (a: CustomAllocation) => void;
}

// ── Weight calculation helpers ─────────────────────────────────────────────

/** 均等配分 */
function applyEqual(ids: string[]): CustomAllocation {
  if (ids.length === 0) return {};
  const w = 1 / ids.length;
  return Object.fromEntries(ids.map(id => [id, w]));
}

/** 順位配分: 1位から N:N-1:…:1 の比率 */
function applyRank(ids: string[]): CustomAllocation {
  const n = ids.length;
  if (n === 0) return {};
  const total = (n * (n + 1)) / 2;
  return Object.fromEntries(ids.map((id, i) => [id, (n - i) / total]));
}

/**
 * 1銘柄の比率を±5%動かし、残りを末尾から補填して合計100%を維持する。
 * 最低比率は5%に保護。
 */
function shiftWeight(
  alloc: CustomAllocation,
  ids: string[],
  targetId: string,
  deltaPct: number,
): CustomAllocation {
  const n = ids.length;
  if (n <= 1) return alloc;

  // 整数パーセントで扱う（浮動小数点誤差回避）
  const pcts: Record<string, number> = {};
  ids.forEach(id => { pcts[id] = Math.round((alloc[id] ?? 0) * 100); });

  const cur = pcts[targetId];
  const newVal = Math.max(5, Math.min(cur + deltaPct, 100 - (n - 1) * 5));
  const actual = newVal - cur;
  if (actual === 0) return alloc;

  pcts[targetId] = newVal;

  // 差分を末尾（低順位）から順に吸収
  let need = -actual;
  const others = ids.filter(id => id !== targetId).reverse();
  for (const oid of others) {
    if (need === 0) break;
    const canGive = pcts[oid] - 5;
    const canTake = 95 - pcts[oid];
    const change = need > 0 ? Math.min(need, canTake) : Math.max(need, -canGive);
    pcts[oid] += change;
    need -= change;
  }

  return Object.fromEntries(ids.map(id => [id, pcts[id] / 100]));
}

// ── SVG Donut chart ────────────────────────────────────────────────────────

interface DonutSlice { id: string; color: string; pct: number; }

function DonutChart({ slices, size = 120 }: { slices: DonutSlice[]; size?: number }) {
  const r = size / 2 - 10;          // radius
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;     // circumference

  let offset = 0; // starts at 12 o'clock (adjusted below via transform)

  return (
    <svg width={size} height={size} className="drop-shadow-sm">
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={18} />
      {slices.map(s => {
        const dash = (s.pct / 100) * circ;
        const gap  = circ - dash;
        const el = (
          <circle
            key={s.id}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={18}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={offset}
            strokeLinecap="butt"
            style={{ transition: 'stroke-dasharray 0.3s ease, stroke-dashoffset 0.3s ease' }}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        offset -= dash; // next segment starts where this one ends
        return el;
      })}
      {/* Center label */}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">配分</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="#94a3b8">{slices.length}資産</text>
    </svg>
  );
}

// ── Drag handle icon ───────────────────────────────────────────────────────

function DragHandle() {
  return (
    <svg className="w-4 h-4 text-slate-300" fill="currentColor" viewBox="0 0 16 16">
      <rect y="2"  width="16" height="2" rx="1" />
      <rect y="7"  width="16" height="2" rx="1" />
      <rect y="12" width="16" height="2" rx="1" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CustomAllocationBuilder({ value, onChange }: Props) {
  const hasInitialValue = Object.keys(value).length > 0;

  const [step, setStep] = useState<'select' | 'adjust'>(
    hasInitialValue ? 'adjust' : 'select',
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    hasInitialValue
      ? Object.keys(value).filter(id => CUSTOM_TICKERS.some(t => t.id === id))
      : [],
  );
  // rankedIds controls the priority order (index 0 = highest priority)
  const [rankedIds, setRankedIds] = useState<string[]>(() =>
    hasInitialValue
      ? Object.keys(value).filter(id => CUSTOM_TICKERS.some(t => t.id === id))
      : [],
  );
  const [isFinetune, setIsFinetune] = useState(false);

  // Pointer-based drag state (works on both mouse and touch)
  const [dragIdx, setDragIdx]   = useState<number | null>(null);
  const [overIdx, setOverIdx]   = useState<number | null>(null);
  const itemRefs   = useRef<(HTMLDivElement | null)[]>([]);
  // Refs for immediate access inside pointer handlers (avoids stale closure)
  const dragIdxRef = useRef<number | null>(null);
  const overIdxRef = useRef<number | null>(null);

  // Reset when parent clears value
  useEffect(() => {
    if (Object.keys(value).length === 0 && step === 'adjust') {
      setStep('select');
      setSelectedIds([]);
      setRankedIds([]);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 1: Ticker selection ─────────────────────────────────────────────

  const toggleTicker = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const confirmSelection = () => {
    if (selectedIds.length === 0) return;
    setRankedIds(selectedIds);
    onChange(applyRank(selectedIds));
    setStep('adjust');
    setIsFinetune(false);
  };

  const goBackToSelect = () => {
    setSelectedIds(Object.keys(value).filter(id => CUSTOM_TICKERS.some(t => t.id === id)));
    setStep('select');
    setIsFinetune(false);
  };

  // ── Drag & drop handlers ─────────────────────────────────────────────────

  const handleDragPointerDown = (e: React.PointerEvent, idx: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragIdxRef.current = idx;
    overIdxRef.current = idx;
    setDragIdx(idx);
    setOverIdx(idx);
  };

  const handleDragPointerMove = (e: React.PointerEvent) => {
    if (dragIdxRef.current === null) return;
    const y = e.clientY;
    for (let j = 0; j < itemRefs.current.length; j++) {
      const el = itemRefs.current[j];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        if (j !== overIdxRef.current) {
          overIdxRef.current = j;
          setOverIdx(j);
        }
        break;
      }
    }
  };

  const handleDragPointerUp = () => {
    const di = dragIdxRef.current;
    const oi = overIdxRef.current;
    if (di !== null && oi !== null && di !== oi) {
      // Swap the two items directly (不連続な順位交換)
      const newOrder = [...rankedIds];
      [newOrder[di], newOrder[oi]] = [newOrder[oi], newOrder[di]];
      setRankedIds(newOrder);
      onChange(applyRank(newOrder));
    }
    dragIdxRef.current = null;
    overIdxRef.current = null;
    setDragIdx(null);
    setOverIdx(null);
  };

  // ── Render: step 1 ───────────────────────────────────────────────────────

  if (step === 'select') {
    return (
      <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-600">運用したい資産を選択</p>
          {selectedIds.length > 0 && (
            <span className="text-xs text-blue-600 font-semibold">{selectedIds.length}件選択中</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {CUSTOM_TICKERS.map(t => {
            const isSel = selectedIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTicker(t.id)}
                className={`flex items-center gap-2 text-left p-2.5 rounded-xl border-2 transition-all ${
                  isSel
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSel ? 'bg-blue-500 border-blue-500' : 'border-slate-300 bg-white'
                }`}>
                  {isSel && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 8 8">
                      <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="text-lg flex-shrink-0">{t.emoji}</span>
                <div className="min-w-0">
                  <p className={`text-xs font-bold truncate leading-tight ${isSel ? 'text-blue-700' : 'text-slate-700'}`}>
                    {t.name}
                  </p>
                  <p className="text-[9px] text-slate-400 leading-snug">{t.nameEn}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${RISK_BADGE[t.risk].color}`}>
                      {RISK_BADGE[t.risk].label}
                    </span>
                    {t.isEstimated && (
                      <span className="text-[8px] text-amber-600">推計</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={confirmSelection}
          disabled={selectedIds.length === 0}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {selectedIds.length === 0
            ? '資産を選んでください'
            : `決定 — ${selectedIds.length}銘柄を優先順に配分 →`}
        </button>
      </div>
    );
  }

  // ── Render: step 2 (adjust) ──────────────────────────────────────────────

  const selectedTickers = CUSTOM_TICKERS
    .filter(t => rankedIds.includes(t.id))
    .sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));

  const n = rankedIds.length;
  const rankLabel = rankedIds
    .map((_, i) => n - i)
    .join(':'); // e.g. "4:3:2:1"

  return (
    <div className="space-y-3">
      {/* Back link */}
      <button
        type="button"
        onClick={goBackToSelect}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
          <path d="M7 2L3 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        銘柄を選び直す
      </button>

      {/* Mode header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">
          {isFinetune
            ? '📝 手動で比率を微調整'
            : '↕️ ドラッグ（または長押し）で順位を並び替え'}
        </p>
        <button
          type="button"
          onClick={() => {
            if (isFinetune) onChange(applyRank(rankedIds));
            setIsFinetune(f => !f);
          }}
          className="text-[10px] text-blue-500 hover:text-blue-700 underline flex-shrink-0"
        >
          {isFinetune ? '← 並び替えに戻る' : '細かく調整 →'}
        </button>
      </div>

      {/* Donut chart + legend */}
      <div className="flex items-center gap-3 justify-center py-1">
        <DonutChart
          size={120}
          slices={selectedTickers.map(t => ({
            id: t.id,
            color: t.color,
            pct: Math.round((value[t.id] ?? 0) * 100),
          }))}
        />
        <div className="space-y-1">
          {selectedTickers.map((t, i) => (
            <div key={t.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
              <span className="text-[10px] text-slate-500 font-medium">{t.name}</span>
              <span className="text-[10px] font-black tabular-nums" style={{ color: t.color }}>
                {Math.round((value[t.id] ?? 0) * 100)}%
              </span>
              {!isFinetune && (
                <span className="text-[9px] text-slate-300">{i + 1}位</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rank hint (rank mode only) */}
      {!isFinetune && (
        <p className="text-[10px] text-slate-400 text-center">
          比率 <span className="font-bold text-slate-500">{rankLabel}</span>
          　— 上のカードをドラッグして順位を変更
        </p>
      )}

      {/* Asset cards */}
      <div className="space-y-1.5">
        {selectedTickers.map((t, i) => {
          const pct = Math.round((value[t.id] ?? 0) * 100);
          const isDragging = dragIdx === i;
          const isOver     = overIdx === i && dragIdx !== null && dragIdx !== i;

          return (
            <div
              key={t.id}
              ref={el => { itemRefs.current[i] = el; }}
              className={`flex items-center gap-2.5 bg-white rounded-xl border-2 p-2.5 transition-all duration-150 ${
                isDragging ? 'opacity-40 scale-[0.98] border-blue-300'
                : isOver   ? 'border-blue-400 shadow-md'
                : 'border-slate-200'
              }`}
            >
              {/* Drag handle or rank number */}
              {!isFinetune ? (
                <div
                  className="flex flex-col items-center gap-0.5 cursor-grab active:cursor-grabbing touch-none select-none"
                  onPointerDown={e => handleDragPointerDown(e, i)}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={() => { setDragIdx(null); setOverIdx(null); }}
                >
                  <span className="text-[10px] font-black text-slate-400 leading-none">{i + 1}位</span>
                  <DragHandle />
                </div>
              ) : (
                <span className="text-[10px] font-black text-slate-300 w-5 text-center leading-none">{i + 1}</span>
              )}

              <span className="text-lg flex-shrink-0">{t.emoji}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-800 truncate">{t.name}</span>
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full flex-shrink-0 ${RISK_BADGE[t.risk].color}`}>
                    {RISK_BADGE[t.risk].label}
                  </span>
                  {t.isEstimated && (
                    <span className="text-[8px] text-amber-600 flex-shrink-0">推計</span>
                  )}
                </div>
                {/* Mini bar */}
                <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: t.color }}
                  />
                </div>
              </div>

              {/* Weight: static display or +/- stepper */}
              {isFinetune ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onChange(shiftWeight(value, rankedIds, t.id, -5))}
                    className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-base leading-none flex items-center justify-center transition-colors"
                  >
                    −
                  </button>
                  <span
                    className="text-sm font-black tabular-nums w-10 text-center"
                    style={{ color: t.color }}
                  >
                    {pct}%
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(shiftWeight(value, rankedIds, t.id, +5))}
                    className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-base leading-none flex items-center justify-center transition-colors"
                  >
                    ＋
                  </button>
                </div>
              ) : (
                <span
                  className="text-base font-black tabular-nums flex-shrink-0"
                  style={{ color: t.color }}
                >
                  {pct}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick preset buttons */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => { setRankedIds(r => [...r]); onChange(applyRank(rankedIds)); setIsFinetune(false); }}
          className="flex-1 py-1.5 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          {rankLabel} に配分
        </button>
        <button
          type="button"
          onClick={() => { onChange(applyEqual(rankedIds)); setIsFinetune(true); }}
          className="flex-1 py-1.5 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          均等に配分
        </button>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        ※ 上が高優先・下が低優先。並び替えると自動で「{rankLabel}」の比率に設定されます。
        「細かく調整」で±5%ずつ手動変更できます（合計は常に100%を維持します）。
        {selectedTickers.some(t => t.isEstimated) && (
          <span className="block mt-0.5 text-amber-600">⚠️「推計」銘柄（FANG+）は推定リターン・ボラティリティを使用します。</span>
        )}
      </p>
    </div>
  );
}
