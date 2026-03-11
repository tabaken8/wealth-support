'use client';

interface LLMExplanationProps {
  analysis: string;
  advice: string;
  onTryMonthlyPlus?: () => void;  // +1万/月でシミュレーション
  onTryYearsPlus?: () => void;    // +3年延ばしてシミュレーション
  isLoading?: boolean;
}

export default function LLMExplanation({
  analysis, advice, onTryMonthlyPlus, onTryYearsPlus, isLoading,
}: LLMExplanationProps) {
  return (
    <div className="space-y-3">
      {/* Analysis */}
      <div className="card border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-base shadow-sm">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-700 mb-2">AIアドバイザーの分析</p>
            <p className="text-slate-700 text-sm leading-relaxed">{analysis}</p>
          </div>
        </div>
      </div>

      {/* One-point advice + try-it buttons */}
      {advice && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5">💡</span>
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1">ワンポイントアドバイス</p>
              <p className="text-slate-700 text-sm leading-relaxed">{advice}</p>
            </div>
          </div>

          {/* Try-it CTAs */}
          {(onTryMonthlyPlus || onTryYearsPlus) && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-200">
              <p className="w-full text-xs text-amber-600 font-medium">このアドバイスを試してみる：</p>
              {onTryMonthlyPlus && (
                <button
                  onClick={onTryMonthlyPlus}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs bg-white border border-amber-300 text-amber-700
                             hover:bg-amber-100 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50"
                >
                  {isLoading ? '計算中…' : '📈 積立を月1万増やしたら？'}
                </button>
              )}
              {onTryYearsPlus && (
                <button
                  onClick={onTryYearsPlus}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs bg-white border border-amber-300 text-amber-700
                             hover:bg-amber-100 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50"
                >
                  {isLoading ? '計算中…' : '📅 期間を3年延ばしたら？'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
