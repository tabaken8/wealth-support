'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import WizardForm from '@/components/WizardForm';
import ResultDashboard from '@/components/ResultDashboard';
import SimulatingLoader from '@/components/SimulatingLoader';
import { SimulateRequest, SimulateResponse, RiskLevel } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const VALID_RISKS: RiskLevel[] = ['low', 'medium', 'high'];

// ── URL helpers ───────────────────────────────────────────────────────────────

function parseUrlParams(): SimulateRequest | null {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const savings = p.get('savings');
  const monthly = p.get('monthly');
  const goal    = p.get('goal');
  const years   = p.get('years');
  const risk    = p.get('risk_level') as RiskLevel | null;
  if (!savings || !monthly || !goal || !years || !risk) return null;
  return {
    age:        parseInt(p.get('age') ?? '25', 10),
    savings:    parseInt(savings, 10),
    monthly:    parseInt(monthly, 10),
    goal:       parseInt(goal, 10),
    years:      parseInt(years, 10),
    risk_level: VALID_RISKS.includes(risk) ? risk : 'medium',
  };
}

function pushSimulateState(data: SimulateRequest) {
  const p = new URLSearchParams({
    age:        String(data.age ?? 25),
    savings:    String(data.savings),
    monthly:    String(data.monthly),
    goal:       String(data.goal),
    years:      String(data.years),
    risk_level: data.risk_level,
  });
  window.history.pushState({ simulate: true }, '', `?${p.toString()}`);
}

function pushResetState() {
  window.history.pushState({ simulate: false }, '', window.location.pathname);
}

// ── Inner component ───────────────────────────────────────────────────────────

function HomeContent() {
  const [result,    setResult]    = useState<SimulateResponse | null>(null);
  const [formData,  setFormData]  = useState<SimulateRequest  | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Keep a stable ref so the popstate listener always calls the latest version
  const handleSubmitRef = useRef<(data: SimulateRequest) => Promise<void>>(async () => {});

  const handleSubmit = async (data: SimulateRequest) => {
    setIsLoading(true);
    setError(null);
    setFormData(data);
    try {
      const res = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `サーバーエラー (${res.status})`);
      }
      const json: SimulateResponse = await res.json();
      setResult(json);
      // Push params to history so back-button restores this simulation
      pushSimulateState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  // Keep ref current every render
  handleSubmitRef.current = handleSubmit;

  const handleReset = () => {
    setResult(null);
    setError(null);
    // Push a clean URL into history (so forward → back restores the simulation URL)
    pushResetState();
  };

  // On mount: simulate if URL already has params (direct shared link)
  useEffect(() => {
    const req = parseUrlParams();
    if (req) handleSubmitRef.current(req);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // popstate: fires when user presses browser back / forward
  useEffect(() => {
    const onPopState = () => {
      const req = parseUrlParams();
      if (req) {
        // URL has simulate params → re-run simulation
        handleSubmitRef.current(req);
      } else {
        // URL is clean → show wizard
        setResult(null);
        setError(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []); // stable — uses ref

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg">
        <div className={`${result ? 'max-w-7xl' : 'max-w-4xl'} mx-auto px-4 py-4 flex items-center gap-3`}>
          <span className="text-2xl select-none">💰</span>
          <div>
            <h1 className="text-xl md:text-2xl font-bold leading-tight">Wealth Support</h1>
            <p className="text-blue-200 text-xs md:text-sm">ゴールベース資産形成アドバイザー</p>
          </div>
          {result && (
            <button
              onClick={handleReset}
              className="ml-auto text-sm text-blue-100 hover:text-white underline underline-offset-2 transition-colors"
            >
              ← やり直す
            </button>
          )}
        </div>
      </header>

      <main className={`${result ? 'max-w-7xl' : 'max-w-4xl'} mx-auto px-4 py-8`}>
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-fade-in">
            ⚠️ {error}
          </div>
        )}

        {isLoading && !result && <SimulatingLoader />}

        {!result && !isLoading ? (
          <WizardForm onSubmit={handleSubmit} isLoading={isLoading} />
        ) : result ? (
          <ResultDashboard result={result} formData={formData!} onReset={handleReset} />
        ) : null}
      </main>

      <footer className="text-center text-slate-400 text-xs py-8">
        ※ シミュレーションは過去データに基づく試算です。将来の運用成果を保証するものではありません。
      </footer>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-400">
          <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
