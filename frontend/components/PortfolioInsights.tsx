'use client';

// ── Static educational content ────────────────────────────────────────────────
// Approximate 10-year historical correlations (2013-2023, USD, daily returns)

const ALL_TICKERS = ['VT', 'SPY', 'EWJ', 'AGG', 'GLD', 'SHV'] as const;
type Ticker = typeof ALL_TICKERS[number];

const TICKER_SHORT: Record<Ticker, string> = {
  VT: 'オルカン', SPY: 'S&P500', EWJ: '日本株', AGG: '債券', GLD: '金', SHV: '現金',
};

// Lower-triangle only (symmetric); row x col
const CORR: Record<Ticker, Record<Ticker, number>> = {
  VT:  { VT: 1.00, SPY: 0.98, EWJ: 0.78, AGG: -0.02, GLD:  0.04, SHV: -0.05 },
  SPY: { VT: 0.98, SPY: 1.00, EWJ: 0.75, AGG: -0.03, GLD:  0.03, SHV: -0.04 },
  EWJ: { VT: 0.78, SPY: 0.75, EWJ: 1.00, AGG: -0.01, GLD:  0.02, SHV: -0.02 },
  AGG: { VT:-0.02, SPY:-0.03, EWJ:-0.01, AGG:  1.00, GLD:  0.12, SHV:  0.28 },
  GLD: { VT: 0.04, SPY: 0.03, EWJ: 0.02, AGG:  0.12, GLD:  1.00, SHV:  0.04 },
  SHV: { VT:-0.05, SPY:-0.04, EWJ:-0.02, AGG:  0.28, GLD:  0.04, SHV:  1.00 },
};

function corrColor(v: number, isDiag: boolean): string {
  if (isDiag) return 'bg-slate-100 text-slate-500';
  if (v >= 0.70) return 'bg-rose-100 text-rose-700 font-semibold';
  if (v >= 0.30) return 'bg-orange-50 text-orange-600';
  if (v <= -0.30) return 'bg-blue-100 text-blue-700 font-semibold';
  if (v <= -0.10) return 'bg-blue-50 text-blue-500';
  return 'bg-emerald-50 text-emerald-700 font-semibold'; // near-zero = good diversification
}

// ── Market scenario table ─────────────────────────────────────────────────────

type Effect = '↑↑' | '↑' | '→' | '↓' | '↓↓';
interface Scenario {
  name: string;
  note: string;
  effects: Record<Ticker, Effect>;
  current?: boolean; // ← 現在(2026年3月)に該当
}

// 2026年3月の現況：日銀利上げ継続 + 米国関税・地政学リスク が主な特徴
// → 「金利上昇局面」と「地政学リスク」をハイライト
const SCENARIOS: Scenario[] = [
  {
    name: '好景気・株高',
    note: '企業業績好調、リスク選好',
    effects: { VT:'↑↑', SPY:'↑↑', EWJ:'↑', AGG:'→', GLD:'→', SHV:'→' },
  },
  {
    name: 'インフレ加速',
    note: '物価上昇、実質金利低下',
    effects: { VT:'↓', SPY:'↓', EWJ:'↓', AGG:'↓↓', GLD:'↑↑', SHV:'→' },
  },
  {
    name: '金利上昇局面',
    note: '中央銀行引き締め、利上げ',
    effects: { VT:'↓', SPY:'↓', EWJ:'↓', AGG:'↓↓', GLD:'→', SHV:'↑' },
    current: true,
  },
  {
    name: '景気後退',
    note: '企業収益悪化、リスク回避',
    effects: { VT:'↓↓', SPY:'↓↓', EWJ:'↓↓', AGG:'↑', GLD:'↑', SHV:'↑↑' },
  },
  {
    name: '地政学リスク',
    note: '紛争・政治的不安定',
    effects: { VT:'↓', SPY:'↓', EWJ:'↓↓', AGG:'↑', GLD:'↑↑', SHV:'↑' },
    current: true,
  },
  {
    name: '円安進行',
    note: '日本円の対ドル下落',
    effects: { VT:'↑', SPY:'↑', EWJ:'↑↑', AGG:'→', GLD:'↑', SHV:'→' },
  },
];

function effectStyle(e: Effect): string {
  if (e === '↑↑') return 'text-emerald-600 font-bold';
  if (e === '↑')  return 'text-emerald-500';
  if (e === '→')  return 'text-slate-400';
  if (e === '↓')  return 'text-rose-400';
  return 'text-rose-600 font-bold'; // ↓↓
}

// ── Diversification Ratio verdict ─────────────────────────────────────────────

function drVerdict(dr: number): { label: string; color: string; bg: string } {
  if (dr >= 1.40) return { label: '非常に優秀', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' };
  if (dr >= 1.25) return { label: '優秀', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
  if (dr >= 1.10) return { label: '良好', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' };
  if (dr >= 1.00) return { label: '標準的', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' };
  return { label: '集中気味', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PortfolioInsightsProps {
  allocation: Record<string, number>;
  diversificationRatio: number;
}

export default function PortfolioInsights({ allocation, diversificationRatio }: PortfolioInsightsProps) {
  const activeTickers = ALL_TICKERS.filter(t => (allocation[t] ?? 0) > 0);
  const verdict = drVerdict(diversificationRatio);
  const riskReductionPct = Math.round((1 - 1 / diversificationRatio) * 100);
  const barWidth = Math.min(100, Math.max(0, ((diversificationRatio - 1) / 0.5) * 100));

  return (
    <div className="card space-y-6">
      <h3 className="section-title">ポートフォリオ解説</h3>

      {/* ── Diversification Ratio ── */}
      <div className={`rounded-2xl border px-4 py-3.5 ${verdict.bg}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-slate-700">分散スコア（Diversification Ratio）</p>
          <span className={`text-sm font-bold ${verdict.color}`}>
            {diversificationRatio.toFixed(2)}　{verdict.label}
          </span>
        </div>
        {/* Progress bar */}
        <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all"
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          各資産を単独で保有した場合と比べ、組み合わせることでリスクが約
          <span className={`font-bold mx-1 ${verdict.color}`}>{riskReductionPct}%</span>
          低減されています。DR が 1.25 以上で「優秀」、1.10 以上で「良好」な分散効果です。
          {diversificationRatio >= 1.25
            ? ' あなたのポートフォリオは資産間の低相関を活かした、効率的な分散が実現できています。'
            : diversificationRatio >= 1.10
            ? ' 一定の分散効果があります。さらに相関の低い資産（債券・金など）を加えると改善できます。'
            : ' 資産間の相関が比較的高いため、分散効果は限定的です。資産クラスを増やすと改善できます。'}
        </p>
      </div>

      {/* ── Correlation matrix ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-semibold text-slate-600">
            資産間の相関係数（過去10年・日次リターン）
          </p>
        </div>
        <p className="text-xs text-slate-500 mb-1 leading-relaxed">
          <a
            href="https://ja.wikipedia.org/wiki/%E7%8F%BE%E4%BB%A3%E3%83%9D%E3%83%BC%E3%83%88%E3%83%95%E3%82%A9%E3%83%AA%E3%82%AA%E7%90%86%E8%AB%96"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800"
          >
            現代ポートフォリオ理論（MPT）
          </a>
          では、相関係数が低い資産を組み合わせることでリスク（標準偏差）を低減できます。
          以下の表は2013〜2023年の実績日次リターンから算出した資産間の相関係数です。
        </p>
        <p className="text-xs text-slate-400 mb-3">
          <span className="inline-block w-3 h-3 rounded bg-emerald-100 mr-1 align-middle" />低相関（分散効果大）
          <span className="inline-block w-3 h-3 rounded bg-rose-100 ml-3 mr-1 align-middle" />高相関（同じ動き）
          <span className="inline-block w-3 h-3 rounded bg-blue-100 ml-3 mr-1 align-middle" />逆相関（値動きが逆）
        </p>
        {activeTickers.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-2">
            ※ 相関係数の表示は VT・SPY・EWJ・AGG・GLD・SHV を含むポートフォリオのみ対応しています。
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-1.5 text-left text-slate-400 font-normal w-16" />
                    {activeTickers.map(col => (
                      <th key={col} className="p-1.5 text-center text-slate-500 font-semibold min-w-[52px]">
                        {TICKER_SHORT[col]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeTickers.map(row => (
                    <tr key={row}>
                      <td className="p-1.5 text-slate-500 font-semibold pr-2 whitespace-nowrap">
                        {TICKER_SHORT[row]}
                      </td>
                      {activeTickers.map(col => {
                        const v = CORR[row][col];
                        const isDiag = row === col;
                        return (
                          <td
                            key={col}
                            className={`p-1.5 text-center rounded ${corrColor(v, isDiag)}`}
                          >
                            {isDiag ? '—' : v.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              株式同士（オルカン・S&P500・日本株）は高相関ですが、債券・金との相関は低く（または逆相関）、組み合わせることでポートフォリオ全体の標準偏差を低減できます。これが分散投資の核心です。
            </p>
          </>
        )}
      </div>

      {/* ── Market scenario analysis ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-semibold text-slate-600">マクロ経済シナリオ別の影響</p>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
            🌐 2026年3月のマクロ環境に該当するシナリオ
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-3 text-left text-slate-400 font-normal min-w-[110px]">シナリオ</th>
                {activeTickers.map(t => (
                  <th key={t} className="py-1.5 px-1 text-center text-slate-500 font-semibold min-w-[44px]">
                    {TICKER_SHORT[t]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map(s => (
                <tr key={s.name} className={`border-b ${s.current ? 'border-amber-100 bg-amber-50' : 'border-slate-50'}`}>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-medium ${s.current ? 'text-amber-800' : 'text-slate-700'}`}>{s.name}</span>
                      {s.current && (
                        <span className="text-[10px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">
                          NOW
                        </span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 ${s.current ? 'text-amber-600' : 'text-slate-400'}`}>{s.note}</div>
                  </td>
                  {activeTickers.map(t => (
                    <td key={t} className={`py-2 px-1 text-center ${effectStyle(s.effects[t])} ${s.current ? 'font-bold' : ''}`}>
                      {s.effects[t]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          ↑↑ 大きく上昇しやすい　↑ やや上昇　→ ほぼ中立　↓ やや下落　↓↓ 大きく下落しやすい
        </p>
        <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          💡 2026年3月現在、日銀の段階的な利上げ継続と米国の関税政策・地政学的不確実性が共存しています。
          短期債（SHV）と金（GLD）がリスクヘッジとして機能しやすい局面です。
        </p>
      </div>

      {/* Rebalancing note (footnote) */}
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-4">
        ※ このシミュレーションは設定した配分比率を維持し続ける（定期的にリバランス）ことを前提としています。
        実際の運用では年1回程度、値上がりした資産を売り値下がりした資産を買い足すことで比率を維持します。
      </p>
    </div>
  );
}
