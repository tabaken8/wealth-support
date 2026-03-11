'use client';

import { useState } from 'react';
import { SimulateRequest, RiskLevel } from '@/types';

interface InputFormProps {
  onSubmit: (data: SimulateRequest) => void;
  isLoading: boolean;
}

const RISK_OPTIONS: { value: RiskLevel; label: string; desc: string; color: string }[] = [
  {
    value: 'low',
    label: '低リスク',
    desc: '株式30% / 債券50% / 金10% / 現金10%',
    color: 'border-teal-400 bg-teal-50 text-teal-700',
  },
  {
    value: 'medium',
    label: '中リスク',
    desc: '株式60% / 債券30% / 金7% / 現金3%',
    color: 'border-blue-400 bg-blue-50 text-blue-700',
  },
  {
    value: 'high',
    label: '高リスク',
    desc: '株式80% / 債券15% / 金5% / 現金0%',
    color: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  },
];

function formatNumber(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
  if (value >= 10_000) return `${Math.round(value / 10_000)}万円`;
  return `${value.toLocaleString()}円`;
}

export default function InputForm({ onSubmit, isLoading }: InputFormProps) {
  const [form, setForm] = useState<SimulateRequest>({
    savings: 500_000,
    monthly: 30_000,
    goal: 10_000_000,
    years: 10,
    risk_level: 'medium',
  });

  const handleChange = (field: keyof SimulateRequest, raw: string | number) => {
    const v = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : raw;
    setForm((prev) => ({ ...prev, [field]: v }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <div className="animate-slide-up">
      {/* Hero text */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">
          あなたの目標を教えてください
        </h2>
        <p className="text-slate-500 text-sm md:text-base">
          必要な情報を入力するだけで、AIがポートフォリオとシナリオを分析します
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-6">
        {/* Row: savings + monthly */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">現在の貯蓄額</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={10000}
                value={form.savings}
                onChange={(e) => handleChange('savings', e.target.value)}
                className="input-field pr-8"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                円
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{formatNumber(form.savings)}</p>
          </div>

          <div>
            <label className="label">毎月の積立額</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={1000}
                value={form.monthly}
                onChange={(e) => handleChange('monthly', e.target.value)}
                className="input-field pr-8"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                円
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{formatNumber(form.monthly)}/月</p>
          </div>
        </div>

        {/* Row: goal + years */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">目標金額</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={100000}
                value={form.goal}
                onChange={(e) => handleChange('goal', e.target.value)}
                className="input-field pr-8"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                円
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{formatNumber(form.goal)}</p>
          </div>

          <div>
            <label className="label">目標年数</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={40}
                value={form.years}
                onChange={(e) => handleChange('years', e.target.value)}
                className="flex-1 accent-blue-600"
              />
              <span className="text-2xl font-bold text-blue-600 w-16 text-right">
                {form.years}年
              </span>
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>1年</span>
              <span>40年</span>
            </div>
          </div>
        </div>

        {/* Risk level */}
        <div>
          <label className="label">リスク許容度</label>
          <div className="grid grid-cols-3 gap-3">
            {RISK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, risk_level: opt.value }))}
                className={`rounded-xl border-2 p-3 text-left transition-all duration-200
                  ${form.risk_level === opt.value
                    ? `${opt.color} border-current shadow-sm scale-[1.02]`
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
              >
                <p className="font-bold text-sm md:text-base">{opt.label}</p>
                <p className="text-xs mt-1 opacity-75 hidden md:block">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              シミュレーション中…
            </span>
          ) : (
            'シミュレーションを実行 →'
          )}
        </button>
      </form>
    </div>
  );
}
