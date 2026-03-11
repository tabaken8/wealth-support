'use client';

import { useState, useEffect, useRef } from 'react';
import { SimulateRequest, RiskLevel, ParsedNotes, FutureChange, LumpSumAddition } from '@/types';
import CustomAllocationBuilder, { CustomAllocation } from './CustomAllocationBuilder';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface WizardFormProps {
  onSubmit: (data: SimulateRequest) => void;
  isLoading: boolean;
}

type InvestStyle   = 'index' | 'individual' | 'unknown';
type InvestApproach = 'dca' | 'lump' | 'both' | 'unknown';
type CapexMode     = 'percent' | 'fixed';
type NotesPhase    = 'input' | 'parsing' | 'parsed';

// Steps: 0=style 1=age 2=years 3=income+capex 4=savings 5=risk 6=notes
const TOTAL_INPUT_STEPS = 7;
const NOTES_STEP = 6;

interface WizardData {
  investStyle:          InvestStyle;
  investApproach:       InvestApproach;
  birthYear:            number;
  birthMonth:           number;   // 1-12
  birthDay:             number;   // 1-31
  investStartYearsLater: number;  // 0-10
  years:                number;
  incomeYear1:          number;   // 万円/月
  incomeYearN:          number;   // 万円/月
  capexMargin:          number;   // 0.0–1.0
  capexMode:            CapexMode;
  fixedMonthly:         number;   // 万円/月 (when capexMode==='fixed')
  savings:              number;   // 円
  goal:                 number;   // 円
  risk_level:           RiskLevel;
  isCustomAllocation:   boolean;
  customAllocation:     CustomAllocation;
}

/** Compute age (years) from birth year/month/day, optionally adding an offset */
function computeAge(birthYear: number, birthMonth: number, birthDay: number, offsetYears = 0): number {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1-12
  const curDay = now.getDate();
  let age = curYear - birthYear;
  if (curMonth < birthMonth || (curMonth === birthMonth && curDay < birthDay)) age--;
  return Math.max(0, age) + offsetYears;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtJPY(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億円`;
  if (n >= 10_000)      return `${Math.round(n / 10_000)}万円`;
  return `${n.toLocaleString()}円`;
}
function toMan(n: number): string {
  const v = n / 10_000;
  return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(1)).toString();
}
function getAgeHint(age: number): string {
  if (age <= 19) return `${age}歳からのスタートは最強のアドバンテージ！複利が何十年もあなたのために働きます 🚀`;
  if (age <= 24) return `${age}歳の今が資産形成の黄金期。時間という最大の武器を活かしましょう 💪`;
  if (age <= 29) return `20代のうちに始めれば、30代・40代の自分が絶対に感謝します 🎯`;
  if (age <= 39) return `${age}歳でも全然遅くない！積立額を意識すれば大きく育てられます 🌱`;
  if (age <= 49) return `${age}歳からの堅実なプランで、老後の安心を着実に積み上げましょう 🧭`;
  return `${age}歳からでも資産は守り・育てられます。安定重視で着実に進みましょう 🌟`;
}

/** Base monthly in 円 from income × margin (or fixed) */
function effectiveMonthly(form: WizardData): number {
  if (form.capexMode === 'fixed') return Math.round(form.fixedMonthly * 10_000);
  return Math.round(form.incomeYear1 * 10_000 * form.capexMargin);
}

/** Year-by-year income → capex changes (merged into future_changes) */
function computeIncomeChanges(form: WizardData): FutureChange[] {
  if (form.capexMode === 'fixed') return [];
  if (form.years <= 1) return [];
  if (Math.abs(form.incomeYearN - form.incomeYear1) < 0.01) return [];

  const changes: FutureChange[] = [];
  for (let y = 2; y <= form.years; y++) {
    const t     = (y - 1) / (form.years - 1);
    const tPrev = (y - 2) / (form.years - 1);
    const incY    = form.incomeYear1 + (form.incomeYearN - form.incomeYear1) * t;
    const incPrev = form.incomeYear1 + (form.incomeYearN - form.incomeYear1) * tPrev;
    const delta = Math.round((incY - incPrev) * 10_000 * form.capexMargin);
    if (Math.abs(delta) >= 100) {
      changes.push({
        from_month: (y - 1) * 12,
        monthly_delta: delta,
        description: `${y}年目：月収${incY.toFixed(1)}万円（積立${(incY * form.capexMargin).toFixed(1)}万円/月）`,
      });
    }
  }
  return changes;
}

// ── RISK_OPTIONS ──────────────────────────────────────────────────────────────

const RISK_OPTIONS: { value: RiskLevel; label: string; sub: string; icon: string; desc: string; hint: string }[] = [
  {
    value: 'low', label: '安心コース', icon: '🛡️',
    sub: '株式30% / 債券50% / 金10% / 現金10%',
    desc: '定期預金に毛が生えた程度の値動き。株価暴落のニュースを見ても夜ぐっすり眠れる方向けの穏やかなポートフォリオ。',
    hint: '安定重視 / 近いうちに使う予定がある / 投資に慣れていない',
  },
  {
    value: 'medium', label: 'バランスコース', icon: '⚖️',
    sub: '株式60% / 債券30% / 金7% / 現金3%',
    desc: '年に一度は含み損10〜20%になることも。でも長期では安定した成長が期待できるバランス重視の標準設定。',
    hint: '5年以上の運用期間 / ある程度の上下は受け入れられる / 迷ったらここ',
  },
  {
    value: 'high', label: '成長コース', icon: '🚀',
    sub: '株式80% / 債券15% / 金5% / 現金0%',
    desc: '株式中心で最大リターンを狙う上級者向け。生活に関わらない余剰資金で、値動きをむしろ楽しめる方向け。',
    hint: '10年以上の長期運用 / 余剰資金のみ / リスクを面白いと思える',
  },
];

const NOTES_ROW_PLACEHOLDERS = [
  '例：3年後に昇給予定。そのタイミングで積立を月3万円増やしたい',
  '例：35歳のとき結婚式・新婚旅行で200万円の支出が見込まれる',
  '例：現在育休中で今後1年間は積立を月1万円に減らす必要がある',
  '例：5年後に親から500万円の援助を受けられる見込み',
  '例：副業が軌道に乗ったら40歳までに積立を月10万に増やす',
];

const SAVINGS_PRESETS = [0, 50_000, 100_000, 300_000, 500_000, 1_000_000, 3_000_000];
const GOAL_PRESETS    = [1_000_000, 3_000_000, 5_000_000, 10_000_000, 30_000_000, 100_000_000];

const CAPEX_PRESETS: { label: string; pct: number; icon: string; desc: string }[] = [
  { label: '節約優先', pct: 10, icon: '🌱', desc: '生活費優先、無理なく継続' },
  { label: 'バランス', pct: 20, icon: '⚖️', desc: '資産形成の一般的な目安' },
  { label: '積極投資', pct: 30, icon: '🔥', desc: '将来へ強くコミット' },
  { label: 'フル投資', pct: 50, icon: '💰', desc: '余剰資金が豊富な方向け' },
];

// ── Step components ───────────────────────────────────────────────────────────

function StyleStep({ form, setForm }: { form: WizardData; setForm: React.Dispatch<React.SetStateAction<WizardData>> }) {
  const styleOpts: { value: InvestStyle; label: string; icon: string; desc: string; recommended?: boolean }[] = [
    { value: 'index',      label: 'インデックスファンド中心', icon: '📈', recommended: true,
      desc: '全世界・米国株などのインデックスで長期積立。このサービスの得意分野です。' },
    { value: 'individual', label: '個別株も組み合わせたい',   icon: '📊',
      desc: 'インデックスがベース、個別株もやりたい方。このサービスではインデックス部分を試算します。' },
    { value: 'unknown',    label: 'まだわからない',           icon: '🤔',
      desc: 'どちらでも大丈夫。まずはシミュレーションしてみましょう。' },
  ];
  const approachOpts: { value: InvestApproach; label: string; icon: string; desc: string; recommended?: boolean }[] = [
    { value: 'dca',     label: '毎月コツコツ積み立て', icon: '📅', recommended: true,
      desc: '給料から一定額を毎月自動投資。時間分散で価格変動リスクを抑えます。' },
    { value: 'lump',    label: 'まとまった資金で一括', icon: '💸',
      desc: '手元にある資金をまとめて投資。タイミングの見極めが重要になります。' },
    { value: 'both',    label: '一括 ＋ 積み立て',    icon: '🔀',
      desc: '現在の貯蓄を一括投資しながら、毎月も積み立てる組み合わせ方。' },
    { value: 'unknown', label: 'わからない',           icon: '🤔',
      desc: 'まずシミュレーションで感覚をつかんでから考えましょう。' },
  ];

  return (
    <div className="py-4 md:py-6">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">🎯</div>
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">投資の進め方を教えてください</h2>
        <p className="text-slate-500 text-sm">選択肢によってシミュレーション内容は変わりません。参考情報として使います。</p>
      </div>

      <div className="space-y-6 max-w-md mx-auto">
        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">投資スタイル</p>
          <div className="space-y-2">
            {styleOpts.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setForm(f => ({ ...f, investStyle: opt.value }))}
                className={`w-full rounded-xl border-2 p-3 text-left transition-all ${
                  form.investStyle === opt.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-xl flex-shrink-0">{opt.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold text-sm ${form.investStyle === opt.value ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</p>
                      {opt.recommended && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">おすすめ</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                  </div>
                  {form.investStyle === opt.value && <span className="text-blue-500 flex-shrink-0 text-sm">✓</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">積み立て方針</p>
          <div className="space-y-2">
            {approachOpts.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setForm(f => ({ ...f, investApproach: opt.value }))}
                className={`w-full rounded-xl border-2 p-3 text-left transition-all ${
                  form.investApproach === opt.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-xl flex-shrink-0">{opt.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold text-sm ${form.investApproach === opt.value ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</p>
                      {opt.recommended && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">おすすめ</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                  </div>
                  {form.investApproach === opt.value && <span className="text-blue-500 flex-shrink-0 text-sm">✓</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function AgeStep({ form, setForm }: { form: WizardData; setForm: React.Dispatch<React.SetStateAction<WizardData>> }) {
  const curYear  = new Date().getFullYear();
  const birthYears = Array.from({ length: curYear - 1973 }, (_, i) => curYear - 14 - i); // 1960〜
  const maxDay = daysInMonth(form.birthYear, form.birthMonth);
  const dayOptions = Array.from({ length: maxDay }, (_, i) => i + 1);

  const currentAge   = computeAge(form.birthYear, form.birthMonth, form.birthDay);
  const investAge    = computeAge(form.birthYear, form.birthMonth, form.birthDay, form.investStartYearsLater);
  const investYear   = curYear + form.investStartYearsLater;

  return (
    <div className="py-6 md:py-8">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🎂</div>
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">生年月日を教えてください</h2>
        <p className="text-slate-500 text-sm">年齢と投資開始時期の計算に使います</p>
      </div>

      <div className="max-w-sm mx-auto space-y-5">
        {/* Birth date */}
        <div className="bg-slate-50 rounded-2xl p-5">
          <p className="text-xs font-semibold text-slate-400 mb-3 text-center">生年月日</p>
          <div className="flex gap-2 justify-center">
            <select
              value={form.birthYear}
              onChange={e => {
                const y = Number(e.target.value);
                const max = daysInMonth(y, form.birthMonth);
                setForm(f => ({ ...f, birthYear: y, birthDay: Math.min(f.birthDay, max) }));
              }}
              className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-2 py-2.5 text-center font-bold text-blue-700 text-base focus:border-blue-400 focus:outline-none"
            >
              {birthYears.map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select
              value={form.birthMonth}
              onChange={e => {
                const m = Number(e.target.value);
                const max = daysInMonth(form.birthYear, m);
                setForm(f => ({ ...f, birthMonth: m, birthDay: Math.min(f.birthDay, max) }));
              }}
              className="w-20 rounded-xl border-2 border-slate-200 bg-white px-2 py-2.5 text-center font-bold text-blue-700 text-base focus:border-blue-400 focus:outline-none"
            >
              {MONTH_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select
              value={form.birthDay}
              onChange={e => setForm(f => ({ ...f, birthDay: Number(e.target.value) }))}
              className="w-[4.5rem] rounded-xl border-2 border-slate-200 bg-white px-1 py-2.5 text-center font-bold text-blue-700 text-base focus:border-blue-400 focus:outline-none"
            >
              {dayOptions.map(d => <option key={d} value={d}>{d}日</option>)}
            </select>
          </div>

          {/* Computed current age */}
          {currentAge > 0 && (
            <div className="mt-4 text-center wizard-fade-up">
              <p className="text-xs text-slate-400">現在の年齢</p>
              <p className="text-5xl font-black">
                <span className="text-blue-600">{currentAge}</span>
                <span className="text-2xl font-bold text-slate-400 ml-1">歳</span>
              </p>
            </div>
          )}
        </div>

        {/* Invest start offset */}
        {currentAge > 0 && (
          <div className="bg-slate-50 rounded-2xl p-5 wizard-fade-up">
            <p className="text-xs font-semibold text-slate-400 mb-4 text-center">投資を始めるのはいつ頃ですか？</p>

            <div className="text-center mb-4">
              {form.investStartYearsLater === 0 ? (
                <div>
                  <p className="text-3xl font-black text-blue-600">今すぐ開始</p>
                  <p className="text-sm text-slate-400 mt-1">{currentAge}歳・{curYear}年から</p>
                </div>
              ) : (
                <div>
                  <p className="text-3xl font-black text-blue-600">
                    {form.investStartYearsLater}年後
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    {investAge}歳・{investYear}年から
                  </p>
                </div>
              )}
            </div>

            <input type="range" min={0} max={10} step={1}
              value={form.investStartYearsLater}
              onChange={e => setForm(f => ({ ...f, investStartYearsLater: Number(e.target.value) }))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>今すぐ</span><span>10年後</span>
            </div>
          </div>
        )}

        {/* Age hint */}
        {investAge >= 15 && investAge <= 80 && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-700 wizard-fade-up">
            {getAgeHint(investAge)}
          </div>
        )}
      </div>
    </div>
  );
}

function YearsStep({ form, setForm }: { form: WizardData; setForm: React.Dispatch<React.SetStateAction<WizardData>> }) {
  const targetYear = new Date().getFullYear() + form.years;
  return (
    <div className="text-center py-6 md:py-10">
      <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">何年後に出金したいですか？</h2>
      <p className="text-slate-500 mb-10">次のステップで収入の変化幅も設定します</p>
      <div className="mb-2">
        <span className="text-7xl md:text-8xl font-black text-blue-600">{form.years}</span>
        <span className="text-3xl font-bold text-slate-400 ml-2">年後</span>
      </div>
      <p className="text-slate-400 text-lg mb-10">{targetYear}年が目標です</p>
      <input type="range" min={1} max={40} value={form.years}
        onChange={e => setForm(f => ({ ...f, years: Number(e.target.value) }))}
        className="w-full max-w-xs accent-blue-600"
      />
      <div className="flex justify-between text-sm text-slate-400 max-w-xs mx-auto mt-1 px-1">
        <span>1年</span><span>40年</span>
      </div>
    </div>
  );
}

function IncomeCapexStep({ form, setForm }: { form: WizardData; setForm: React.Dispatch<React.SetStateAction<WizardData>> }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 300); }, []);

  const n = form.years;
  const pct = Math.round(form.capexMargin * 100);
  const monthlyY1 = +(form.incomeYear1 * form.capexMargin).toFixed(1);
  const monthlyYN = +(form.incomeYearN * form.capexMargin).toFixed(1);

  const rawYears = [1, Math.ceil(n / 2), n];
  const previewYears = rawYears.filter((y, i, a) => a.indexOf(y) === i && y >= 1 && y <= n);
  const lerp = (y: number) => {
    const t = n === 1 ? 0 : (y - 1) / (n - 1);
    return form.incomeYear1 + (form.incomeYearN - form.incomeYear1) * t;
  };

  return (
    <div className="py-4 md:py-6">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">💴</div>
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">収入と積立を設定しましょう</h2>
        <p className="text-slate-500 text-sm">手取り月収と積立率から毎月の積立額を計算します</p>
      </div>

      <div className="max-w-sm mx-auto space-y-4">
        {/* ── Section 1: Income ── */}
        <div className="bg-slate-50 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-600 mb-3">📥 手取り月収</p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-400 mb-1.5">1年目</p>
              <div className="flex items-end gap-2">
                <input ref={ref} type="number" min={0} step={0.5}
                  value={form.incomeYear1 || ''}
                  onChange={e => setForm(f => ({ ...f, incomeYear1: parseFloat(e.target.value) || 0 }))}
                  className="wizard-number-input w-28 text-3xl"
                  placeholder="25"
                />
                <span className="text-lg font-bold text-slate-400 mb-1">万円/月</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1.5">{n}年目（予想）</p>
              <div className="flex items-end gap-2">
                <input type="number" min={0} step={0.5}
                  value={form.incomeYearN || ''}
                  onChange={e => setForm(f => ({ ...f, incomeYearN: parseFloat(e.target.value) || 0 }))}
                  className="wizard-number-input w-28 text-3xl"
                  placeholder="35"
                />
                <span className="text-lg font-bold text-slate-400 mb-1">万円/月</span>
              </div>
            </div>
          </div>
          {form.incomeYear1 > 0 && previewYears.length > 1 && (
            <div className="flex items-stretch bg-blue-50 rounded-xl overflow-hidden mt-3">
              {previewYears.map((y, i) => (
                <div key={y} className={`flex-1 text-center py-2 ${i > 0 ? 'border-l border-blue-100' : ''}`}>
                  <p className="text-xs text-slate-400">{y}年目</p>
                  <p className="font-bold text-blue-700 text-sm">{lerp(y).toFixed(1)}<span className="text-xs font-normal">万</span></p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">同じ値でもOK。変化しない場合は両方に同じ数字を</p>
        </div>

        {/* ── Section 2: Capex ── */}
        <div className="bg-slate-50 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-600 mb-3">📤 積立率</p>

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            {(['percent', 'fixed'] as CapexMode[]).map(mode => (
              <button key={mode}
                onClick={() => setForm(f => ({ ...f, capexMode: mode }))}
                className={`flex-1 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  form.capexMode === mode ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {mode === 'percent' ? '% 指定（おすすめ）' : '金額固定'}
              </button>
            ))}
          </div>

          {form.capexMode === 'percent' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {CAPEX_PRESETS.map(p => {
                  const active = pct === p.pct;
                  return (
                    <button key={p.pct} onClick={() => setForm(f => ({ ...f, capexMargin: p.pct / 100 }))}
                      className={`rounded-xl border-2 p-2.5 text-left transition-all ${
                        active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-sm">{p.icon}</span>
                        <span className={`font-bold text-xs ${active ? 'text-blue-700' : 'text-slate-700'}`}>
                          {p.label} {p.pct}%
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{p.desc}</p>
                      {form.incomeYear1 > 0 && (
                        <p className="text-xs font-semibold text-emerald-600 mt-1">
                          → 月{+(form.incomeYear1 * p.pct / 100).toFixed(1)}万円〜
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-slate-200">
                <p className="text-xs text-slate-500 flex-shrink-0">カスタム</p>
                <input type="range" min={5} max={80} step={1} value={pct}
                  onChange={e => setForm(f => ({ ...f, capexMargin: Number(e.target.value) / 100 }))}
                  className="flex-1 accent-blue-600"
                />
                <span className="font-black text-blue-700 text-lg flex-shrink-0 w-10 text-right">{pct}%</span>
              </div>

              {form.incomeYear1 > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-slate-500 mb-1.5">積立額の見込み</p>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600">1年目</span>
                    <span className="font-bold text-emerald-700">月{monthlyY1}万円</span>
                  </div>
                  {n > 1 && Math.abs(form.incomeYearN - form.incomeYear1) > 0.05 && (
                    <div className="flex justify-between mt-1">
                      <span className="text-sm text-slate-600">{n}年目</span>
                      <span className="font-bold text-emerald-700">月{monthlyYN}万円</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white rounded-xl p-4 text-center border border-slate-200">
                <p className="text-xs text-slate-400 mb-2">毎月の積立額（固定）</p>
                <div className="flex items-end justify-center gap-2">
                  <input type="number" min={0} step={0.5}
                    value={form.fixedMonthly || ''}
                    onChange={e => setForm(f => ({ ...f, fixedMonthly: parseFloat(e.target.value) || 0 }))}
                    className="wizard-number-input w-32 text-4xl"
                    placeholder="3"
                  />
                  <span className="text-xl font-bold text-slate-400 mb-1">万円/月</span>
                </div>
              </div>
              {form.incomeYear1 > 0 && form.fixedMonthly > 0 && (
                <p className="text-center text-sm text-slate-400">
                  1年目の手取り月収の約 <span className="font-bold text-blue-600">
                    {Math.round(form.fixedMonthly / form.incomeYear1 * 100)}%
                  </span> を投資
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManYenStep({
  form, setForm, field, question, hint, presets, step: stepSize, onEnter,
}: {
  form: WizardData;
  setForm: React.Dispatch<React.SetStateAction<WizardData>>;
  field: 'savings' | 'goal';
  question: string;
  hint: string;
  presets: number[];
  step: number;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 300); }, []);
  const value = form[field] as number;

  return (
    <div className="text-center py-6 md:py-10">
      <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">{question}</h2>
      <p className="text-slate-500 mb-10">{hint}</p>
      <div className="flex items-end justify-center gap-2">
        <input ref={ref} type="number" min={0} step={stepSize}
          value={toMan(value)}
          onChange={e => {
            const n = parseFloat(e.target.value) || 0;
            setForm(f => ({ ...f, [field]: Math.round(n * 10_000) }));
          }}
          onKeyDown={e => e.key === 'Enter' && onEnter()}
          className="wizard-number-input w-40 md:w-52 text-5xl md:text-6xl"
        />
        <span className="text-2xl font-bold text-slate-400 mb-2">万円</span>
      </div>
      <p className="text-slate-400 mt-3 text-base">= {fmtJPY(value)}</p>
      <div className="flex flex-wrap justify-center gap-2 mt-8">
        {presets.map(v => (
          <button key={v} type="button"
            onClick={() => setForm(f => ({ ...f, [field]: v }))}
            className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
              value === v
                ? 'bg-blue-600 text-white border-blue-600 shadow'
                : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {fmtJPY(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RiskStep({ form, setForm }: { form: WizardData; setForm: React.Dispatch<React.SetStateAction<WizardData>> }) {
  return (
    <div className="py-6 md:py-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">投資スタイルを選んでください</h2>
        <p className="text-slate-500 text-sm">コースによって期待リターンとリスクが変わります。迷ったら「バランスコース」がおすすめ。</p>
      </div>
      <div className="space-y-3 max-w-md mx-auto">
        {RISK_OPTIONS.map(opt => (
          <button key={opt.value} type="button"
            onClick={() => setForm(f => ({ ...f, risk_level: opt.value, isCustomAllocation: false }))}
            className={`w-full rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
              form.risk_level === opt.value && !form.isCustomAllocation
                ? 'border-blue-500 bg-blue-50 shadow-md scale-[1.01]'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5 flex-shrink-0">{opt.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className={`font-bold text-lg leading-tight ${form.risk_level === opt.value && !form.isCustomAllocation ? 'text-blue-700' : 'text-slate-700'}`}>
                    {opt.label}
                  </p>
                  {form.risk_level === opt.value && !form.isCustomAllocation && <span className="text-blue-500 text-base">✓</span>}
                </div>
                <p className="text-xs text-slate-400 mb-1.5">{opt.sub}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{opt.desc}</p>
                <p className={`text-xs mt-1.5 font-medium ${form.risk_level === opt.value && !form.isCustomAllocation ? 'text-blue-500' : 'text-slate-400'}`}>
                  👤 {opt.hint}
                </p>
              </div>
            </div>
          </button>
        ))}

        {/* ── カスタム（上級者）─────────────────────────────────────── */}
        <button type="button"
          onClick={() => setForm(f => ({ ...f, isCustomAllocation: true }))}
          className={`w-full rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
            form.isCustomAllocation
              ? 'border-indigo-500 bg-indigo-50 shadow-md scale-[1.01]'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5 flex-shrink-0">🎨</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className={`font-bold text-lg leading-tight ${form.isCustomAllocation ? 'text-indigo-700' : 'text-slate-700'}`}>
                  カスタム
                </p>
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">上級者向け</span>
                {form.isCustomAllocation && <span className="text-indigo-500 text-base">✓</span>}
              </div>
              <p className="text-xs text-slate-400 mb-1.5">銘柄・比率を自由に組み合わせる完全カスタムモード</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                オルカン・S&P500・FANG+・ビットコインなど8銘柄から自由に配分を決められます。
              </p>
              <p className={`text-xs mt-1.5 font-medium ${form.isCustomAllocation ? 'text-indigo-500' : 'text-slate-400'}`}>
                👤 投資経験あり / 特定テーマに集中投資したい
              </p>
            </div>
          </div>
        </button>

        {/* ── CustomAllocationBuilder (カスタム選択時) ──────────────── */}
        {form.isCustomAllocation && (
          <div className="mt-1">
            <CustomAllocationBuilder
              value={form.customAllocation}
              onChange={(alloc) => setForm(f => ({ ...f, customAllocation: alloc }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NotesStep({
  lines, onUpdateLine, onAddLine, onRemoveLine, notesPhase, parsedNotes, onEdit,
}: {
  lines: string[];
  onUpdateLine: (i: number, v: string) => void;
  onAddLine: () => void;
  onRemoveLine: (i: number) => void;
  notesPhase: NotesPhase;
  parsedNotes: ParsedNotes | null;
  onEdit: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => firstRef.current?.focus(), 300); }, []);

  return (
    <div className="py-6 md:py-8">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">💬</div>
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">特別な条件はありますか？</h2>
        <p className="text-slate-500 text-sm">AIが読み取り、シミュレーションに自動反映します（任意・スキップ可）</p>
      </div>

      {notesPhase !== 'parsed' && (
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="text" value={line}
                onChange={e => onUpdateLine(i, e.target.value)}
                disabled={notesPhase === 'parsing'}
                placeholder={NOTES_ROW_PLACEHOLDERS[i % NOTES_ROW_PLACEHOLDERS.length]}
                className="input-field text-sm py-2.5 flex-1"
              />
              {lines.length > 1 && (
                <button onClick={() => onRemoveLine(i)} disabled={notesPhase === 'parsing'}
                  className="flex-shrink-0 w-7 h-7 rounded-full text-slate-300 hover:text-rose-400 hover:bg-rose-50 transition-colors text-lg leading-none"
                >×</button>
              )}
            </div>
          ))}
          <button onClick={onAddLine} disabled={notesPhase === 'parsing'}
            className="mt-2 w-full py-2 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-blue-300 hover:text-blue-500 text-sm transition-colors"
          >
            + 条件を追加
          </button>
        </div>
      )}

      {notesPhase === 'parsing' && (
        <div className="flex flex-col items-center gap-3 py-8 text-blue-600">
          <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="font-medium">AIが条件を解析しています…</p>
        </div>
      )}

      {notesPhase === 'parsed' && parsedNotes && (
        <div className="wizard-fade-up space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
              <div>
                <p className="font-semibold text-emerald-800 text-sm mb-1">解析完了 ✅</p>
                <p className="text-slate-700 text-sm leading-relaxed">{parsedNotes.summary}</p>
              </div>
            </div>
          </div>
          {(parsedNotes.future_changes.length > 0 || parsedNotes.lump_sum_additions.length > 0) && (
            <div className="space-y-2">
              {parsedNotes.future_changes.map((c: FutureChange, i: number) => (
                <div key={i} className="flex items-start gap-2 bg-blue-50 rounded-xl p-3 text-sm">
                  <span className="text-blue-500 flex-shrink-0 mt-0.5">📅</span>
                  <span className="text-slate-700 flex-1">{c.description}</span>
                  <span className={`font-bold flex-shrink-0 ${c.monthly_delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {c.monthly_delta >= 0 ? '+' : ''}{(c.monthly_delta / 10_000).toFixed(1)}万円/月
                  </span>
                </div>
              ))}
              {parsedNotes.lump_sum_additions.map((l: LumpSumAddition, i: number) => (
                <div key={i} className="flex items-start gap-2 bg-amber-50 rounded-xl p-3 text-sm">
                  <span className={`flex-shrink-0 mt-0.5 ${l.amount >= 0 ? 'text-amber-500' : 'text-rose-400'}`}>
                    {l.amount >= 0 ? '💰' : '💸'}
                  </span>
                  <span className="text-slate-700 flex-1">{l.description}</span>
                  <span className={`font-bold flex-shrink-0 ${l.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {l.amount >= 0 ? '+' : ''}{fmtJPY(l.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button onClick={onEdit}
            className="text-sm text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
            ✏️ 条件を編集する
          </button>
        </div>
      )}
    </div>
  );
}

// ── WizardForm (main) ─────────────────────────────────────────────────────────

const STEP_LABELS = ['方針', '生年月日', '期間', '収入・積立', '貯蓄', 'リスク', '条件'];

export default function WizardForm({ onSubmit, isLoading }: WizardFormProps) {
  const [step, setStep] = useState(0);
  const [dir,  setDir]  = useState<'fwd' | 'bwd'>('fwd');
  const [form, setForm] = useState<WizardData>({
    investStyle:          'index',
    investApproach:       'dca',
    birthYear:            new Date().getFullYear() - 25,   // ~25歳
    birthMonth:           1,
    birthDay:             1,
    investStartYearsLater: 0,
    years:        5,
    incomeYear1:  20,
    incomeYearN:  35,
    capexMargin:  0.20,
    capexMode:    'percent',
    fixedMonthly: 3,
    savings:      100_000,
    goal:         10_000_000,
    risk_level:   'medium',
    isCustomAllocation: false,
    customAllocation:   {},
  });
  const [notesLines, setNotesLines] = useState<string[]>(['', '', '']);
  const [notesPhase, setNotesPhase] = useState<NotesPhase>('input');
  const [parsedNotes, setParsedNotes] = useState<ParsedNotes | null>(null);

  const getNotesStr = () => notesLines.filter(l => l.trim()).join('\n');

  const parseNotes = async () => {
    setNotesPhase('parsing');
    const investAge = computeAge(form.birthYear, form.birthMonth, form.birthDay, form.investStartYearsLater);
    try {
      const res = await fetch(`${API_URL}/api/parse-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age:        investAge,
          savings:    form.savings,
          monthly:    effectiveMonthly(form),
          goal:       form.goal,
          years:      form.years,
          risk_level: form.risk_level,
          notes:      getNotesStr(),
        }),
      });
      if (res.ok) { setParsedNotes(await res.json()); setNotesPhase('parsed'); }
      else setNotesPhase('input');
    } catch { setNotesPhase('input'); }
  };

  const goNext = async () => {
    if (step === NOTES_STEP) {
      if (getNotesStr() && notesPhase === 'input') { await parseNotes(); return; }
      handleSubmit();
    } else if (step < TOTAL_INPUT_STEPS - 1) {
      setDir('fwd');
      setStep(s => s + 1);
    }
  };

  const goBack = () => {
    if (step > 0) {
      if (step === NOTES_STEP) { setNotesPhase('input'); setParsedNotes(null); }
      setDir('bwd');
      setStep(s => s - 1);
    }
  };

  const handleSubmit = () => {
    const baseMonthly   = effectiveMonthly(form);
    const incomeChanges = computeIncomeChanges(form);
    const notesChanges  = parsedNotes?.future_changes ?? [];
    const investAge     = computeAge(form.birthYear, form.birthMonth, form.birthDay, form.investStartYearsLater);
    onSubmit({
      savings:            form.savings,
      monthly:            baseMonthly,
      goal:               form.goal,
      years:              form.years,
      risk_level:         form.risk_level,
      age:                investAge,
      notes:              getNotesStr() || undefined,
      future_changes:     [...incomeChanges, ...notesChanges],
      lump_sum_additions: parsedNotes?.lump_sum_additions ?? [],
      custom_allocation:  form.isCustomAllocation && Object.keys(form.customAllocation).length > 0
        ? form.customAllocation
        : undefined,
      // Extended logging fields
      birth_year:                form.birthYear,
      birth_month:               form.birthMonth,
      birth_day:                 form.birthDay,
      income_year1:              form.incomeYear1,
      income_year_n:             form.incomeYearN,
      capex_margin:              form.capexMargin,
      capex_mode:                form.capexMode,
      invest_style:              form.investStyle,
      invest_approach:           form.investApproach,
      invest_start_years_later:  form.investStartYearsLater,
    });
  };

  const nextBtnLabel = () => {
    if (step === NOTES_STEP) {
      if (notesPhase === 'parsing') return null;
      if (getNotesStr() && notesPhase === 'input') return 'AIで解析 →';
      if (notesPhase === 'parsed') return 'シミュレーション開始 🚀';
      return 'スキップしてシミュレーション開始 🚀';
    }
    return '次へ →';
  };

  const progress = ((step + 1) / TOTAL_INPUT_STEPS) * 100;

  return (
    <div className="max-w-lg mx-auto px-2">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between text-xs text-slate-400 mb-2">
          <span>STEP {step + 1} / {TOTAL_INPUT_STEPS}　<span className="text-slate-500 font-medium">{STEP_LABELS[step]}</span></span>
          <span>{TOTAL_INPUT_STEPS - step - 1 > 0 ? `あと ${TOTAL_INPUT_STEPS - step - 1} ステップ` : '最後のステップ'}</span>
        </div>
        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-center gap-1.5 mt-3">
          {Array.from({ length: TOTAL_INPUT_STEPS }).map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
              i === step ? 'bg-blue-600 w-4' : i < step ? 'bg-blue-300 w-1.5' : 'bg-slate-200 w-1.5'
            }`} />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div key={`${step}-${dir}`} className={dir === 'fwd' ? 'wizard-enter-fwd' : 'wizard-enter-bwd'}>
        {step === 0 && <StyleStep       form={form} setForm={setForm} />}
        {step === 1 && <AgeStep         form={form} setForm={setForm} />}
        {step === 2 && <YearsStep       form={form} setForm={setForm} />}
        {step === 3 && <IncomeCapexStep form={form} setForm={setForm} />}
        {step === 4 && (
          <ManYenStep form={form} setForm={setForm} field="savings"
            question="現在の貯蓄額はいくらですか？"
            hint="投資に使える手元の金額の合計です。0円でも大丈夫！"
            presets={SAVINGS_PRESETS} step={1} onEnter={goNext}
          />
        )}
        {step === 5 && <RiskStep form={form} setForm={setForm} />}
        {step === 6 && (
          <NotesStep
            lines={notesLines}
            onUpdateLine={(i, v) => setNotesLines(ls => ls.map((l, idx) => idx === i ? v : l))}
            onAddLine={() => setNotesLines(ls => [...ls, ''])}
            onRemoveLine={(i) => setNotesLines(ls => ls.filter((_, idx) => idx !== i))}
            notesPhase={notesPhase}
            parsedNotes={parsedNotes}
            onEdit={() => { setNotesPhase('input'); setParsedNotes(null); }}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 space-y-3">
        {notesPhase !== 'parsing' && !isLoading && (
          <button onClick={goNext} className="btn-primary">{nextBtnLabel()}</button>
        )}
        {(notesPhase === 'parsing' || isLoading) && (
          <button disabled className="btn-primary">
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              {isLoading ? 'シミュレーション中…' : 'AIが解析中…'}
            </span>
          </button>
        )}
        {step > 0 && !isLoading && (
          <button onClick={goBack} className="w-full py-2 text-slate-400 hover:text-slate-600 text-sm transition-colors">
            ← 前のステップに戻る
          </button>
        )}
      </div>
    </div>
  );
}
