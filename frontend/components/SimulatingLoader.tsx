'use client';

import { useEffect, useState } from 'react';

// ── TradingView mini widget — iframe/srcdoc approach ──────────────────────────
// Dynamic script injection is unreliable in Next.js production builds.
// Instead, embed each widget in a self-contained srcdoc iframe so TradingView's
// script runs in a clean HTML context with proper document.currentScript support.

interface MiniChartProps {
  symbol: string;
  label: string;
  color: string;
}

function TradingViewMiniChart({ symbol, label, color }: MiniChartProps) {
  const config = JSON.stringify({
    symbol,
    width: '100%',
    height: 115,
    locale: 'ja',
    dateRange: '1D',
    colorTheme: 'light',
    isTransparent: false,
    autosize: false,
    largeChartUrl: '',
    noTimeScale: false,
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>html,body{margin:0;padding:0;overflow:hidden;background:#f8fafc}</style>
</head>
<body>
  <div class="tradingview-widget-container" style="height:115px;width:100%">
    <div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>
    <script type="text/javascript"
      src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js"
      async>${config}</script>
  </div>
</body>
</html>`;

  return (
    <div className="rounded-xl overflow-hidden bg-white border border-slate-200">
      {/* Label bar */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-0.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      </div>
      {/* iframe embeds TradingView in an isolated HTML context */}
      <iframe
        srcDoc={html}
        style={{ width: '100%', height: '115px', border: 'none', display: 'block' }}
        scrolling="no"
        title={label}
      />
    </div>
  );
}

// ── Animated loading messages ──────────────────────────────────────────────────

const MESSAGES = [
  '📊 モンテカルロシミュレーション実行中…',
  '📈 1,000通りの未来を計算しています…',
  '⚖️ 効率的フロンティアを構築中…',
  '🎲 ランダムウォークを10,000歩…',
  '💡 AIアドバイスを生成中…',
  '🔢 IRRと達成確率を算出中…',
  '🏅 分散比率（Diversification Ratio）を計算中…',
  '🌐 マクロシナリオを分析中…',
];

// ── Assets to show ─────────────────────────────────────────────────────────────

// 計10銘柄: LCM(2, 5) = 10 なので、
// モバイル (grid-cols-2: 2列×5行) もデスクトップ (grid-cols-5: 5列×2行) もピッタリ
const ASSETS: { symbol: string; label: string; color: string }[] = [
  { symbol: 'NASDAQ:NVDA',  label: 'NVIDIA (NVDA)',      color: '#22c55e' },
  { symbol: 'NASDAQ:AAPL',  label: 'Apple (AAPL)',       color: '#94a3b8' },
  { symbol: 'NASDAQ:MSFT',  label: 'Microsoft (MSFT)',   color: '#3b82f6' },
  { symbol: 'NASDAQ:META',  label: 'Meta (META)',        color: '#8b5cf6' },
  { symbol: 'NASDAQ:GOOGL', label: 'Google (GOOGL)',     color: '#f59e0b' },
  { symbol: 'NASDAQ:AMZN',  label: 'Amazon (AMZN)',      color: '#f97316' },
  { symbol: 'NASDAQ:TSLA',  label: 'Tesla (TSLA)',       color: '#ef4444' },
  { symbol: 'AMEX:SPY',     label: 'S&P500 (SPY)',       color: '#6366f1' },
  { symbol: 'FX:USDJPY',    label: 'ドル円 (USD/JPY)',   color: '#ec4899' },
  { symbol: 'AMEX:GLD',     label: '金・ゴールド (GLD)', color: '#d97706' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function SimulatingLoader() {
  const [msgIdx, setMsgIdx] = useState(0);
  const [dots,   setDots]   = useState('');

  // Cycle through messages every 2.2s
  useEffect(() => {
    const id = setInterval(() => {
      setMsgIdx(i => (i + 1) % MESSAGES.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  // Animate trailing dots
  useEffect(() => {
    const id = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4 animate-fade-in py-2">

      {/* Progress / status — TOP (visible immediately) */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          {/* Pulsing orb */}
          <span className="relative flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-blue-500" />
          </span>
          <h2 className="text-xl font-bold text-slate-700">シミュレーション中</h2>
          <span className="relative flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" style={{ animationDelay: '0.5s' }} />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-indigo-500" />
          </span>
        </div>

        {/* Animated message */}
        <p className="text-sm text-slate-500 h-5 transition-all duration-500">
          {MESSAGES[msgIdx].replace('…', dots)}
        </p>

        {/* Progress bar (indeterminate) */}
        <div className="max-w-xs mx-auto h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 rounded-full animate-[slide_1.8s_ease-in-out_infinite]" />
        </div>
      </div>

      {/* TradingView mini charts grid — BOTTOM (loads async) */}
      <div>
        <p className="text-xs text-slate-400 text-center mb-2">
          📡 待っている間に… リアルタイム市況
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {ASSETS.map(a => (
            <TradingViewMiniChart
              key={a.symbol}
              symbol={a.symbol}
              label={a.label}
              color={a.color}
            />
          ))}
        </div>
      </div>

      <p className="text-center text-[10px] text-slate-300">
        市況データは TradingView 提供。投資判断の根拠とはなりません。
      </p>
    </div>
  );
}
