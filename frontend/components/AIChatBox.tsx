'use client';

import { useState, KeyboardEvent } from 'react';

export interface ChatParamChanges {
  risk_level?: 'low' | 'medium' | 'high';
  portfolio_name?: string;   // custom template name (overrides risk_level allocation)
  savings?: number;
  monthly?: number;
  goal?: number;
  years?: number;
}

interface AIChatBoxProps {
  currentParams: {
    savings: number;
    monthly: number;
    goal: number;
    years: number;
    risk_level: string;
    age?: number;
  };
  onApplyChanges: (changes: ChatParamChanges) => void;
  apiUrl: string;
}

type ChatStep =
  | { step: 'idle' }
  | { step: 'clarifying'; userMessage: string; question: string; options: string[] }
  | { step: 'confirmed'; confirmText: string }
  | { step: 'error'; errorText: string };

const QUICK_PROMPTS = [
  { icon: '🏅', text: '金の比率を上げて' },
  { icon: '🛡️', text: 'リスクを下げたい' },
  { icon: '📈', text: '積立を1万増やす' },
  { icon: '⏳', text: '期間を3年延ばす' },
];

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function AIChatBox({ currentParams, onApplyChanges, apiUrl }: AIChatBoxProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<ChatStep>({ step: 'idle' });

  // ── Phase 1: send user message → get clarifying question ──────────────────
  const sendAsk = async (msg: string) => {
    if (!msg.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg.trim(),
          current_params: currentParams,
          phase: 'ask',
        }),
      });
      const data = await res.json();
      if (data.phase === 'clarify') {
        setStep({
          step: 'clarifying',
          userMessage: msg.trim(),
          question: data.question,
          options: data.options ?? [],
        });
      } else {
        setStep({ step: 'error', errorText: data.confirm_message || 'エラーが発生しました。' });
      }
    } catch {
      setStep({ step: 'error', errorText: '通信エラーが発生しました。' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Phase 2: user picks an option → execute and apply changes ─────────────
  const selectOption = async (option: string) => {
    if (step.step !== 'clarifying' || isLoading) return;
    const { userMessage, question } = step;
    setIsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          current_params: currentParams,
          phase: 'execute',
          selected_option: option,
          original_question: question,
        }),
      });
      const data = await res.json();
      if (data.phase === 'execute' && data.param_changes) {
        onApplyChanges(data.param_changes as ChatParamChanges);
        setStep({ step: 'confirmed', confirmText: data.confirm_message || '設定を更新しました。' });
        setInputText('');
        setTimeout(() => setStep({ step: 'idle' }), 3500);
      } else {
        setStep({ step: 'error', errorText: data.confirm_message || 'エラーが発生しました。' });
      }
    } catch {
      setStep({ step: 'error', errorText: '通信エラーが発生しました。' });
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => { setStep({ step: 'idle' }); setInputText(''); };

  return (
    <div className="card border border-violet-100 bg-gradient-to-br from-violet-50 to-purple-50">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shadow-sm flex-shrink-0">
          AI
        </div>
        <div>
          <p className="text-sm font-semibold text-violet-700">AIアドバイザーに相談する</p>
          <p className="text-xs text-slate-400">ポートフォリオや積立条件を自由に相談できます</p>
        </div>
      </div>

      {/* ── Idle: text input ── */}
      {step.step === 'idle' && (
        <div className="space-y-2">
          {/* Quick prompt chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map(q => (
              <button
                key={q.text}
                onClick={() => setInputText(q.text)}
                className="text-xs bg-white border border-violet-200 text-violet-600 rounded-full px-2.5 py-1 hover:bg-violet-100 transition-colors"
              >
                {q.icon} {q.text}
              </button>
            ))}
          </div>

          {/* Textarea + submit */}
          <div className="flex gap-2 items-end">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk(inputText); }
              }}
              placeholder="例: 金の比率を上げてください / リスクを少し下げたい"
              rows={2}
              disabled={isLoading}
              className="flex-1 text-sm rounded-xl border border-violet-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none disabled:opacity-50 placeholder:text-slate-300"
            />
            <button
              onClick={() => sendAsk(inputText)}
              disabled={!inputText.trim() || isLoading}
              className="flex-shrink-0 bg-violet-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center gap-1.5 self-end"
            >
              {isLoading ? <><Spinner /><span>処理中</span></> : '送信'}
            </button>
          </div>
        </div>
      )}

      {/* ── Clarifying: chat bubble + option buttons ── */}
      {step.step === 'clarifying' && (
        <div className="space-y-3 animate-slide-up">
          {/* User bubble */}
          <div className="flex justify-end">
            <div className="bg-violet-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2 max-w-[90%] leading-relaxed">
              {step.userMessage}
            </div>
          </div>

          {/* AI question bubble */}
          <div className="flex gap-2 items-start">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 mt-0.5">
              AI
            </div>
            <div className="bg-white rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm text-slate-700 border border-violet-100 flex-1 leading-relaxed">
              {step.question}
            </div>
          </div>

          {/* Closed option buttons */}
          <div className="pl-8 space-y-1.5">
            {step.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => selectOption(opt)}
                disabled={isLoading}
                className="w-full text-left text-sm bg-white border-2 border-violet-200 hover:border-violet-500 hover:bg-violet-50 rounded-xl px-3 py-2.5 transition-all disabled:opacity-40 text-slate-700 leading-snug"
              >
                <span className="text-violet-400 font-bold mr-1.5">{['A', 'B', 'C', 'D'][i]}.</span>
                {opt}
              </button>
            ))}

            {isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 py-1 pl-2">
                <Spinner />
                <span>AI処理中…</span>
              </div>
            )}
          </div>

          {!isLoading && (
            <div className="flex justify-end pt-1">
              <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 underline">
                キャンセル
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Confirmed ── */}
      {step.step === 'confirmed' && (
        <div className="flex items-start gap-2 bg-emerald-50 rounded-xl px-4 py-3 text-sm text-emerald-700 animate-slide-up">
          <span className="text-lg flex-shrink-0">✅</span>
          <span className="leading-relaxed">{step.confirmText}　再シミュレーション中…</span>
        </div>
      )}

      {/* ── Error ── */}
      {step.step === 'error' && (
        <div className="space-y-2 animate-slide-up">
          <div className="flex items-start gap-2 bg-rose-50 rounded-xl px-4 py-3 text-sm text-rose-600">
            <span className="flex-shrink-0">⚠️</span>
            <span>{step.errorText}</span>
          </div>
          <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 underline">
            もう一度試す
          </button>
        </div>
      )}
    </div>
  );
}
