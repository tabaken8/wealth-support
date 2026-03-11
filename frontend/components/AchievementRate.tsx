'use client';

import { SimulateResponse } from '@/types';

interface AchievementRateProps {
  result: SimulateResponse;
}

function getColor(prob: number) {
  if (prob >= 75) return { ring: 'stroke-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: '達成可能性 高' };
  if (prob >= 50) return { ring: 'stroke-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', label: '達成可能性 中' };
  if (prob >= 30) return { ring: 'stroke-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', label: '達成可能性 要努力' };
  return { ring: 'stroke-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', label: '要見直し' };
}

export default function AchievementRate({ result }: AchievementRateProps) {
  const prob = result.achievement_probability;
  const { ring, text, bg, label } = getColor(prob);

  // SVG circle progress
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - prob / 100);

  return (
    <div className={`rounded-2xl ${bg} p-6 flex flex-col items-center text-center`}>
      <h3 className="section-title">目標達成確率</h3>

      {/* Circular progress */}
      <div className="relative w-40 h-40">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          {/* Background ring */}
          <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
          {/* Progress ring */}
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${ring} transition-all duration-[1500ms] ease-out`}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-4xl font-black ${text}`}>{prob.toFixed(0)}</span>
          <span className={`text-lg font-bold ${text}`}>%</span>
        </div>
      </div>

      <p className={`mt-3 text-sm font-semibold ${text}`}>{label}</p>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-2 gap-3 w-full text-sm">
        <div className="bg-white rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-0.5">期待年利</p>
          <p className={`font-bold text-base ${text}`}>
            {(result.expected_annual_return * 100).toFixed(1)}%
          </p>
        </div>
        <div className="bg-white rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-0.5">年間ボラティリティ</p>
          <p className="font-bold text-base text-slate-700">
            ±{(result.annual_volatility * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
