'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { SimulateRequest, SimulateResponse, RiskLevel, FutureChange, LumpSumAddition } from '@/types';
import FanChart from './FanChart';
import AllocationPieChart from './AllocationPieChart';
import LLMExplanation from './LLMExplanation';
import PortfolioInsights from './PortfolioInsights';
import AIChatBox, { ChatParamChanges } from './AIChatBox';
import SimulatingLoader from './SimulatingLoader';
import CustomAllocationBuilder, { CustomAllocation } from './CustomAllocationBuilder';

interface ResultDashboardProps {
  result: SimulateResponse;
  formData: SimulateRequest;
  onReset: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function fmtJPY(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}億円`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000)}万円`;
  return `${Math.round(v).toLocaleString()}円`;
}

function toMan(n: number) {
  const v = n / 10_000;
  return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(1)).toString();
}

const RISK_TABS: { value: RiskLevel; label: string; icon: string }[] = [
  { value: 'low',    label: '安心コース',     icon: '🛡️' },
  { value: 'medium', label: 'バランスコース', icon: '⚖️' },
  { value: 'high',   label: '成長コース',     icon: '🚀' },
];

// Read-only mode display labels
const RISK_MODE_LABELS: Record<RiskLevel, string> = {
  low:    'おまかせ（安心）',
  medium: 'おまかせ（バランス）',
  high:   'おまかせ（成長）',
};

// ── Portfolio template metadata (for カスタム picker) ─────────────────────────

type RiskScore = 1 | 2 | 3 | 4 | 5;
interface TemplateMeta { label: string; subLabel: string; risk: RiskScore; emoji: string; tags: string[] }

const TEMPLATE_META: Record<string, TemplateMeta> = {
  ultra_conservative: { label: '超保守型',      subLabel: '現金60% 債券30% 金10%',            risk: 1, emoji: '🏦', tags: ['安全','保守','現金','キャッシュ','低リスク','超保守'] },
  income:             { label: 'インカム型',     subLabel: '債券60% 株10% 金10%',              risk: 1, emoji: '💼', tags: ['債券','インカム','安定','配当','収入'] },
  bonds_heavy:        { label: '債券特化型',     subLabel: '債券70% 現金15% 株10%',            risk: 1, emoji: '💰', tags: ['債券','安全','低リスク','保守','債券中心','AGG'] },
  conservative_bonds: { label: '債券重視型',     subLabel: '債券55% 株25% 金10%',              risk: 2, emoji: '📋', tags: ['債券','AGG','保守','安定'] },
  balanced_conservative:{ label: 'やや保守型',  subLabel: '株45% 債券30% 金15%',              risk: 2, emoji: '⚖️', tags: ['バランス','保守','安定','株債混合'] },
  all_weather:        { label: 'オールウェザー型', subLabel: '債券40% 株30% 金20%',            risk: 2, emoji: '☁️', tags: ['オールウェザー','ヘッジ','バランス','Ray Dalio','全天候','リスクパリティ'] },
  balanced:           { label: 'バランス型',     subLabel: '株60% 債券25% 金10%',              risk: 3, emoji: '🎯', tags: ['バランス','均等','標準','ベーシック'] },
  gold_hedge:         { label: 'ゴールドヘッジ型', subLabel: '金30% 株40% 債券20%',            risk: 3, emoji: '🏅', tags: ['金','ゴールド','GLD','インフレ','ヘッジ','金ヘッジ'] },
  balanced_growth:    { label: '成長バランス型', subLabel: '株70% 債券20% 金10%',              risk: 3, emoji: '📈', tags: ['成長','バランス','中リスク','株多め'] },
  growth:             { label: '成長型',         subLabel: '株75% 債券15% 金10%',              risk: 4, emoji: '🚀', tags: ['成長','高リスク','株式','積立'] },
  japan_focus:        { label: '日本株重視型',   subLabel: '日本株45% オルカン20%',            risk: 4, emoji: '🗾', tags: ['日本','日本株','EWJ','Japan','日経','TOPIX'] },
  aggressive_growth:  { label: '積極成長型',     subLabel: '株95% 債券5%',                     risk: 4, emoji: '⚡', tags: ['積極','成長','高リスク','テック','FANG','FAANG','攻め','S&P','米テック'] },
  global_equity:      { label: 'グローバル株式型', subLabel: '株100%（オルカン50% S&P500 30%）', risk: 5, emoji: '🌍', tags: ['株式','グローバル','オルカン','VT','SPY','全世界株','100%'] },
  fang_plus:          { label: 'FANG+型',           subLabel: 'FANG+ ETF集中（超高リスク高リターン）', risk: 5, emoji: '🔥', tags: ['FANG','FANG+','FAANG','テック','AI','ハイテク','NYFANG','グロース','集中投資'] },
};

const RISK_SCORE_META: Record<RiskScore, { label: string; color: string }> = {
  1: { label: '超保守', color: 'bg-emerald-100 text-emerald-700' },
  2: { label: '保守',   color: 'bg-blue-100 text-blue-700' },
  3: { label: '中',     color: 'bg-yellow-100 text-yellow-700' },
  4: { label: '積極',   color: 'bg-orange-100 text-orange-700' },
  5: { label: '超積極', color: 'bg-rose-100 text-rose-700' },
};

function PortfolioTemplatePicker({
  selectedTemplate, onSelect,
}: {
  selectedTemplate: string | null;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = Object.entries(TEMPLATE_META).filter(([key, meta]) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      meta.label.includes(q) ||
      meta.subLabel.includes(q) ||
      meta.tags.some(t => t.toLowerCase().includes(q)) ||
      key.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-2.5 p-3 bg-indigo-50/70 rounded-2xl border border-indigo-100">
      {/* Search */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-indigo-200 px-3 py-2 shadow-sm">
        <span className="text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="例: 金ヘッジ、日本株、FANG、全世界株、オールウェザー…"
          className="flex-1 text-sm text-slate-700 focus:outline-none bg-transparent placeholder:text-slate-300"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500 text-sm leading-none">✕</button>
        )}
      </div>

      {/* Template cards */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
          {filtered.map(([key, meta]) => {
            const isSelected = selectedTemplate === key;
            const riskMeta = RISK_SCORE_META[meta.risk];
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                className={`text-left p-2.5 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-white shadow-md'
                    : 'border-transparent bg-white/70 hover:border-indigo-200 hover:bg-white'
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="text-sm flex-shrink-0 mt-0.5">{meta.emoji}</span>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold leading-tight truncate ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {meta.label}{isSelected && ' ✓'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{meta.subLabel}</p>
                    <span className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${riskMeta.color}`}>
                      {riskMeta.label}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-400 text-center py-3">
          「{query}」に一致するポートフォリオが見つかりません
        </p>
      )}
      <p className="text-[10px] text-slate-400">
        💡 自然言語でも検索できます。例:「リスクを抑えたい」「インフレ対策」「テック中心」
      </p>
    </div>
  );
}

// ── EventForm ─────────────────────────────────────────────────────────────────

type EventType = 'lump' | 'change';
type EventInputMode = 'form' | 'nlp';
interface EventDraft {
  type: EventType;
  yearsLater: string;
  amountMan: string; // 万円
  description: string;
}

interface ParsedEventResult {
  future_changes: FutureChange[];
  lump_sum_additions: LumpSumAddition[];
  summary: string;
}

function EventForm({
  onAdd, onClose, age,
}: { onAdd: (c: FutureChange | null, l: LumpSumAddition | null) => void; onClose: () => void; age: number }) {
  const [inputMode, setInputMode] = useState<EventInputMode>('form');

  // ── フォームモード ──
  const [draft, setDraft] = useState<EventDraft>({
    type: 'lump', yearsLater: '', amountMan: '', description: '',
  });
  const set = (k: keyof EventDraft, v: string) => setDraft(d => ({ ...d, [k]: v }));

  const handleAdd = () => {
    const years = parseFloat(draft.yearsLater) || 0;
    const months = Math.round(years * 12);
    const amount = (parseFloat(draft.amountMan) || 0) * 10_000;
    const desc = draft.description || (draft.type === 'lump'
      ? `${fmtJPY(Math.abs(amount))}の${amount >= 0 ? '収入' : '支出'}`
      : `積立${amount >= 0 ? '+' : ''}${fmtJPY(amount)}/月`);
    if (months <= 0 || amount === 0) return;
    if (draft.type === 'lump') {
      onAdd(null, { at_month: months, amount, description: desc });
    } else {
      onAdd({ from_month: months, monthly_delta: amount, description: desc }, null);
    }
    onClose();
  };

  // ── NLPモード ──
  const [nlpText, setNlpText]     = useState('');
  const [nlpPhase, setNlpPhase]   = useState<'input' | 'parsing' | 'parsed'>('input');
  const [parsed, setParsed]       = useState<ParsedEventResult | null>(null);

  const parseNlp = async () => {
    if (!nlpText.trim()) return;
    setNlpPhase('parsing');
    try {
      const res = await fetch(`${API_URL}/api/parse-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: nlpText, age }),
      });
      if (res.ok) { setParsed(await res.json()); setNlpPhase('parsed'); }
      else setNlpPhase('input');
    } catch { setNlpPhase('input'); }
  };

  const applyParsed = () => {
    if (!parsed) return;
    parsed.future_changes.forEach(c => onAdd(c, null));
    parsed.lump_sum_additions.forEach(l => onAdd(null, l));
    onClose();
  };

  return (
    <div className="mt-3 bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-200">
      {/* Mode tabs */}
      <div className="flex gap-1.5">
        {([
          { mode: 'form', label: '📋 フォーム入力' },
          { mode: 'nlp',  label: '✨ AI自然言語入力' },
        ] as { mode: EventInputMode; label: string }[]).map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => { setInputMode(mode); setNlpPhase('input'); setParsed(null); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              inputMode === mode
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {inputMode === 'form' ? (
        <>
          <div className="flex gap-2">
            {(['lump', 'change'] as EventType[]).map(t => (
              <button
                key={t}
                onClick={() => set('type', t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  draft.type === t
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-white'
                }`}
              >
                {t === 'lump' ? '一時的な収入・支出' : '積立額の変更'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">何年後？</label>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} step={0.5} value={draft.yearsLater}
                  onChange={e => set('yearsLater', e.target.value)}
                  className="input-field text-sm py-1.5 w-full"
                  placeholder="例: 3"
                />
                <span className="text-xs text-slate-400 flex-shrink-0">年後</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {draft.type === 'lump' ? '金額（支出は－）' : '増減（減少は－）'}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number" step={1} value={draft.amountMan}
                  onChange={e => set('amountMan', e.target.value)}
                  className="input-field text-sm py-1.5 w-full"
                  placeholder={draft.type === 'lump' ? '例: -200' : '例: 3'}
                />
                <span className="text-xs text-slate-400 flex-shrink-0">万円{draft.type === 'change' ? '/月' : ''}</span>
              </div>
            </div>
          </div>
          <input
            type="text" value={draft.description}
            onChange={e => set('description', e.target.value)}
            placeholder="メモ（省略可）"
            className="input-field text-sm py-1.5 w-full"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5">
              キャンセル
            </button>
            <button
              onClick={handleAdd}
              disabled={!draft.yearsLater || !draft.amountMan}
              className="text-xs bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              追加して再計算
            </button>
          </div>
        </>
      ) : (
        /* ── NLPモード ── */
        <>
          {nlpPhase !== 'parsed' ? (
            <textarea
              value={nlpText}
              onChange={e => setNlpText(e.target.value)}
              disabled={nlpPhase === 'parsing'}
              rows={4}
              placeholder={`例：\n3年後に車を200万円で購入予定\n5年後から昇給で積立を3万円増やす\n10年後に住宅購入で600万円支出`}
              className="input-field text-sm py-2 w-full resize-none"
            />
          ) : null}

          {nlpPhase === 'parsing' && (
            <div className="flex flex-col items-center gap-2 py-5 text-blue-600">
              <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-xs font-medium">AIが条件を解析しています…</p>
            </div>
          )}

          {nlpPhase === 'parsed' && parsed && (
            <div className="space-y-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">AI</span>
                <p className="text-xs text-slate-700 leading-relaxed">{parsed.summary}</p>
              </div>
              {parsed.future_changes.map((c, i) => (
                <div key={`fc-${i}`} className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2 text-xs">
                  <span className="text-indigo-400">📅</span>
                  <span className="flex-1 text-slate-600">{c.description}</span>
                  <span className={`font-bold flex-shrink-0 ${c.monthly_delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {c.monthly_delta >= 0 ? '+' : ''}{(c.monthly_delta / 10_000).toFixed(1)}万円/月
                  </span>
                </div>
              ))}
              {parsed.lump_sum_additions.map((l, i) => (
                <div key={`ls-${i}`} className="flex items-center gap-2 bg-amber-50 rounded-lg px-3 py-2 text-xs">
                  <span className={l.amount >= 0 ? 'text-amber-400' : 'text-rose-400'}>{l.amount >= 0 ? '💰' : '💸'}</span>
                  <span className="flex-1 text-slate-600">{l.description}</span>
                  <span className={`font-bold flex-shrink-0 ${l.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {l.amount >= 0 ? '+' : ''}{fmtJPY(l.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {nlpPhase === 'parsed' ? (
              <>
                <button onClick={() => { setNlpPhase('input'); setParsed(null); }} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5">
                  ✏️ 編集する
                </button>
                <button
                  onClick={applyParsed}
                  disabled={!parsed || (parsed.future_changes.length === 0 && parsed.lump_sum_additions.length === 0)}
                  className="text-xs bg-emerald-600 text-white rounded-lg px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                >
                  反映して再計算
                </button>
              </>
            ) : (
              <>
                <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5">
                  キャンセル
                </button>
                <button
                  onClick={parseNlp}
                  disabled={!nlpText.trim() || nlpPhase === 'parsing'}
                  className="text-xs bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  AI解析する
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type SimulateOverrides = Partial<{
  age: number; savings: number; monthly: number; goal: number; years: number;
  risk_level: RiskLevel; portfolio_name: string | null;
}>;

export default function ResultDashboard({ result, formData, onReset }: ResultDashboardProps) {
  const [activeRisk, setActiveRisk] = useState<RiskLevel>(
    formData.custom_allocation && Object.keys(formData.custom_allocation).length > 0
      ? formData.risk_level
      : formData.risk_level,
  );
  const [portfolioName, setPortfolioName] = useState<string | null>(null);
  const [isCustomMode, setIsCustomMode] = useState<boolean>(
    !!(formData.custom_allocation && Object.keys(formData.custom_allocation).length > 0),
  );
  const [customAllocation, setCustomAllocation] = useState<CustomAllocation>(
    formData.custom_allocation ?? {},
  );
  const [currentResult, setCurrentResult] = useState<SimulateResponse>(result);
  const [isResimulating, setIsResimulating] = useState(false);

  // Phase 1 (curve only) → Phase 2 (goal selected, advice shown)
  const [hasGoal, setHasGoal] = useState<boolean>(false);

  // Settings card: read-only view ↔ edit form
  const [isEditingSettings, setIsEditingSettings] = useState<boolean>(false);
  const [savedEditParams, setSavedEditParams] = useState(formData);

  // Full-page reload animation when applying settings
  const [isFullReloading, setIsFullReloading] = useState<boolean>(false);

  // Scenario selector for FanChart annotation + 全期間リターン stats
  const [activeScenario, setActiveScenario] = useState<'p10' | 'p50' | 'p90'>('p50');

  // Editable params (mirrors formData)
  const [editParams, setEditParams] = useState({
    age:     formData.age ?? 25,
    savings: formData.savings,
    monthly: formData.monthly,
    goal:    formData.goal,
    years:   formData.years,
  });
  const [editingField, setEditingField] = useState<string | null>(null);

  // User-manually-added events only (formData.future_changes are backend interpolation steps, merged at API call)
  const [localChanges, setLocalChanges] = useState<FutureChange[]>([]);
  const [localLumps,   setLocalLumps]   = useState<LumpSumAddition[]>([]);
  const [showEventForm, setShowEventForm] = useState(false);

  const isDirty = useMemo(() =>
    editParams.savings !== formData.savings ||
    editParams.monthly !== formData.monthly ||
    editParams.years   !== formData.years   ||
    editParams.age     !== (formData.age ?? 25),
  [editParams, formData]);

  // Generic re-simulate — always uses current editParams explicitly (avoids stale formData)
  const doSimulate = async (overrides: SimulateOverrides = {}) => {
    if (isResimulating) return;
    setIsResimulating(true);
    const p = { ...editParams, ...overrides };
    const pName = 'portfolio_name' in overrides ? overrides.portfolio_name : portfolioName;
    try {
      const res = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          savings:              p.savings,
          monthly:              p.monthly,
          goal:                 p.goal,
          years:                p.years,
          age:                  p.age,
          risk_level:           overrides.risk_level ?? activeRisk,
          portfolio_name:       isCustomMode ? undefined : (pName ?? undefined),
          custom_allocation:    isCustomMode && Object.keys(customAllocation).length > 0
            ? customAllocation
            : undefined,
          notes:                formData.notes,
          future_changes:       [...(formData.future_changes ?? []), ...localChanges],
          lump_sum_additions:   [...(formData.lump_sum_additions ?? []), ...localLumps],
        }),
      });
      if (res.ok) setCurrentResult(await res.json());
    } catch { /* keep current */ }
    finally { setIsResimulating(false); }
  };

  const handleRiskChange = async (risk: RiskLevel) => {
    setActiveRisk(risk);
    setPortfolioName(null);
    setIsCustomMode(false);
    setCustomAllocation({});
    await doSimulate({ risk_level: risk, portfolio_name: null });
  };

  // Apply param changes from AIChatBox and re-simulate
  const handleChatChanges = async (changes: ChatParamChanges) => {
    const newRisk = (changes.risk_level as RiskLevel | undefined) ?? activeRisk;
    const newPortfolio = changes.portfolio_name !== undefined ? changes.portfolio_name : portfolioName;
    const newParams = {
      ...editParams,
      ...(typeof changes.monthly === 'number' ? { monthly: changes.monthly } : {}),
      ...(typeof changes.savings === 'number' ? { savings: changes.savings } : {}),
      ...(typeof changes.goal   === 'number' ? { goal:   changes.goal   } : {}),
      ...(typeof changes.years  === 'number' ? { years:  changes.years  } : {}),
    };
    if (changes.risk_level) setActiveRisk(newRisk);
    if (changes.portfolio_name !== undefined) setPortfolioName(changes.portfolio_name || null);
    setEditParams(newParams);
    await doSimulate({ ...newParams, risk_level: newRisk, portfolio_name: newPortfolio });
  };

  const handleParamConfirm = async () => {
    setEditingField(null);
    await doSimulate();
  };

  const enterEditMode = () => {
    setSavedEditParams({ ...editParams, risk_level: activeRisk } as any);
    setIsEditingSettings(true);
  };

  const cancelEditMode = () => {
    // Restore params to pre-edit state
    const saved = savedEditParams as any;
    setEditParams({
      age:     saved.age     ?? editParams.age,
      savings: saved.savings ?? editParams.savings,
      monthly: saved.monthly ?? editParams.monthly,
      goal:    saved.goal    ?? editParams.goal,
      years:   saved.years   ?? editParams.years,
    });
    setIsEditingSettings(false);
  };

  const handleApplySettings = async () => {
    setIsEditingSettings(false);
    setIsFullReloading(true);
    await doSimulate();
    setIsFullReloading(false);
  };

  const addEvent = async (c: FutureChange | null, l: LumpSumAddition | null) => {
    const newChanges = c ? [...localChanges, c] : localChanges;
    const newLumps   = l ? [...localLumps,   l] : localLumps;
    setLocalChanges(newChanges);
    setLocalLumps(newLumps);
    // Re-simulate with new events immediately
    setIsResimulating(true);
    try {
      const res = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          ...editParams,
          risk_level: activeRisk,
          portfolio_name: isCustomMode ? undefined : portfolioName ?? undefined,
          custom_allocation: isCustomMode && Object.keys(customAllocation).length > 0
            ? customAllocation
            : undefined,
          future_changes: [...(formData.future_changes ?? []), ...newChanges],
          lump_sum_additions: [...(formData.lump_sum_additions ?? []), ...newLumps],
        }),
      });
      if (res.ok) setCurrentResult(await res.json());
    } catch { /* keep */ }
    finally { setIsResimulating(false); }
  };

  const removeEvent = async (type: 'change' | 'lump', idx: number) => {
    const newChanges = type === 'change' ? localChanges.filter((_, i) => i !== idx) : localChanges;
    const newLumps   = type === 'lump'   ? localLumps.filter((_, i) => i !== idx)   : localLumps;
    setLocalChanges(newChanges);
    setLocalLumps(newLumps);
    setIsResimulating(true);
    try {
      const res = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData, ...editParams,
          risk_level: activeRisk,
          portfolio_name: isCustomMode ? undefined : portfolioName ?? undefined,
          custom_allocation: isCustomMode && Object.keys(customAllocation).length > 0
            ? customAllocation
            : undefined,
          future_changes: [...(formData.future_changes ?? []), ...newChanges],
          lump_sum_additions: [...(formData.lump_sum_additions ?? []), ...newLumps],
        }),
      });
      if (res.ok) setCurrentResult(await res.json());
    } catch { /* keep */ }
    finally { setIsResimulating(false); }
  };

  // ── Param fields config ──────────────────────────────────────────────────────
  type ParamKey = keyof typeof editParams;
  const paramFields: { key: ParamKey; label: string; display: string; type: 'man' | 'num' }[] = [
    { key: 'age',     label: '年齢',       display: `${editParams.age}歳`,          type: 'num' },
    { key: 'savings', label: '現在の貯蓄額', display: fmtJPY(editParams.savings),   type: 'man' },
    { key: 'monthly', label: '毎月の積立額', display: fmtJPY(editParams.monthly),   type: 'man' },
    { key: 'years',   label: '運用年数',   display: `${new Date().getFullYear()}〜${new Date().getFullYear() + editParams.years}年（${editParams.years}年間）`, type: 'num' },
  ];

  // ── Per-scenario stats (for merged performance panel) ─────────────────────
  const SCENARIO_MAP = { p10: '10', p50: '50', p90: '90' } as const;
  const scenarioKey = SCENARIO_MAP[activeScenario];
  const scenarioTerminal =
    (currentResult.percentiles[scenarioKey] ?? [])[editParams.years * 12] ?? 0;
  const totalReturnPct =
    currentResult.total_contributed > 0
      ? ((scenarioTerminal - currentResult.total_contributed) / currentResult.total_contributed) * 100
      : 0;
  const surplusVsDeposit = scenarioTerminal - currentResult.deposit_terminal;

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<'sim' | 'settings'>('sim');

  // Settings card JSX (shared between desktop sidebar and mobile tab)
  const settingsCard = (
    <div className={`card space-y-4 transition-all ${isEditingSettings ? 'ring-2 ring-blue-300' : ''}`}>

        {/* ─ ヘッダー ─ */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-black flex items-center justify-center flex-shrink-0 shadow-sm">①</span>
            <div>
              <h3 className="text-base font-bold text-slate-700 leading-tight">
                {isEditingSettings ? '設定を変更' : 'あなたの設定'}
              </h3>
              {!isEditingSettings && isCustomMode && currentResult.portfolio_label && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                  📐 {currentResult.portfolio_label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isEditingSettings ? (
              <button
                onClick={cancelEditMode}
                className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-1.5 transition-colors"
              >
                ✕ キャンセル
              </button>
            ) : (
              <>
                {isResimulating && (
                  <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <button
                  onClick={enterEditMode}
                  className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-xl px-3 py-1.5 transition-colors"
                >
                  ⚙️ 編集する
                </button>
              </>
            )}
          </div>
        </div>

        {isEditingSettings ? (
          /* ── EDIT FORM ───────────────────────────────────────────────────── */
          <div className="space-y-4">
            {/* Mode tabs */}
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium">モード</p>
              <div className="flex gap-1.5 flex-wrap">
                {RISK_TABS.map(tab => (
                  <button
                    key={tab.value}
                    onClick={() => { handleRiskChange(tab.value); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                      activeRisk === tab.value && !isCustomMode
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
                <button
                  onClick={() => { setIsCustomMode(true); setPortfolioName(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    isCustomMode
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  🎨 カスタム
                </button>
              </div>
            </div>

            {isCustomMode && (
              <CustomAllocationBuilder
                value={customAllocation}
                onChange={setCustomAllocation}
              />
            )}

            {/* Param inputs (all at once) */}
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium">積立条件</p>
              <div className="grid grid-cols-2 gap-2.5">
                {paramFields.map(({ key, label, type }) => (
                  <div key={key} className="bg-blue-50/60 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">{label}</p>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={type === 'man' ? toMan(editParams[key] as number) : editParams[key]}
                        onChange={e => {
                          const raw = parseFloat(e.target.value) || 0;
                          setEditParams(p => ({ ...p, [key]: type === 'man' ? Math.round(raw * 10_000) : raw }));
                        }}
                        className="input-field text-sm py-1.5 w-full"
                      />
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {type === 'man' ? '万円' : key === 'age' ? '歳' : '年'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confirm button */}
            <button
              onClick={handleApplySettings}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-2xl shadow-sm transition-colors"
            >
              ✅ この条件で反映する
            </button>
          </div>
        ) : (
          /* ── READ-ONLY SUMMARY ───────────────────────────────────────────── */
          <div className="grid grid-cols-2 gap-2">
            {paramFields.map(({ key, label, display }) => (
              <div key={key} className="bg-slate-50 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-slate-400">{label}</p>
                <p className="font-bold text-slate-800 text-sm mt-0.5">{display}</p>
              </div>
            ))}
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-400">モード</p>
              <p className="font-bold text-slate-800 text-sm mt-0.5">
                {isCustomMode
                  ? `🎨 カスタム`
                  : `${RISK_TABS.find(t => t.value === activeRisk)?.icon} ${RISK_MODE_LABELS[activeRisk]}`}
              </p>
            </div>
          </div>
        )}

        {/* ─ アセットアロケーション（常時表示） ─ */}
        <div className="pt-4 border-t border-slate-100">
          <AllocationPieChart
            allocation={currentResult.allocation}
            allocationLabels={currentResult.allocation_labels}
          />
        </div>
      </div>
  );

  return (
    <div className="animate-slide-up">
      {isFullReloading ? (
        <SimulatingLoader />
      ) : (
        <>
          {/* ── モバイル専用タブバー ────────────────────────────────────────── */}
          <div className="lg:hidden sticky top-[57px] z-40 bg-white border-b border-slate-200 flex mb-4">
            {([
              { tab: 'sim',      label: '📊 シミュレーション' },
              { tab: 'settings', label: '⚙️ 設定' },
            ] as const).map(({ tab, label }) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  mobileTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── メインレイアウト: デスクトップ=2列 / モバイル=タブ切替 ─── */}
          <div className="lg:flex lg:gap-6 lg:items-start">

            {/* ── 左列: メインコンテンツ ─────────────────────────────────── */}
            <div className={`flex-1 min-w-0 space-y-6 ${mobileTab === 'settings' ? 'hidden lg:block' : ''}`}>

              {/* ── Fan chart ─────────────────────────────────────────── */}
              <div className="card">
                <FanChart
                  data={currentResult}
                  goal={editParams.goal}
                  years={editParams.years}
                  age={editParams.age}
                  savings={editParams.savings}
                  monthly={editParams.monthly}
                  futureChanges={localChanges}
                  lumpSumAdditions={localLumps}
                  activeScenario={activeScenario}
                  depositTerminalValue={currentResult.deposit_terminal}
                />

                {/* Event list + add form */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500">手動追加イベント</p>
                    <button
                      onClick={() => setShowEventForm(v => !v)}
                      className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-full px-3 py-1 transition-colors"
                    >
                      {showEventForm ? 'キャンセル' : '＋ イベントを追加'}
                    </button>
                  </div>

                  {(localChanges.length > 0 || localLumps.length > 0) ? (
                    <div className="space-y-1.5 mb-3">
                      {localChanges.map((c, i) => (
                        <div key={`c-${i}`} className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2 text-xs">
                          <span className="text-indigo-400">📅</span>
                          <span className="flex-1 text-slate-600">{c.description}</span>
                          <span className={`font-bold flex-shrink-0 ${c.monthly_delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {c.monthly_delta >= 0 ? '+' : ''}{(c.monthly_delta / 10_000).toFixed(1)}万円/月
                          </span>
                          <button onClick={() => removeEvent('change', i)} className="text-slate-300 hover:text-rose-400 ml-1">×</button>
                        </div>
                      ))}
                      {localLumps.map((l, i) => (
                        <div key={`l-${i}`} className="flex items-center gap-2 bg-amber-50 rounded-lg px-3 py-2 text-xs">
                          <span className={l.amount >= 0 ? 'text-amber-400' : 'text-rose-400'}>{l.amount >= 0 ? '💰' : '💸'}</span>
                          <span className="flex-1 text-slate-600">{l.description}</span>
                          <span className={`font-bold flex-shrink-0 ${l.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {l.amount >= 0 ? '+' : ''}{fmtJPY(l.amount)}
                          </span>
                          <button onClick={() => removeEvent('lump', i)} className="text-slate-300 hover:text-rose-400 ml-1">×</button>
                        </div>
                      ))}
                    </div>
                  ) : !showEventForm ? (
                    <p className="text-xs text-slate-400 mb-3">
                      将来の収支変化（昇給・住宅購入・育児休業など）を追加するとグラフに反映されます
                    </p>
                  ) : null}

                  {showEventForm && (
                    <EventForm
                      age={editParams.age}
                      onAdd={addEvent}
                      onClose={() => setShowEventForm(false)}
                    />
                  )}
                </div>

                {/* Scenario selector + 全期間リターン */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex gap-1.5 mb-3">
                    {([
                      { key: 'p10', emoji: '🔴', label: '悲観',  sub: '下位10%' },
                      { key: 'p50', emoji: '📊', label: '中央値', sub: '50%ライン' },
                      { key: 'p90', emoji: '🟢', label: '楽観',  sub: '上位10%' },
                    ] as const).map(({ key, emoji, label, sub }) => (
                      <button
                        key={key}
                        onClick={() => setActiveScenario(key)}
                        className={`flex-1 py-2 px-1 rounded-xl text-xs font-medium border transition-all ${
                          activeScenario === key
                            ? 'bg-slate-700 text-white border-slate-700 shadow-sm'
                            : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div>{emoji} {label}</div>
                        <div className={`text-[10px] mt-0.5 ${activeScenario === key ? 'text-slate-300' : 'text-slate-400'}`}>
                          {sub}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className={`rounded-xl p-4 text-center border ${
                      totalReturnPct >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-rose-50 border-rose-100'
                    }`}>
                      <p className="text-xs text-slate-500 mb-1">全期間リターン</p>
                      <p className={`text-3xl font-black leading-none ${totalReturnPct >= 0 ? 'text-blue-700' : 'text-rose-600'}`}>
                        {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(0)}
                        <span className="text-lg font-bold">%</span>
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1.5">
                        元本 {fmtJPY(currentResult.total_contributed)} 対比
                      </p>
                    </div>
                    <div className={`rounded-xl p-4 text-center border ${
                      surplusVsDeposit >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'
                    }`}>
                      <p className="text-xs text-slate-500 mb-1">定期預金（0.3%）より</p>
                      <p className={`text-2xl font-black leading-none ${surplusVsDeposit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {surplusVsDeposit >= 0 ? '+' : ''}{fmtJPY(surplusVsDeposit)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1.5">
                        定預最終額 {fmtJPY(currentResult.deposit_terminal)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 text-center">
                    最終資産: {fmtJPY(scenarioTerminal)}（{activeScenario === 'p10' ? '悲観シナリオ' : activeScenario === 'p90' ? '楽観シナリオ' : '中央値シナリオ'}）
                  </p>
                </div>

                {/* 分散スコア — シミュレーションカード末尾 */}
                <DiversificationRatioBar dr={currentResult.diversification_ratio} />
              </div>

              {/* ══ ③ 目標出金額を元にポートフォリオを見直す ══════════════ */}
              <SectionLabel
                number="③"
                title="目標出金額を元にポートフォリオを見直す"
                subtitle="スライダーで目標額を動かすと達成確率と改善アドバイスが表示されます"
              />

              <GoalProbabilityChart
                result={currentResult}
                goal={editParams.goal}
                years={editParams.years}
                isLoading={isResimulating}
                hasGoal={hasGoal}
                onGoalFirstSet={() => setHasGoal(true)}
                onGoalChange={async (newGoal) => {
                  setEditParams(p => ({ ...p, goal: newGoal }));
                  setIsFullReloading(true);
                  await doSimulate({ goal: newGoal });
                  setIsFullReloading(false);
                }}
              />

              {hasGoal && (
                <>
                  <LLMExplanation
                    analysis={currentResult.explanation_analysis}
                    advice={currentResult.explanation_advice}
                    isLoading={isResimulating}
                    onTryMonthlyPlus={() => {
                      const newMonthly = editParams.monthly + 10_000;
                      setEditParams(p => ({ ...p, monthly: newMonthly }));
                      doSimulate({ monthly: newMonthly });
                    }}
                    onTryYearsPlus={() => {
                      const newYears = editParams.years + 3;
                      setEditParams(p => ({ ...p, years: newYears }));
                      doSimulate({ years: newYears });
                    }}
                  />
                  <AIChatBox
                    currentParams={{
                      savings:    editParams.savings,
                      monthly:    editParams.monthly,
                      goal:       editParams.goal,
                      years:      editParams.years,
                      risk_level: activeRisk,
                      age:        editParams.age,
                    }}
                    onApplyChanges={handleChatChanges}
                    apiUrl={API_URL}
                  />
                </>
              )}

              {/* ══ ④ 詳しい分析・参考情報 ══════════════════════════════════ */}
              <SectionLabel
                number="④"
                title="詳しい分析・参考情報"
                subtitle="感度分析・NISA節税効果・金融工学的ポートフォリオレビュー"
              />

              <SensitivityCard
                result={currentResult}
                editParams={editParams}
                isLoading={isResimulating}
                onApplyMonthly={() => {
                  const m = editParams.monthly + 10_000;
                  setEditParams(p => ({ ...p, monthly: m }));
                  doSimulate({ monthly: m });
                }}
                onApplyYears={() => {
                  const y = editParams.years + 3;
                  setEditParams(p => ({ ...p, years: y }));
                  doSimulate({ years: y });
                }}
              />

              <PortfolioInsights
                allocation={currentResult.allocation}
                diversificationRatio={currentResult.diversification_ratio}
              />

              <NisaCard result={currentResult} />
              <ShareCard editParams={editParams} activeRisk={activeRisk} />

              <p className="text-center text-slate-400 text-xs">
                ※ オルカン(VT)・S&P500(SPY)・日本株(EWJ)・米国債(AGG)・金(GLD)・短期国債(SHV)の過去データに基づく確率シミュレーションの結果です。
                将来の運用成果を保証するものではありません。
              </p>
            </div>

            {/* ── 右列: 設定パネル (デスクトップ=sticky、モバイル=設定タブ) ── */}
            <div className={`lg:w-80 xl:w-96 lg:sticky lg:top-20 space-y-4 flex-shrink-0 ${mobileTab === 'sim' ? 'hidden lg:block' : ''}`}>
              {settingsCard}
            </div>

          </div>
        </>
      )}
    </div>
  );
}

// ── Goal probability chart (survival function) ────────────────────────────────

/** Linear interpolation on the survival curve built from percentile terminal values */
function interpolateSurvival(x: number, curve: { x: number; prob: number }[]): number {
  if (x <= curve[0].x) return 100;
  if (x >= curve[curve.length - 1].x) return 0;
  for (let i = 0; i < curve.length - 1; i++) {
    if (x >= curve[i].x && x <= curve[i + 1].x) {
      const t = (x - curve[i].x) / (curve[i + 1].x - curve[i].x);
      return curve[i].prob + t * (curve[i + 1].prob - curve[i].prob);
    }
  }
  return 0;
}

function goalProbColor(prob: number): { text: string; bg: string; label: string } {
  if (prob >= 75) return { text: 'text-emerald-600', bg: 'bg-emerald-50',  label: '達成可能性 高' };
  if (prob >= 50) return { text: 'text-blue-600',    bg: 'bg-blue-50',     label: '達成可能性 中' };
  if (prob >= 30) return { text: 'text-amber-600',   bg: 'bg-amber-50',    label: '達成可能性 要努力' };
  return             { text: 'text-rose-600',    bg: 'bg-rose-50',     label: '要見直し' };
}

/** X-axis tick formatter: compact 万/億 */
function fmtAxis(v: number): string {
  if (v === 0) return '0';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(v % 100_000_000 === 0 ? 0 : 1)}億`;
  return `${Math.round(v / 10_000)}万`;
}

function GoalProbabilityChart({
  result, goal, years, isLoading, hasGoal, onGoalFirstSet, onGoalChange,
}: {
  result: SimulateResponse;
  goal: number;
  years: number;
  isLoading: boolean;
  hasGoal: boolean;
  onGoalFirstSet: () => void;
  onGoalChange: (g: number) => void;
}) {
  const lastIdx = years * 12;
  const p10t = result.percentiles['10'][lastIdx] ?? 0;
  const p25t = result.percentiles['25'][lastIdx] ?? 0;
  const p50t = result.percentiles['50'][lastIdx] ?? 0;
  const p75t = result.percentiles['75'][lastIdx] ?? 0;
  const p90t = result.percentiles['90'][lastIdx] ?? 0;

  // X-axis upper bound: 35% beyond 90th percentile, rounded to nice number
  const xMax = Math.ceil(p90t * 1.35 / 1_000_000) * 1_000_000 || 10_000_000;
  // Slider step: ~0.5% of range, minimum 10万
  const sliderStep = Math.max(100_000, Math.round(xMax / 200 / 100_000) * 100_000);

  // Survival-function data points (probability of exceeding X)
  const curveData = useMemo(() => [
    { x: 0,     prob: 100 },
    { x: p10t,  prob: 90  },
    { x: p25t,  prob: 75  },
    { x: p50t,  prob: 50  },
    { x: p75t,  prob: 25  },
    { x: p90t,  prob: 10  },
    { x: xMax,  prob: 0   },
  ], [p10t, p25t, p50t, p75t, p90t, xMax]);

  // Phase 1: slider starts at median (neutral, not a "selected" goal)
  // Phase 2: slider tracks the confirmed goal
  const [pendingGoal, setPendingGoal] = useState(p50t || xMax / 2);

  // In Phase 2, keep slider in sync with re-simulated goal
  useEffect(() => {
    if (hasGoal) setPendingGoal(goal);
  }, [goal, hasGoal]);

  // Live probability during drag (interpolated from curve)
  const liveProb   = interpolateSurvival(pendingGoal, curveData);
  const displayProb = hasGoal
    ? (pendingGoal === goal && !isLoading ? result.achievement_probability : liveProb)
    : liveProb;

  const { text: probText, bg: probBg, label: probLabel } = goalProbColor(displayProb);

  // Confirm button handler — triggers API call only on explicit button press
  const handleConfirmGoal = () => {
    if (!hasGoal) {
      onGoalFirstSet();
    }
    onGoalChange(pendingGoal);
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean; payload?: { value: number }[]; label?: number;
  }) => {
    if (!active || !payload?.length || label == null) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-md text-xs">
        <p className="text-slate-500">目標額: <span className="font-bold text-slate-700">{fmtJPY(label)}</span></p>
        <p className="text-slate-500">達成確率: <span className="font-bold text-violet-700">{payload[0].value.toFixed(1)}%</span></p>
      </div>
    );
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="section-title">目標金額と達成確率</h3>
          {!hasGoal && (
            <p className="text-xs text-slate-400 mt-0.5">
              カーブは{years}年後の資産分布です。スライダーで目標を設定するとアドバイスが表示されます。
            </p>
          )}
        </div>
        {isLoading && (
          <span className="text-xs text-slate-400 flex items-center gap-1 flex-shrink-0">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            再計算中
          </span>
        )}
      </div>

      {/* Survival curve chart */}
      <div className="-mx-1">
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={curveData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="survivalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, xMax]}
              scale="linear"
              tickFormatter={fmtAxis}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={v => `${v}%`}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="prob"
              stroke="#6366f1"
              strokeWidth={2.5}
              fill="url(#survivalGrad)"
              dot={false}
              activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
            />
            {/* Phase 2 only: show goal reference line */}
            {hasGoal && (
              <ReferenceLine
                x={pendingGoal}
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 3"
                label={{
                  value: `${displayProb.toFixed(0)}%`,
                  position: 'insideTopRight',
                  fill: '#ef4444',
                  fontSize: 12,
                  fontWeight: 700,
                  dy: -4,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Slider ── */}
      <div className="bg-violet-50 border border-violet-100 rounded-2xl px-4 py-3 space-y-2">
        {/* Label row */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-violet-600">🎯 目標額をドラッグで設定</span>
          <span className="text-base font-black text-violet-700 bg-white border border-violet-200 rounded-xl px-3 py-1 shadow-sm tabular-nums">
            {fmtJPY(pendingGoal)}
          </span>
        </div>
        {/* Track with min/max */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 flex-shrink-0 w-6 text-right">0</span>
          <input
            type="range"
            min={0}
            max={xMax}
            step={sliderStep}
            value={pendingGoal}
            onChange={e => setPendingGoal(Number(e.target.value))}
            className="flex-1 h-3 rounded-full appearance-none cursor-grab active:cursor-grabbing accent-violet-600 bg-slate-200"
          />
          <span className="text-[10px] text-slate-400 flex-shrink-0 w-12">{fmtJPY(xMax)}</span>
        </div>
        <p className="text-[10px] text-violet-400 text-center">← 左右にスライドして目標額を変えてください →</p>
      </div>

      {/* ── Stats strip ── */}
      {!hasGoal ? (
        /* Phase 1: live prob always shown; button triggers API + Phase 2 */
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">スライダー位置</p>
              <p className="text-xl font-black text-slate-800">{fmtJPY(pendingGoal)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">スライダーで調整</p>
            </div>
            <div className="rounded-xl bg-indigo-50 p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">達成確率（概算）</p>
              <p className="text-4xl font-black leading-none text-indigo-700">
                {liveProb.toFixed(0)}<span className="text-xl">%</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
            <span className="text-xl flex-shrink-0">🎯</span>
            <p className="flex-1 text-sm font-bold text-indigo-700">
              この目標でAIアドバイスを見る
            </p>
            <button
              onClick={handleConfirmGoal}
              disabled={isLoading}
              className="flex-shrink-0 text-xs bg-indigo-600 text-white rounded-xl px-3 py-2 font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isLoading ? '計算中…' : '見る →'}
            </button>
          </div>
        </>
      ) : (
        /* Phase 2: show selected goal + probability */
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">目標出金額</p>
              <p className="text-xl font-black text-slate-800">{fmtJPY(pendingGoal)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">スライダーで調整</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${probBg}`}>
              <p className="text-xs text-slate-500 mb-1">達成確率</p>
              <p className={`text-4xl font-black leading-none ${probText}`}>
                {displayProb.toFixed(0)}<span className="text-xl">%</span>
              </p>
              <p className={`text-xs font-semibold mt-1 ${probText}`}>{probLabel}</p>
            </div>
          </div>
          {/* Recalculate button — only visible when slider moved from confirmed goal */}
          {pendingGoal !== goal && (
            <button
              onClick={handleConfirmGoal}
              disabled={isLoading}
              className="w-full py-2.5 text-sm font-bold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '計算中…' : '🔄 この金額でAIアドバイスを再計算する'}
            </button>
          )}
        </>
      )}

      <p className="text-[10px] text-slate-400 leading-relaxed">
        ※ グラフはモンテカルロシミュレーション{years}年後の端末資産の生存関数（P(最終資産 ≥ X)）を示します。
        {hasGoal ? 'スライダーで目標額を変更し、再計算ボタンで更新できます。' : 'スライダーで目標を選んでボタンを押してください。'}
      </p>
    </div>
  );
}

// ── Performance card (IRR + deposit comparison) ───────────────────────────────

function irrLabel(irr: number): { text: string; color: string } {
  const pct = irr * 100;
  if (pct >= 10) return { text: '極めて優秀 🏆', color: 'text-purple-700' };
  if (pct >= 8)  return { text: '非常に優秀 🎯', color: 'text-blue-700' };
  if (pct >= 6)  return { text: '優秀 ✅', color: 'text-blue-600' };
  if (pct >= 4)  return { text: '良好', color: 'text-emerald-600' };
  if (pct >= 2)  return { text: '平均的', color: 'text-slate-600' };
  return { text: '低め', color: 'text-amber-600' };
}

function PerformanceCard({ result }: { result: SimulateResponse }) {
  const surplus = result.median_terminal - result.deposit_terminal;
  const surplusPct = result.deposit_terminal > 0
    ? (surplus / result.deposit_terminal) * 100
    : 0;
  const { text: irrText, color: irrColor } = irrLabel(result.irr_median);

  return (
    <div className="card space-y-3">
      <h3 className="section-title">運用効果（シミュレーション中央値）</h3>
      <div className="grid grid-cols-2 gap-3">
        {/* IRR */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">実効年率リターン（IRR）</p>
          <p className={`text-3xl font-black ${irrColor}`}>
            {(result.irr_median * 100).toFixed(1)}
            <span className="text-lg font-bold">%</span>
          </p>
          <p className={`text-xs font-semibold mt-1 ${irrColor}`}>{irrText}</p>
          <p className="text-[10px] text-slate-400 mt-1">8%超えは非常に優秀・4%台が平均的</p>
        </div>

        {/* vs deposit */}
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">定期預金（0.3%）より</p>
          <p className={`text-2xl font-black ${surplus >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {surplus >= 0 ? '+' : ''}{fmtJPY(surplus)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {surplus >= 0 ? `約 ${surplusPct.toFixed(0)}% お得` : '定期預金を下回る試算'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>定期預金最終残高: {fmtJPY(result.deposit_terminal)}</span>
        <span>／</span>
        <span>中央値最終残高: {fmtJPY(result.median_terminal)}</span>
      </div>
    </div>
  );
}

// ── NISA card (with fix for 0 benefit case) ───────────────────────────────────

function NisaCard({ result }: { result: SimulateResponse }) {
  const gain = result.median_terminal - result.total_contributed;
  const isLoss = gain < 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="section-title mb-0">NISA活用による節税効果</h3>
        <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">非課税メリット</span>
      </div>
      <p className="text-xs text-slate-400">
        NISAを利用することで、運用益に対する約20.315%の税金が非課税になります。以下はシミュレーション中央値での試算です。
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">総積立元本</p>
          <p className="font-bold text-slate-800">{fmtJPY(result.total_contributed)}</p>
        </div>
        <div className={`rounded-xl p-3 text-center border ${isLoss ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-transparent'}`}>
          <p className="text-xs text-slate-400 mb-1">中央値での最終資産</p>
          <p className={`font-bold ${isLoss ? 'text-rose-600' : 'text-slate-800'}`}>{fmtJPY(result.median_terminal)}</p>
          {isLoss && <p className="text-[10px] text-rose-500 mt-0.5">元本割れ（中央値）</p>}
        </div>
        <div className={`rounded-xl p-3 text-center border ${result.nisa_median_benefit > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-transparent'}`}>
          <p className="text-xs text-slate-400 mb-1">節税効果（概算）</p>
          <p className={`font-bold text-lg ${result.nisa_median_benefit > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
            {fmtJPY(result.nisa_median_benefit)}
          </p>
        </div>
      </div>
      {isLoss && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
          ⚠️ 中央値シナリオでは積立元本を下回っています。運用期間を延ばすか積立額を増やすと節税効果が生まれやすくなります。
        </div>
      )}
      {!isLoss && result.nisa_median_benefit === 0 && (
        <div className="bg-slate-50 rounded-xl px-3 py-2 text-xs text-slate-500">
          現在の条件では運用益がほぼ発生していないため節税効果は0円です。積立期間・積立額の見直しをご検討ください。
        </div>
      )}
      <p className="text-xs text-slate-400">
        ※ 実際のNISA制度（成長投資枠：年240万円、つみたて投資枠：年120万円）の非課税枠には上限があります。
        節税効果は運用益に20.315%を乗じた概算値です。
      </p>
    </div>
  );
}

// ── Sensitivity card (forward: +1万 / +3年) ───────────────────────────────────

function SensitivityCard({
  result, editParams, isLoading, onApplyMonthly, onApplyYears,
}: {
  result: SimulateResponse;
  editParams: { monthly: number; years: number };
  isLoading: boolean;
  onApplyMonthly: () => void;
  onApplyYears: () => void;
}) {
  const base    = result.achievement_probability;
  const plus1m  = result.prob_plus_1man;
  const plus3y  = result.prob_plus_3years;
  const delta1m = plus1m  - base;
  const delta3y = plus3y  - base;

  const Row = ({
    label, sub, prob, delta, onApply, color,
  }: {
    label: string; sub: string; prob: number; delta: number;
    onApply: () => void; color: string;
  }) => (
    <div className={`flex items-center gap-3 rounded-xl p-3 ${color}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xl font-black text-slate-800">
          {prob.toFixed(0)}%
        </p>
        {delta > 0 ? (
          <p className="text-xs font-bold text-emerald-600">▲ +{delta.toFixed(0)}%</p>
        ) : delta < 0 ? (
          <p className="text-xs font-bold text-rose-500">▼ {delta.toFixed(0)}%</p>
        ) : (
          <p className="text-xs text-slate-400">変化なし</p>
        )}
      </div>
      <button
        disabled={isLoading}
        onClick={onApply}
        className="flex-shrink-0 text-xs bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40"
      >
        試す
      </button>
    </div>
  );

  return (
    <div className="card space-y-3">
      <h3 className="section-title">積立を増やしたらどうなる？</h3>

      {/* Current baseline */}
      <div className="flex items-center gap-3 bg-slate-100 rounded-xl p-3">
        <div className="flex-1">
          <p className="text-xs font-semibold text-slate-500">現在の設定</p>
          <p className="text-xs text-slate-400">月 {fmtJPY(editParams.monthly)}・{editParams.years}年間</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black text-slate-700">{base.toFixed(0)}%</p>
          <p className="text-xs text-slate-400">達成確率</p>
        </div>
      </div>

      {/* Sensitivity rows */}
      <Row
        label="+1万円/月 積み立てると"
        sub={`月 ${fmtJPY(editParams.monthly + 10_000)}・${editParams.years}年間`}
        prob={plus1m}
        delta={delta1m}
        onApply={onApplyMonthly}
        color="bg-emerald-50"
      />
      <Row
        label="+3年 延長すると"
        sub={`月 ${fmtJPY(editParams.monthly)}・${editParams.years + 3}年間`}
        prob={plus3y}
        delta={delta3y}
        onApply={onApplyYears}
        color="bg-blue-50"
      />
    </div>
  );
}

// ── Diversification Ratio bar ─────────────────────────────────────────────────

function DiversificationRatioBar({ dr }: { dr: number }) {
  const pct = dr * 100 - 100;  // how many % risk is reduced vs unweighted average
  const label =
    dr >= 1.40 ? { text: '非常に優秀', color: 'text-purple-700', bg: 'bg-purple-500' } :
    dr >= 1.25 ? { text: '優秀 ✅',   color: 'text-blue-700',   bg: 'bg-blue-500'   } :
    dr >= 1.15 ? { text: '良好',       color: 'text-emerald-700', bg: 'bg-emerald-500'} :
    dr >= 1.05 ? { text: '普通',       color: 'text-slate-600',   bg: 'bg-slate-400'  } :
                 { text: '低い',       color: 'text-amber-600',   bg: 'bg-amber-400'  };

  const barWidth = Math.min(100, Math.max(0, (dr - 1) / 0.5 * 100));  // 0%=DR1.0, 100%=DR1.5

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold text-slate-600">分散スコア（Diversification Ratio）</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-black ${label.color}`}>{dr.toFixed(2)}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${label.color} bg-opacity-10 border`}>{label.text}</span>
        </div>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${label.bg}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5">
        個々の資産の加重平均リスクに対し、ポートフォリオ全体のリスクが
        <span className="font-semibold text-slate-600"> {pct.toFixed(0)}% </span>
        低減されています（DR＝1.25以上で優秀）
      </p>
    </div>
  );
}

// ── Section label (numbered narrative header) ─────────────────────────────────

function SectionLabel({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 px-1">
      <span className="w-7 h-7 rounded-full bg-slate-700 text-white text-sm font-black flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
        {number}
      </span>
      <div>
        <p className="text-sm font-bold text-slate-700 leading-tight">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

// ── Share card ────────────────────────────────────────────────────────────────

function ShareCard({
  editParams,
  activeRisk,
}: {
  editParams: { age: number; savings: number; monthly: number; goal: number; years: number };
  activeRisk: RiskLevel;
}) {
  const [copied, setCopied] = useState(false);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({
      age:        String(editParams.age),
      savings:    String(editParams.savings),
      monthly:    String(editParams.monthly),
      goal:       String(editParams.goal),
      years:      String(editParams.years),
      risk_level: activeRisk,
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, [editParams, activeRisk]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: select text
      const url = buildUrl();
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="card bg-gradient-to-br from-slate-50 to-blue-50 border border-blue-100">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-700">このシミュレーションを共有</h3>
          <p className="text-xs text-slate-400 mt-0.5">URLをコピーして友人や家族に送れます</p>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            copied
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
          }`}
        >
          {copied ? '✅ コピーしました' : '🔗 URLをコピー'}
        </button>
      </div>
    </div>
  );
}
