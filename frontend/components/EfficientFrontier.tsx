'use client';

import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ZAxis,
} from 'recharts';
import { FrontierPoint } from '@/types';

interface EfficientFrontierProps {
  portfolios: FrontierPoint[];
  frontierLine: FrontierPoint[];
  currentPoint: FrontierPoint;
}

interface TooltipEntry {
  payload: FrontierPoint & { _type?: string };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isCurrent = d._type === 'current';
  return (
    <div className={`bg-white rounded-xl shadow-lg px-3 py-2 text-xs border ${isCurrent ? 'border-orange-400' : 'border-slate-200'}`}>
      <p className={`font-semibold mb-1 ${isCurrent ? 'text-orange-600' : 'text-slate-700'}`}>
        {isCurrent ? '現在のポートフォリオ ★' : 'ポートフォリオ'}
      </p>
      <p className="text-slate-500">リスク（年率）：<span className="font-bold text-slate-800">{(d.vol * 100).toFixed(1)}%</span></p>
      <p className="text-slate-500">期待リターン（年率）：<span className="font-bold text-emerald-700">{(d.ret * 100).toFixed(1)}%</span></p>
      <p className="text-slate-500">シャープレシオ：<span className="font-bold text-blue-700">{d.sharpe.toFixed(2)}</span></p>
    </div>
  );
}

export default function EfficientFrontier({ portfolios, frontierLine, currentPoint }: EfficientFrontierProps) {
  if (!portfolios?.length || !frontierLine?.length) return null;

  // Tag each point so the tooltip can distinguish them
  const bgData = portfolios.map(p => ({ ...p, _type: 'random' }));
  const lineData = frontierLine.map(p => ({ ...p, _type: 'frontier' }));
  const currentData = [{ ...currentPoint, _type: 'current' }];

  // Axis bounds
  const allVol = portfolios.map(p => p.vol);
  const allRet = portfolios.map(p => p.ret);
  const volMin = Math.max(0, Math.min(...allVol) - 0.005);
  const volMax = Math.max(...allVol) + 0.01;
  const retMin = Math.max(0, Math.min(...allRet) - 0.005);
  const retMax = Math.max(...allRet) + 0.01;

  const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="section-title">効率的フロンティア</h3>
        <p className="text-xs text-slate-400 mt-1">
          各点は異なる資産配分のポートフォリオを表します。
          青い点の集合の上端（効率的フロンティア）が最もリターン効率の高い組み合わせです。
          <span className="text-orange-500 font-semibold">★</span> がリスク設定に対応する現在のポートフォリオです。
        </p>
      </div>

      <div className="w-full" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="vol"
              type="number"
              domain={[volMin, volMax]}
              tickFormatter={pctFmt}
              name="リスク"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              label={{ value: 'リスク（年率）', position: 'insideBottom', offset: -12, fontSize: 10, fill: '#94a3b8' }}
            />
            <YAxis
              dataKey="ret"
              type="number"
              domain={[retMin, retMax]}
              tickFormatter={pctFmt}
              name="リターン"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              label={{ value: 'リターン（年率）', angle: -90, position: 'insideLeft', offset: 12, fontSize: 10, fill: '#94a3b8' }}
            />
            <ZAxis range={[12, 12]} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />

            {/* Background: random portfolios */}
            <Scatter data={bgData} fill="#cbd5e1" opacity={0.4} />

            {/* Efficient frontier: highlighted dots */}
            <Scatter data={lineData} fill="#3b82f6" opacity={0.85} />

            {/* Current portfolio */}
            <Scatter
              data={currentData}
              fill="#f97316"
              shape={(props: React.SVGProps<SVGPolygonElement> & { cx?: number; cy?: number }) => {
                // Draw a star shape
                const { cx = 0, cy = 0 } = props;
                const r = 9;
                const ir = r * 0.45;
                const pts = Array.from({ length: 5 }, (_, i) => {
                  const outer = ((i * 72 - 90) * Math.PI) / 180;
                  const inner = (((i * 72 + 36) - 90) * Math.PI) / 180;
                  return [
                    `${cx + r * Math.cos(outer)},${cy + r * Math.sin(outer)}`,
                    `${cx + ir * Math.cos(inner)},${cy + ir * Math.sin(inner)}`,
                  ];
                }).flat().join(' ');
                return <polygon points={pts} fill="#f97316" stroke="#fff" strokeWidth={1.5} />;
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Current portfolio stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">期待リターン（年率）</p>
          <p className="font-bold text-emerald-700">{(currentPoint.ret * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">リスク（年率）</p>
          <p className="font-bold text-rose-600">{(currentPoint.vol * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-1">シャープレシオ</p>
          <p className="font-bold text-blue-700">{currentPoint.sharpe.toFixed(2)}</p>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        ※ シャープレシオはリターン÷リスクで求めた収益効率の指標です。数値が高いほど同じリスクでより効率よくリターンを獲得できていることを示します。
      </p>
    </div>
  );
}
