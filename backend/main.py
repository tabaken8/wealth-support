import json
import math
import os
import re
import asyncio
import numpy as np
import pandas as pd
import yfinance as yf
import anthropic
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

JST = timezone(timedelta(hours=9))
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# ── Supabase (optional — only used when env vars are set) ─────────────────────
try:
    from supabase import create_client, Client as SupabaseClient
    _SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    _SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    _supabase: Optional[SupabaseClient] = (
        create_client(_SUPABASE_URL, _SUPABASE_KEY)
        if _SUPABASE_URL and _SUPABASE_KEY else None
    )
except Exception as _sb_err:
    print(f"[WARN] Supabase not available: {_sb_err}")
    _supabase = None   # type: ignore


def _log_simulation_stats(req: "SimulateRequest", achievement_prob: float) -> None:
    """Fire-and-forget: insert detailed row into Supabase (JST timestamp)."""
    # SQL to create/update the table (run once in Supabase dashboard):
    # CREATE TABLE IF NOT EXISTS simulations (
    #   id                       BIGSERIAL PRIMARY KEY,
    #   created_at               TIMESTAMPTZ,          -- JST explicit
    #   risk_level               TEXT,
    #   age_bucket               INT,                  -- decade: 20, 30, 40, …
    #   years_bucket             INT,                  -- rounded to nearest 5
    #   savings_log              INT,                  -- floor(log10(savings+1))
    #   monthly_log              INT,                  -- floor(log10(monthly+1))
    #   goal_log                 INT,                  -- floor(log10(goal+1))
    #   achievement_prob         REAL,                 -- rounded to nearest 5 %
    #   has_notes                BOOLEAN,
    #   has_changes              BOOLEAN,
    #   -- Detailed fields
    #   savings_exact            REAL,
    #   monthly_exact            REAL,
    #   goal_exact               REAL,
    #   years_exact              INT,
    #   age_exact                INT,
    #   birth_year               INT,
    #   birth_month              INT,
    #   birth_day                INT,
    #   income_year1             REAL,
    #   income_year_n            REAL,
    #   capex_margin             REAL,
    #   capex_mode               TEXT,
    #   invest_style             TEXT,
    #   invest_approach          TEXT,
    #   invest_start_years_later INT,
    #   notes_text               TEXT
    # );
    if _supabase is None:
        return
    try:
        age = req.age or 0
        row = {
            "created_at":       datetime.now(JST).isoformat(),
            "risk_level":       req.risk_level,
            "age_bucket":       (age // 10) * 10,
            "years_bucket":     round(req.years / 5) * 5,
            "savings_log":      int(math.floor(math.log10(max(req.savings, 1)))),
            "monthly_log":      int(math.floor(math.log10(max(req.monthly, 1)))),
            "goal_log":         int(math.floor(math.log10(max(req.goal, 1)))),
            "achievement_prob": round(achievement_prob / 5) * 5,
            "has_notes":        bool(req.notes and req.notes.strip()),
            "has_changes":      bool(req.future_changes),
            # Detailed fields
            "savings_exact":            req.savings,
            "monthly_exact":            req.monthly,
            "goal_exact":               req.goal,
            "years_exact":              req.years,
            "age_exact":                age,
            "birth_year":               req.birth_year,
            "birth_month":              req.birth_month,
            "birth_day":                req.birth_day,
            "income_year1":             req.income_year1,
            "income_year_n":            req.income_year_n,
            "capex_margin":             req.capex_margin,
            "capex_mode":               req.capex_mode,
            "invest_style":             req.invest_style,
            "invest_approach":          req.invest_approach,
            "invest_start_years_later": req.invest_start_years_later,
            "notes_text":               (req.notes or "").strip() or None,
        }
        # Remove None values so Supabase doesn't error on missing columns
        row = {k: v for k, v in row.items() if v is not None}
        _supabase.table("simulations").insert(row).execute()
    except Exception as e:
        print(f"[WARN] Supabase insert failed: {e}")

app = FastAPI(title="Wealth Support API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Asset universe ────────────────────────────────────────────────────────────
# Core tickers (actual yfinance data fetched for historical chart & stats)
TICKERS = ["VT", "SPY", "EWJ", "AGG", "GLD", "SHV"]
# Extended tickers for custom allocation (use fallback stats when no live data)
EXTENDED_TICKERS = ["VT", "SPY", "EWJ", "AGG", "GLD", "SHV", "FNGS", "BTC-USD"]
EQUITY_TICKERS = {"VT", "SPY", "EWJ", "FNGS", "BTC-USD"}

ASSET_LABELS: Dict[str, str] = {
    "VT":     "全世界株式（オルカン類似）",
    "SPY":    "米国株式（S&P500）",
    "EWJ":    "日本株",
    "AGG":    "債券",
    "GLD":    "金",
    "SHV":    "現金・短期債",
    "FNGS":   "FANG+テック（FNGS）",
    "BTC-USD":"ビットコイン（BTC）",
}

ASSET_COLORS: Dict[str, str] = {
    "VT":     "#3b82f6",
    "SPY":    "#8b5cf6",
    "EWJ":    "#f43f5e",
    "AGG":    "#14b8a6",
    "GLD":    "#f59e0b",
    "SHV":    "#94a3b8",
    "FNGS":   "#f97316",
    "BTC-USD":"#ec4899",
}

ALLOCATIONS: Dict[str, Dict[str, float]] = {
    "low": {
        "VT": 0.10, "SPY": 0.10, "EWJ": 0.05,
        "AGG": 0.40, "GLD": 0.10, "SHV": 0.25,
    },
    "medium": {
        "VT": 0.25, "SPY": 0.25, "EWJ": 0.10,
        "AGG": 0.25, "GLD": 0.10, "SHV": 0.05,
    },
    "high": {
        "VT": 0.30, "SPY": 0.30, "EWJ": 0.15,
        "AGG": 0.15, "GLD": 0.10, "SHV": 0.00,
    },
}

# ── Custom portfolio templates (named) ────────────────────────────────────────
# Weights must sum to 1.0; all 6 tickers must be present (0.0 if unused)
PORTFOLIO_TEMPLATES: Dict[str, Dict[str, float]] = {
    "ultra_conservative": {
        "VT": 0.00, "SPY": 0.00, "EWJ": 0.00,
        "AGG": 0.30, "GLD": 0.10, "SHV": 0.60,
    },
    "income": {
        "VT": 0.05, "SPY": 0.05, "EWJ": 0.00,
        "AGG": 0.60, "GLD": 0.10, "SHV": 0.20,
    },
    "conservative_bonds": {
        "VT": 0.10, "SPY": 0.10, "EWJ": 0.05,
        "AGG": 0.55, "GLD": 0.10, "SHV": 0.10,
    },
    "balanced_conservative": {
        "VT": 0.20, "SPY": 0.20, "EWJ": 0.05,
        "AGG": 0.30, "GLD": 0.15, "SHV": 0.10,
    },
    "balanced": {
        "VT": 0.25, "SPY": 0.25, "EWJ": 0.10,
        "AGG": 0.25, "GLD": 0.10, "SHV": 0.05,
    },
    "gold_hedge": {
        "VT": 0.20, "SPY": 0.20, "EWJ": 0.05,
        "AGG": 0.20, "GLD": 0.30, "SHV": 0.05,
    },
    "balanced_growth": {
        "VT": 0.30, "SPY": 0.30, "EWJ": 0.10,
        "AGG": 0.20, "GLD": 0.10, "SHV": 0.00,
    },
    "growth": {
        "VT": 0.30, "SPY": 0.30, "EWJ": 0.15,
        "AGG": 0.15, "GLD": 0.10, "SHV": 0.00,
    },
    "aggressive_growth": {
        "VT": 0.40, "SPY": 0.40, "EWJ": 0.15,
        "AGG": 0.05, "GLD": 0.00, "SHV": 0.00,
    },
    "global_equity": {
        "VT": 0.50, "SPY": 0.30, "EWJ": 0.20,
        "AGG": 0.00, "GLD": 0.00, "SHV": 0.00,
    },
    "japan_focus": {
        "VT": 0.20, "SPY": 0.15, "EWJ": 0.45,
        "AGG": 0.10, "GLD": 0.05, "SHV": 0.05,
    },
    "bonds_heavy": {
        "VT": 0.05, "SPY": 0.05, "EWJ": 0.00,
        "AGG": 0.70, "GLD": 0.05, "SHV": 0.15,
    },
    "all_weather": {
        "VT": 0.15, "SPY": 0.15, "EWJ": 0.05,
        "AGG": 0.40, "GLD": 0.20, "SHV": 0.05,
    },
}

PORTFOLIO_TEMPLATE_LABELS: Dict[str, str] = {
    "ultra_conservative": "超保守型（現金60%・債券30%・金10%）",
    "income":             "インカム型（債券60%・金10%・株10%）",
    "conservative_bonds": "債券重視型（債券55%・株25%・金10%）",
    "balanced_conservative": "やや保守型（株45%・債券30%・金15%）",
    "balanced":           "バランス型（株60%・債券25%・金10%）",
    "gold_hedge":         "ゴールドヘッジ型（金30%・株40%・債券20%）",
    "balanced_growth":    "成長志向バランス型（株70%・債券20%・金10%）",
    "growth":             "成長型（株75%・債券15%・金10%）",
    "aggressive_growth":  "積極成長型（株95%・債券5%）",
    "global_equity":      "グローバル株式型（株100%）",
    "japan_focus":        "日本株重視型（日本株45%・オルカン20%）",
    "bonds_heavy":        "債券特化型（債券70%・現金15%・株10%）",
    "all_weather":        "オールウェザー型（債券40%・株30%・金20%）",
}

# Fallback per-asset annualised return / vol
FALLBACK_ASSET_STATS: Dict[str, tuple] = {
    "VT":     (0.090, 0.160),
    "SPY":    (0.110, 0.170),
    "EWJ":    (0.070, 0.200),
    "AGG":    (0.030, 0.050),
    "GLD":    (0.060, 0.160),
    "SHV":    (0.040, 0.005),
    "FNGS":   (0.280, 0.450),  # FANG+ ETF — historically high return, high vol
    "BTC-USD":(0.500, 0.900),  # Bitcoin — extremely high return/vol (estimated)
}

# Approximate correlations (extended, 2013-2023)
FALLBACK_CORR: Dict[str, Dict[str, float]] = {
    "VT":     {"VT": 1.00, "SPY": 0.98, "EWJ": 0.78, "AGG": -0.02, "GLD":  0.04, "SHV": -0.05, "FNGS":  0.80, "BTC-USD":  0.15},
    "SPY":    {"VT": 0.98, "SPY": 1.00, "EWJ": 0.75, "AGG": -0.03, "GLD":  0.03, "SHV": -0.04, "FNGS":  0.82, "BTC-USD":  0.15},
    "EWJ":    {"VT": 0.78, "SPY": 0.75, "EWJ": 1.00, "AGG": -0.01, "GLD":  0.02, "SHV": -0.02, "FNGS":  0.65, "BTC-USD":  0.10},
    "AGG":    {"VT":-0.02, "SPY":-0.03, "EWJ":-0.01, "AGG":  1.00, "GLD":  0.12, "SHV":  0.28, "FNGS": -0.05, "BTC-USD": -0.05},
    "GLD":    {"VT": 0.04, "SPY": 0.03, "EWJ": 0.02, "AGG":  0.12, "GLD":  1.00, "SHV":  0.04, "FNGS":  0.02, "BTC-USD":  0.20},
    "SHV":    {"VT":-0.05, "SPY":-0.04, "EWJ":-0.02, "AGG":  0.28, "GLD":  0.04, "SHV":  1.00, "FNGS": -0.03, "BTC-USD": -0.02},
    "FNGS":   {"VT": 0.80, "SPY": 0.82, "EWJ": 0.65, "AGG": -0.05, "GLD":  0.02, "SHV": -0.03, "FNGS":  1.00, "BTC-USD":  0.20},
    "BTC-USD":{"VT": 0.15, "SPY": 0.15, "EWJ": 0.10, "AGG": -0.05, "GLD":  0.20, "SHV": -0.02, "FNGS":  0.20, "BTC-USD":  1.00},
}

_etf_cache: Optional[pd.DataFrame] = None
_etf_cache_time: Optional[datetime] = None
CACHE_SECONDS = 3600


# ── Pydantic models ───────────────────────────────────────────────────────────

class FutureChange(BaseModel):
    from_month: int
    monthly_delta: float
    description: str


class LumpSumAddition(BaseModel):
    at_month: int
    amount: float
    description: str


class AssetStat(BaseModel):
    ticker: str
    label: str
    color: str
    annual_return: float
    annual_vol: float
    weight: float


class FrontierPoint(BaseModel):
    vol: float
    ret: float
    sharpe: float = 0.0


class SimulateRequest(BaseModel):
    savings: float
    monthly: float
    goal: float
    years: int
    risk_level: str
    age: Optional[int] = None
    notes: Optional[str] = None
    future_changes: Optional[List[FutureChange]] = None
    lump_sum_additions: Optional[List[LumpSumAddition]] = None
    # Custom portfolio template (overrides risk_level allocation if set)
    portfolio_name: Optional[str] = None
    # Fully custom allocation (ticker -> weight, must sum ~1.0); overrides portfolio_name
    custom_allocation: Optional[Dict[str, float]] = None
    # Extended logging fields (from frontend WizardForm)
    birth_year: Optional[int] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    income_year1: Optional[float] = None
    income_year_n: Optional[float] = None
    capex_margin: Optional[float] = None
    capex_mode: Optional[str] = None
    invest_style: Optional[str] = None
    invest_approach: Optional[str] = None
    invest_start_years_later: Optional[int] = None
    # When True, skip the Anthropic AI explanation (faster response for event-only updates)
    skip_ai: Optional[bool] = False


class SimulateResponse(BaseModel):
    percentiles: Dict[str, List[float]]
    achievement_probability: float
    allocation: Dict[str, float]
    allocation_labels: Dict[str, str]
    asset_colors: Dict[str, str]
    asset_stats: List[AssetStat]
    explanation_analysis: str
    explanation_advice: str
    expected_annual_return: float
    annual_volatility: float
    diversification_ratio: float   # DR = weighted_avg_vol / portfolio_vol
    required_monthly_50: float
    required_monthly_70: float
    nisa_median_benefit: float
    total_contributed: float
    median_terminal: float
    frontier_portfolios: List[FrontierPoint]
    frontier_line: List[FrontierPoint]
    current_portfolio_point: FrontierPoint
    # Forward sensitivity
    prob_plus_1man: float
    prob_plus_3years: float
    # Performance vs deposit
    irr_median: float          # annualised IRR of median path
    deposit_terminal: float    # 定期預金 if same contributions
    # Active portfolio name (if custom template used)
    portfolio_name: Optional[str] = None
    portfolio_label: Optional[str] = None


class ParseNotesRequest(BaseModel):
    age: int
    savings: float
    monthly: float
    goal: float
    years: int
    risk_level: str
    notes: str


class ParseNotesResponse(BaseModel):
    summary: str
    future_changes: List[FutureChange]
    lump_sum_additions: List[LumpSumAddition]


class ChatRequest(BaseModel):
    message: str
    current_params: dict          # {savings, monthly, goal, years, risk_level, age?}
    phase: str = "ask"            # "ask" | "execute"
    selected_option: Optional[str] = None
    original_question: Optional[str] = None


class ChatResponse(BaseModel):
    phase: str                    # "clarify" | "execute" | "error"
    question: Optional[str] = None
    options: Optional[List[str]] = None
    param_changes: Optional[dict] = None
    confirm_message: Optional[str] = None


# ── ETF data ──────────────────────────────────────────────────────────────────

def get_etf_data() -> Optional[pd.DataFrame]:
    global _etf_cache, _etf_cache_time
    now = datetime.now()
    if _etf_cache is not None and _etf_cache_time is not None:
        if (now - _etf_cache_time).total_seconds() < CACHE_SECONDS:
            return _etf_cache
    try:
        end = now
        start = end - timedelta(days=365 * 10)
        raw = yf.download(TICKERS, start=start, end=end, auto_adjust=True, progress=False)
        prices = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
        daily_returns = prices.pct_change().dropna()
        _etf_cache = daily_returns
        _etf_cache_time = now
        return daily_returns
    except Exception as e:
        print(f"[WARN] yfinance error: {e}")
        return None


def calc_asset_stats_list(
    daily_returns: Optional[pd.DataFrame],
    weights: Dict[str, float],
) -> List[AssetStat]:
    stats = []
    for ticker, weight in weights.items():
        if weight == 0:
            continue
        if daily_returns is not None and ticker in daily_returns.columns:
            ann_ret = float(daily_returns[ticker].mean()) * 252
            ann_vol = float(daily_returns[ticker].std()) * np.sqrt(252)
        else:
            ann_ret, ann_vol = FALLBACK_ASSET_STATS.get(ticker, (0.07, 0.15))
        stats.append(AssetStat(
            ticker=ticker,
            label=ASSET_LABELS.get(ticker, ticker),
            color=ASSET_COLORS.get(ticker, "#94a3b8"),
            annual_return=ann_ret,
            annual_vol=ann_vol,
            weight=weight,
        ))
    return stats


def calc_portfolio_stats(
    daily_returns: pd.DataFrame, weights: Dict[str, float]
) -> tuple[float, float]:
    available = [t for t in weights if t in daily_returns.columns and weights[t] > 0]
    if not available:
        return 0.07, 0.10
    ann_ret = sum(weights[t] * float(daily_returns[t].mean()) * 252 for t in available)
    cov = daily_returns[available].cov() * 252
    w = np.array([weights[t] for t in available])
    ann_vol = float(np.sqrt(w @ cov.values @ w))
    return ann_ret, ann_vol


def get_equity_weight(allocation: Dict[str, float]) -> float:
    return sum(v for k, v in allocation.items() if k in EQUITY_TICKERS)


def get_asset_cov_matrix(
    daily_returns: Optional[pd.DataFrame], tickers: List[str]
) -> np.ndarray:
    n = len(tickers)
    if daily_returns is not None and all(t in daily_returns.columns for t in tickers):
        return (daily_returns[tickers].cov() * 252).values
    cov = np.zeros((n, n))
    for i, ti in enumerate(tickers):
        for j, tj in enumerate(tickers):
            vi = FALLBACK_ASSET_STATS.get(ti, (0, 0.15))[1]
            vj = FALLBACK_ASSET_STATS.get(tj, (0, 0.15))[1]
            cov[i, j] = FALLBACK_CORR.get(ti, {}).get(tj, 0.0) * vi * vj
    return cov


def compute_efficient_frontier(
    daily_returns: Optional[pd.DataFrame],
    n_portfolios: int = 1200,
) -> tuple[List[FrontierPoint], List[FrontierPoint]]:
    tickers = TICKERS
    n = len(tickers)

    if daily_returns is not None and all(t in daily_returns.columns for t in tickers):
        mu = np.array([float(daily_returns[t].mean()) * 252 for t in tickers])
    else:
        mu = np.array([FALLBACK_ASSET_STATS[t][0] for t in tickers])

    cov = get_asset_cov_matrix(daily_returns, tickers)

    rng = np.random.default_rng(99)
    portfolios: List[FrontierPoint] = []

    for _ in range(n_portfolios):
        w = rng.dirichlet(np.ones(n))
        ret = float(w @ mu) * 100
        vol = float(np.sqrt(np.maximum(w @ cov @ w, 0))) * 100
        sharpe = ret / vol if vol > 0 else 0.0
        portfolios.append(FrontierPoint(
            vol=round(vol, 2), ret=round(ret, 2), sharpe=round(sharpe, 3)
        ))

    # Efficient frontier: for sorted vol levels, keep maximum return
    sorted_pts = sorted(portfolios, key=lambda x: x.vol)
    frontier: List[FrontierPoint] = []
    max_ret = -float("inf")
    for pt in sorted_pts:
        if pt.ret > max_ret:
            max_ret = pt.ret
            frontier.append(pt)

    return portfolios, frontier


# ── Monte Carlo ───────────────────────────────────────────────────────────────

def run_monte_carlo(
    savings: float,
    monthly: float,
    goal: float,
    years: int,
    annual_return: float,
    annual_vol: float,
    future_changes: Optional[List[FutureChange]] = None,
    lump_sum_additions: Optional[List[LumpSumAddition]] = None,
    n_sim: int = 10_000,
    equity_weight: float = 0.60,
) -> tuple[Dict[str, List[float]], float]:
    months = years * 12
    mu = annual_return / 12
    sigma = annual_vol / np.sqrt(12)

    # Jump-diffusion parameters (Merton-style)
    # Equity-like market shocks: ~once per 2-3 years at 100% equity
    lambda_jump = equity_weight * 0.030       # monthly jump probability
    jump_mean   = -0.12 * equity_weight       # portfolio impact of a shock
    jump_std    =  0.06 * equity_weight       # variability in shock size

    monthly_contribs = np.full(months, float(monthly))
    for chg in (future_changes or []):
        from_m = max(0, min(chg.from_month, months))
        monthly_contribs[from_m:] += chg.monthly_delta

    lump_sums = np.zeros(months + 1)
    for ls in (lump_sum_additions or []):
        at_m = ls.at_month
        if 0 <= at_m <= months:
            lump_sums[at_m] += ls.amount

    rng = np.random.default_rng(42)
    results = np.empty((n_sim, months + 1))
    results[:, 0] = savings + lump_sums[0]

    for m in range(1, months + 1):
        r = rng.normal(mu, sigma, n_sim)
        # Add jump component
        if lambda_jump > 0:
            jumps = (rng.uniform(0, 1, n_sim) < lambda_jump).astype(float)
            jump_sizes = rng.normal(jump_mean, jump_std, n_sim)
            r += jumps * jump_sizes
        contrib = monthly_contribs[m - 1] if m - 1 < len(monthly_contribs) else monthly
        results[:, m] = results[:, m - 1] * (1 + r) + contrib + lump_sums[m]

    percentiles: Dict[str, List[float]] = {}
    for p in [10, 25, 50, 75, 90]:
        percentiles[str(p)] = np.percentile(results, p, axis=0).tolist()

    achievement_prob = float((results[:, -1] >= goal).mean() * 100)
    return percentiles, achievement_prob


# ── Helpers ───────────────────────────────────────────────────────────────────

def calc_required_return(savings: float, monthly: float, goal: float, years: int) -> float:
    months = years * 12
    lo, hi = -0.01 / 12, 1.0 / 12
    for _ in range(200):
        mid = (lo + hi) / 2
        v = savings
        for _ in range(months):
            v = v * (1 + mid) + monthly
        if v >= goal:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2 * 12 * 100


def calc_required_monthly_for_prob(
    savings: float,
    goal: float,
    years: int,
    annual_return: float,
    annual_vol: float,
    target_prob: float,
    equity_weight: float = 0.60,
    future_changes: Optional[List[FutureChange]] = None,
    lump_sum_additions: Optional[List[LumpSumAddition]] = None,
    n_sim: int = 2_000,
) -> float:
    lo, hi = 0.0, goal / max(years * 12, 1)
    for _ in range(22):
        mid = (lo + hi) / 2
        _, prob = run_monte_carlo(
            savings, mid, goal, years, annual_return, annual_vol,
            future_changes=future_changes, lump_sum_additions=lump_sum_additions,
            n_sim=n_sim, equity_weight=equity_weight,
        )
        if prob >= target_prob:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def calc_nisa_benefit(
    savings: float,
    monthly: float,
    years: int,
    future_changes: Optional[List[FutureChange]],
    lump_sum_additions: Optional[List[LumpSumAddition]],
    percentiles: Dict[str, List[float]],
) -> tuple[float, float, float]:
    """Returns (total_contributed, median_terminal, nisa_benefit)."""
    months = years * 12
    monthly_contribs = np.full(months, float(monthly))
    for chg in (future_changes or []):
        from_m = max(0, min(chg.from_month, months))
        monthly_contribs[from_m:] += chg.monthly_delta

    total_contributed = savings + float(np.sum(np.maximum(monthly_contribs, 0)))
    for ls in (lump_sum_additions or []):
        if ls.amount > 0:
            total_contributed += ls.amount

    median_terminal = percentiles['50'][-1]
    gain = max(0.0, median_terminal - total_contributed)
    nisa_benefit = gain * 0.20315
    return total_contributed, median_terminal, nisa_benefit


DEPOSIT_ANNUAL_RATE = 0.003  # 定期預金想定年率 0.3%


def calc_deposit_terminal(
    savings: float,
    monthly: float,
    years: int,
    future_changes: Optional[List[FutureChange]],
    lump_sum_additions: Optional[List[LumpSumAddition]],
) -> float:
    """定期預金で同額を積み立てた場合の最終残高（確定値）。"""
    months = years * 12
    rate = DEPOSIT_ANNUAL_RATE / 12
    monthly_contribs = np.full(months, float(monthly))
    for chg in (future_changes or []):
        from_m = max(0, min(chg.from_month, months))
        monthly_contribs[from_m:] += chg.monthly_delta
    lump_sums = np.zeros(months + 1)
    for ls in (lump_sum_additions or []):
        if 0 <= ls.at_month <= months:
            lump_sums[ls.at_month] += ls.amount
    v = savings + lump_sums[0]
    for m in range(1, months + 1):
        contrib = monthly_contribs[m - 1] if m - 1 < len(monthly_contribs) else float(monthly)
        v = v * (1 + rate) + contrib + lump_sums[m]
    return float(v)


def calc_irr_median(
    savings: float,
    monthly: float,
    years: int,
    future_changes: Optional[List[FutureChange]],
    lump_sum_additions: Optional[List[LumpSumAddition]],
    median_terminal: float,
) -> float:
    """中央値シナリオの実効年利 (IRR) を二分探索で算出。"""
    months = years * 12
    monthly_contribs = np.full(months, float(monthly))
    for chg in (future_changes or []):
        from_m = max(0, min(chg.from_month, months))
        monthly_contribs[from_m:] += chg.monthly_delta
    lump_sums = np.zeros(months + 1)
    for ls in (lump_sum_additions or []):
        if 0 <= ls.at_month <= months:
            lump_sums[ls.at_month] += ls.amount

    def fv(r_monthly: float) -> float:
        v = savings + lump_sums[0]
        for m in range(1, months + 1):
            contrib = monthly_contribs[m - 1] if m - 1 < len(monthly_contribs) else float(monthly)
            v = v * (1 + r_monthly) + contrib + lump_sums[m]
        return v

    lo, hi = -0.01 / 12, 1.0 / 12
    for _ in range(120):
        mid = (lo + hi) / 2.0
        if fv(mid) >= median_terminal:
            hi = mid
        else:
            lo = mid
    return float((lo + hi) / 2.0 * 12)  # annualised


def _get_client() -> Optional[anthropic.Anthropic]:
    key = os.getenv("ANTHROPIC_API_KEY")
    return anthropic.Anthropic(api_key=key) if key else None


def _strip_json(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    return m.group(1).strip() if m else text


# ── LLM: parse notes ──────────────────────────────────────────────────────────

@app.post("/api/parse-notes", response_model=ParseNotesResponse)
async def parse_notes(req: ParseNotesRequest):
    if not req.notes.strip():
        return ParseNotesResponse(summary="", future_changes=[], lump_sum_additions=[])

    client = _get_client()
    if not client:
        return ParseNotesResponse(
            summary="APIキー未設定のため解析をスキップしました。",
            future_changes=[], lump_sum_additions=[],
        )

    prompt = f"""ユーザーの資産形成メモを解析し、シミュレーション用のJSONを返してください。

ユーザー情報:
- 現在年齢: {req.age}歳
- 現在の貯蓄: {req.savings:,.0f}円
- 毎月の積立: {req.monthly:,.0f}円
- 目標金額: {req.goal:,.0f}円
- 目標年数: {req.years}年

ユーザーのメモ（各行が1つの条件）:
{req.notes}

変換ルール:
- 「〇〇歳のとき」→ at_month = (〇〇 - {req.age}) × 12
- 「〇年後」→ at_month/from_month = 〇 × 12
- 収入増加・積立増加 → future_changes の monthly_delta に正の値
- 収入減少・積立減少 → future_changes の monthly_delta に負の値
- 一時的な収入（遺産・ボーナス等） → lump_sum_additions の amount に正の値
- 一時的な出費（車・教育費・結婚等） → lump_sum_additions の amount に負の値

以下のJSON形式のみで回答（余分なテキスト不要）:
{{
  "summary": "理解した内容の1〜2文の要約（日本語）",
  "future_changes": [
    {{"from_month": 月数, "monthly_delta": 円（正=増加 負=減少）, "description": "説明（日本語）"}}
  ],
  "lump_sum_additions": [
    {{"at_month": 月数, "amount": 円（正=収入 負=支出）, "description": "説明（日本語）"}}
  ]
}}"""

    try:
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(_strip_json(msg.content[0].text))
        return ParseNotesResponse(
            summary=data.get("summary", ""),
            future_changes=[FutureChange(**c) for c in data.get("future_changes", [])],
            lump_sum_additions=[LumpSumAddition(**l) for l in data.get("lump_sum_additions", [])],
        )
    except Exception as e:
        print(f"[WARN] parse-notes: {e}")
        return ParseNotesResponse(
            summary="解析に失敗しました。基本条件でシミュレーションします。",
            future_changes=[], lump_sum_additions=[],
        )


# ── LLM: explanation ──────────────────────────────────────────────────────────

def generate_explanation(
    savings, monthly, goal, years, risk_level,
    achievement_prob, annual_return, allocation,
    age=None, notes=None,
    prob_plus_1man=None,
    prob_plus_3years=None,
    diversification_ratio=None,
) -> tuple[str, str]:
    """Returns (analysis, advice) strings."""
    client = _get_client()
    required = calc_required_return(savings, monthly, goal, years)

    fallback_analysis = (
        f"このポートフォリオの期待年利は{annual_return * 100:.1f}%で、"
        f"目標達成に必要な{required:.1f}%と比べると"
        f"{'上回っており、長期的に目標を実現できる可能性が高い構成です' if annual_return * 100 >= required else f'{abs(annual_return * 100 - required):.1f}%下回っています。積立額の増額や運用期間の延長を検討してみてください'}。"
        f"株式・債券・金など値動きの異なる資産を組み合わせることで、"
        f"単一資産に比べてポートフォリオ全体の振れ幅（リスク）を抑えながら、"
        f"安定したリターンを目指す分散投資の原理を活用しています。"
        f"特に株式と債券は相関が低く、一方が下落するときにもう一方が安定しやすい傾向があります。"
        f"目標達成確率は{achievement_prob:.1f}%です。"
        f"これは1万回のシミュレーション中{achievement_prob:.0f}%が目標に到達することを意味し、"
        f"長期で積立を継続することの重要性を示しています。"
    )
    advice_parts = []
    if prob_plus_1man is not None:
        delta = prob_plus_1man - achievement_prob
        if delta >= 2:
            advice_parts.append(
                f"積立額を月1万円増やすだけで達成確率が約{delta:.0f}ポイント向上し、"
                f"{prob_plus_1man:.0f}%になる見込みです。"
                f"毎月の積立増額はNISAのつみたて投資枠（年120万円）を活用することで、"
                f"運用益に対する20.315%の税金を非課税にできます。"
                f"相場が下落しても積立を続けることで安い価格で多くの口数を購入でき、"
                f"長期的には大きなリターンにつながります（ドルコスト平均法の効果）。"
            )
    if not advice_parts and prob_plus_3years is not None:
        delta = prob_plus_3years - achievement_prob
        if delta >= 2:
            advice_parts.append(
                f"目標期間を3年延ばすと達成確率が約{delta:.0f}ポイント向上し、"
                f"{prob_plus_3years:.0f}%になる見込みです。"
                f"時間は複利運用において最大の武器です。"
                f"NISA制度を活用しながら、年1回のリバランスで資産配分を維持することで、"
                f"長期にわたって安定した資産形成が期待できます。"
            )
    fallback_advice = "".join(advice_parts) or (
        "現在の積立を継続しつつ、収入増加の機会に積立額の見直しを検討してください。"
        "NISAのつみたて投資枠（年120万円）と成長投資枠（年240万円）を最大限活用することで、"
        "運用益に対する税負担を大幅に軽減できます。"
        "また年1回程度のリバランスで値上がりした資産を売り、値下がりした資産を買い増すことで"
        "リスク管理と長期リターンの向上を両立できます。"
    )

    if not client:
        return fallback_analysis, fallback_advice

    risk_labels = {"low": "低リスク", "medium": "中リスク", "high": "高リスク"}
    age_line = f"- 年齢: {age}歳\n" if age else ""
    notes_line = f"- 備考: {notes}\n" if notes else ""
    alloc_str = "、".join(f"{ASSET_LABELS[t].split('（')[0]} {int(w*100)}%" for t, w in allocation.items() if w > 0)
    gap = annual_return * 100 - required
    gap_comment = "期待リターンが必要利回りを上回り有利" if gap >= 0 else f"期待リターンが必要利回りを{abs(gap):.1f}%下回っている"

    sensitivity_lines = ""
    if prob_plus_1man is not None:
        sensitivity_lines += f"- 積立+1万円/月にした場合の達成確率：{prob_plus_1man:.1f}%\n"
    if prob_plus_3years is not None:
        sensitivity_lines += f"- 目標期間+3年にした場合の達成確率：{prob_plus_3years:.1f}%\n"

    dr_line = ""
    if diversification_ratio is not None:
        dr_score = (
            "非常に優秀" if diversification_ratio >= 1.40 else
            "優秀"       if diversification_ratio >= 1.25 else
            "良好"       if diversification_ratio >= 1.15 else
            "普通"       if diversification_ratio >= 1.05 else
            "低い"
        )
        dr_line = f"- 分散比率（Diversification Ratio）：{diversification_ratio:.2f}（評価：{dr_score}）\n"

    # ── Situational advice instruction ──────────────────────────────────────────
    is_long_term = years >= 15  # 15年以上を長期とみなす
    is_on_track = achievement_prob >= 70 and gap >= 0
    is_low_risk = risk_level == "low"

    # 長期投資 × 低〜中リスク → テック比率を上げたカスタムPFを提案
    custom_pf_hint = ""
    if is_long_term and is_low_risk:
        custom_pf_hint = (
            "【カスタムPF提案】運用期間が15年以上ある場合、低リスクコースでは機会損失になる可能性があります。"
            "例えば「S&P500 40%・オルカン 30%・FANG+テック 15%・米国債 10%・金 5%」のような"
            "テック比率を高めたカスタムポートフォリオを検討する価値があります。"
            "長期なら短期の値動きよりも複利成長が優先されるため、若干リスクを上げてもトータルリターンで有利になる傾向があります。"
            "「カスタム」モードで自分なりの配分を試してみることをおすすめします。"
        )
    elif is_long_term and risk_level == "medium":
        custom_pf_hint = (
            "【ワンポイント】15年以上の長期運用なら、テック（FANG+）や米国株（S&P500）の比率を"
            "少し引き上げたカスタム配分を試す価値があります。「カスタム」モードで自分好みの比率を設定してみましょう。"
        )

    if is_on_track:
        advice_instruction = (
            "【重要な指示】このポートフォリオは達成確率・期待リターンともに目標を十分に満たしています。"
            "アドバイスとして「現状の設定で十分です」と率直かつ端的に伝えること（100〜160字）。"
            "余分な改善提案は不要。維持のために大切なこと（定期リバランス・積立継続・NISA活用）を1〜2点だけ簡潔に添えること。"
            "絶対に「さらに積立を増やす」「期間を延ばす」などの不要な改善を勧めないこと。"
            + (f" {custom_pf_hint}" if custom_pf_hint else "")
        )
    elif achievement_prob >= 50:
        advice_instruction = (
            "達成確率はまずまずですが、あと一歩改善できます（180〜240字）。"
            "感度分析の数値がある場合、最も効果的な1つの改善アクション（積立増額 or 期間延長）だけを具体的数値付きで提案すること。"
            "NISA活用とリバランスの重要性を1文ずつ添える。欲張って複数の提案を詰め込まないこと。"
            + (f" {custom_pf_hint}" if custom_pf_hint else "")
        )
    else:
        advice_instruction = (
            "達成確率が低く、改善が必要な状況です（200〜260字）。"
            "感度分析の数値を必ず引用しながら、最も効果的な改善アクション（積立増額 or 期間延長）を具体的に提案すること。"
            "NISA活用による節税効果にも触れ、長期継続の重要性を伝えること。"
            + (f" {custom_pf_hint}" if custom_pf_hint else "")
        )

    prompt = f"""あなたはCFAチャーターホルダー資格を持つ資産運用アドバイザーです。
以下の情報をもとに、JSON形式で2つのテキストを生成してください。

ユーザー情報：
{age_line}- 現在の貯蓄額：{savings:,.0f}円 / 毎月の積立：{monthly:,.0f}円
- 目標：{goal:,.0f}円を{years}年で達成
- リスク許容度：{risk_labels.get(risk_level, risk_level)} / ポートフォリオ：{alloc_str}
{notes_line}シミュレーション結果：
- 目標達成確率：{achievement_prob:.1f}%（必要年利 {required:.1f}% / 期待年利 {annual_return * 100:.1f}%、{gap_comment}）
{sensitivity_lines}{dr_line}
JSON形式のみで回答（余分なテキスト不要）:
{{
  "analysis": "以下の要素を全て含む、自然で読みやすい分析文（400〜500字）：①このポートフォリオの分散投資の特性——株式・債券・金・現金など値動きの異なる資産クラスを組み合わせることで、単一資産に比べてリスク（標準偏差）が低減される原理をわかりやすく説明する。分散比率（Diversification Ratio）の値と評価も必ず言及すること②必要利回りと期待リターンの比較——数値を具体的に示し、ギャップがある場合はその意味を率直に評価する③目標達成確率の解釈——{achievement_prob:.1f}%という数字が現実的に何を意味するか、楽観・悲観シナリオを含めて説明する④長期複利効果についての言及——積立期間{years}年における複利の恩恵を具体的な感覚で伝える",
  "advice": "{advice_instruction}"
}}"""

    try:
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(_strip_json(msg.content[0].text))
        return data.get("analysis", fallback_analysis), data.get("advice", fallback_advice)
    except Exception as e:
        print(f"[WARN] explanation: {e}")
        return fallback_analysis, fallback_advice


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Chat: AI advisor chat (ask → clarify → execute) ───────────────────────────

@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    client = _get_client()
    if not client:
        return ChatResponse(
            phase="error",
            confirm_message="APIキーが設定されていないため、AI機能を使用できません。",
        )

    p = req.current_params
    risk = p.get("risk_level", "medium")
    risk_label = {"low": "低リスク", "medium": "中リスク", "high": "高リスク"}.get(risk, "中リスク")
    alloc = ALLOCATIONS.get(risk, ALLOCATIONS["medium"])
    alloc_str = "、".join(
        f"{ASSET_LABELS[t].split('（')[0]} {int(w * 100)}%"
        for t, w in alloc.items() if w > 0
    )

    # Build portfolio template summary for the chat prompt
    template_list = "\n".join(
        f'  - "{k}": {v}'
        for k, v in PORTFOLIO_TEMPLATE_LABELS.items()
    )

    # ── Phase 1: ask → generate clarifying question + closed options ──────────
    if req.phase == "ask":
        prompt = f"""あなたは資産運用アドバイザーです。
ユーザーから以下のリクエストを受けました。実行前に**最も重要な1点だけ**確認し、**3〜5つ**の具体的な選択肢を提示してください。

現在の設定:
- リスク: {risk_label}
- 貯蓄額: {p.get('savings', 0):,.0f}円
- 積立額: {p.get('monthly', 0):,.0f}円/月
- 目標: {p.get('goal', 0):,.0f}円
- 期間: {p.get('years', 10)}年
- アロケーション: {alloc_str}

ユーザーのリクエスト: 「{req.message}」

変更可能なパラメータ:
A) portfolio_name（ポートフォリオテンプレート名）— 以下から選択:
{template_list}

B) risk_level（標準リスク設定）: "low" / "medium" / "high"

C) 数値パラメータ:
  - monthly: 毎月の積立額（円）
  - savings: 現在の貯蓄額（円）
  - goal: 目標金額（円）
  - years: 運用期間（年、1〜50）

ユーザーの意図を汲み取り、**ポートフォリオテンプレートの変更を含む**多様な選択肢を提示してください。
選択肢は異なる方向性・度合いで3〜5つ提示し、各選択肢には変更内容と期待される効果を簡潔に含めてください。

JSON形式のみで回答（余分なテキスト不要）:
{{
  "question": "確認の質問（40字以内、丁寧に）",
  "options": ["選択肢A（具体的な変更内容を含む）", "選択肢B", "選択肢C", "選択肢D"]
}}"""
        try:
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            data = json.loads(_strip_json(msg.content[0].text))
            return ChatResponse(
                phase="clarify",
                question=data.get("question", "どのように変更しますか？"),
                options=data.get("options", ["現在の設定を維持する"]),
            )
        except Exception as e:
            print(f"[WARN] chat/ask: {e}")
            return ChatResponse(
                phase="error",
                confirm_message="AI処理中にエラーが発生しました。しばらく待ってから再試行してください。",
            )

    # ── Phase 2: execute → resolve chosen option to param changes ─────────────
    if req.phase == "execute":
        prompt = f"""あなたは資産運用アドバイザーです。
ユーザーのリクエストと選択に基づいて、変更すべきパラメータを特定してください。

元のリクエスト: 「{req.message}」
確認した質問: 「{req.original_question}」
ユーザーが選んだ選択肢: 「{req.selected_option}」

現在のパラメータ:
- risk_level: {p.get('risk_level', 'medium')}
- savings: {p.get('savings', 0):,.0f}
- monthly: {p.get('monthly', 0):,.0f}
- goal: {p.get('goal', 0):,.0f}
- years: {p.get('years', 10)}

変更するパラメータのみJSONに含めてください（変わらないものは含めない）。
ポートフォリオの変更: portfolio_name に以下のいずれかを指定（テンプレートを使う場合）:
{template_list}

portfolio_name を指定した場合、risk_level は参照用として "low"/"medium"/"high" のいずれかも指定してください。
portfolio_name を指定しない場合は risk_level のみで変更可能。
金額は円単位の整数、years は 1〜50 の整数。

JSON形式のみで回答（余分なテキスト不要）:
{{
  "changes": {{
    "portfolio_name": "gold_hedge",
    "risk_level": "medium",
    "monthly": 50000,
    "savings": 1000000,
    "goal": 10000000,
    "years": 15
  }},
  "confirm_message": "変更内容の簡潔な確認メッセージ（日本語、1〜2文、具体的な内容を含む）"
}}"""
        try:
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            data = json.loads(_strip_json(msg.content[0].text))
            return ChatResponse(
                phase="execute",
                param_changes=data.get("changes", {}),
                confirm_message=data.get("confirm_message", "設定を更新しました。"),
            )
        except Exception as e:
            print(f"[WARN] chat/execute: {e}")
            return ChatResponse(
                phase="error",
                confirm_message="AI処理中にエラーが発生しました。しばらく待ってから再試行してください。",
            )

    return ChatResponse(phase="error", confirm_message="不正なリクエストです。")


@app.post("/api/simulate", response_model=SimulateResponse)
async def simulate(req: SimulateRequest):
    if req.risk_level not in ALLOCATIONS:
        raise HTTPException(status_code=400, detail="risk_level must be low/medium/high")
    if req.years < 1 or req.years > 50:
        raise HTTPException(status_code=400, detail="years must be 1-50")

    # Priority: custom_allocation > portfolio_name > risk_level preset
    if req.custom_allocation and sum(req.custom_allocation.values()) > 0.01:
        raw = req.custom_allocation
        total = sum(raw.values())
        allocation = {k: v / total for k, v in raw.items() if v > 0}
    elif req.portfolio_name and req.portfolio_name in PORTFOLIO_TEMPLATES:
        allocation = PORTFOLIO_TEMPLATES[req.portfolio_name]
    else:
        allocation = ALLOCATIONS[req.risk_level]
    daily_returns = get_etf_data()
    eq_weight = get_equity_weight(allocation)

    if daily_returns is not None:
        annual_return, annual_vol = calc_portfolio_stats(daily_returns, allocation)
        if not (-0.5 < annual_return < 1.0) or not (0 < annual_vol < 2.0):
            annual_return = sum(w * FALLBACK_ASSET_STATS[t][0] for t, w in allocation.items())
            annual_vol = sum(w * FALLBACK_ASSET_STATS[t][1] for t, w in allocation.items())
    else:
        annual_return = sum(w * FALLBACK_ASSET_STATS[t][0] for t, w in allocation.items())
        annual_vol = sum(w * FALLBACK_ASSET_STATS[t][1] for t, w in allocation.items())

    asset_stats = calc_asset_stats_list(daily_returns, allocation)

    percentiles, achievement_prob = run_monte_carlo(
        req.savings, req.monthly, req.goal, req.years,
        annual_return, annual_vol,
        future_changes=req.future_changes,
        lump_sum_additions=req.lump_sum_additions,
        equity_weight=eq_weight,
    )

    # Sensitivity simulations (quick, fewer paths)
    _, prob_plus_1man = run_monte_carlo(
        req.savings, req.monthly + 10_000, req.goal, req.years,
        annual_return, annual_vol,
        future_changes=req.future_changes,
        lump_sum_additions=req.lump_sum_additions,
        n_sim=2_000, equity_weight=eq_weight,
    )
    _, prob_plus_3years = run_monte_carlo(
        req.savings, req.monthly, req.goal, req.years + 3,
        annual_return, annual_vol,
        future_changes=req.future_changes,
        lump_sum_additions=req.lump_sum_additions,
        n_sim=2_000, equity_weight=eq_weight,
    )

    # Reverse calculation: required monthly for 50% and 70% probability
    req_monthly_50 = calc_required_monthly_for_prob(
        req.savings, req.goal, req.years, annual_return, annual_vol,
        target_prob=50.0, equity_weight=eq_weight,
        future_changes=req.future_changes, lump_sum_additions=req.lump_sum_additions,
    )
    req_monthly_70 = calc_required_monthly_for_prob(
        req.savings, req.goal, req.years, annual_return, annual_vol,
        target_prob=70.0, equity_weight=eq_weight,
        future_changes=req.future_changes, lump_sum_additions=req.lump_sum_additions,
    )

    # NISA benefit
    total_contributed, median_terminal, nisa_benefit = calc_nisa_benefit(
        req.savings, req.monthly, req.years,
        req.future_changes, req.lump_sum_additions, percentiles,
    )

    # Efficient frontier
    frontier_portfolios, frontier_line = compute_efficient_frontier(daily_returns)
    current_pt = FrontierPoint(
        vol=round(annual_vol * 100, 2),
        ret=round(annual_return * 100, 2),
        sharpe=round(annual_return / annual_vol if annual_vol > 0 else 0, 3),
    )

    # Diversification Ratio: DR = weighted_avg_individual_vol / portfolio_vol
    weighted_avg_vol = sum(s.weight * s.annual_vol for s in asset_stats)
    diversification_ratio = round(weighted_avg_vol / annual_vol, 3) if annual_vol > 0 else 1.0

    # AI explanation (skip when only events/contributions changed — faster UX)
    if req.skip_ai:
        analysis, advice = "", ""
    else:
        analysis, advice = generate_explanation(
            req.savings, req.monthly, req.goal, req.years,
            req.risk_level, achievement_prob, annual_return, allocation,
            age=req.age, notes=req.notes,
            prob_plus_1man=prob_plus_1man,
            prob_plus_3years=prob_plus_3years,
            diversification_ratio=diversification_ratio,
        )

    # IRR + deposit terminal
    dep_terminal = calc_deposit_terminal(
        req.savings, req.monthly, req.years,
        req.future_changes, req.lump_sum_additions,
    )
    irr = calc_irr_median(
        req.savings, req.monthly, req.years,
        req.future_changes, req.lump_sum_additions,
        median_terminal,
    )

    # Anonymised stats (fire-and-forget, never blocks the response)
    asyncio.get_event_loop().run_in_executor(
        None, _log_simulation_stats, req, achievement_prob
    )

    return SimulateResponse(
        percentiles=percentiles,
        achievement_probability=achievement_prob,
        allocation=allocation,
        allocation_labels=ASSET_LABELS,
        asset_colors=ASSET_COLORS,
        asset_stats=asset_stats,
        explanation_analysis=analysis,
        explanation_advice=advice,
        expected_annual_return=annual_return,
        annual_volatility=annual_vol,
        diversification_ratio=diversification_ratio,
        required_monthly_50=req_monthly_50,
        required_monthly_70=req_monthly_70,
        nisa_median_benefit=nisa_benefit,
        total_contributed=total_contributed,
        median_terminal=median_terminal,
        frontier_portfolios=frontier_portfolios,
        frontier_line=frontier_line,
        current_portfolio_point=current_pt,
        prob_plus_1man=prob_plus_1man,
        prob_plus_3years=prob_plus_3years,
        irr_median=irr,
        deposit_terminal=dep_terminal,
        portfolio_name=req.portfolio_name if req.portfolio_name in PORTFOLIO_TEMPLATES else None,
        portfolio_label=PORTFOLIO_TEMPLATE_LABELS.get(req.portfolio_name, None) if req.portfolio_name else None,
    )


# ── Asset history (normalized returns, 10Y monthly) ───────────────────────────

_asset_history_cache: dict = {"data": None, "expires": datetime.min}

# ── Share / Save endpoints ─────────────────────────────────────────────────────

class ShareSaveRequest(BaseModel):
    request_data: dict
    result_data: dict

class ShareSaveResponse(BaseModel):
    share_id: str


@app.post("/api/share", response_model=ShareSaveResponse)
async def save_simulation(body: ShareSaveRequest):
    """Persist a simulation result to Supabase and return a UUID."""
    if _supabase is None:
        raise HTTPException(status_code=503, detail="Storage not configured (SUPABASE_URL / SUPABASE_KEY missing)")
    try:
        resp = (
            _supabase.table("shared_simulations")
            .insert({
                "created_at":   datetime.now(JST).isoformat(),
                "request_data": body.request_data,
                "result_data":  body.result_data,
            })
            .execute()
        )
        share_id = resp.data[0]["id"]
        return ShareSaveResponse(share_id=share_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save simulation: {exc}")


@app.get("/api/share/{share_id}")
async def load_simulation(share_id: str):
    """Retrieve a saved simulation by UUID."""
    if _supabase is None:
        raise HTTPException(status_code=503, detail="Storage not configured (SUPABASE_URL / SUPABASE_KEY missing)")
    try:
        resp = (
            _supabase.table("shared_simulations")
            .select("request_data, result_data")
            .eq("id", share_id)
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Simulation not found")
        return resp.data
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Simulation not found: {exc}")


@app.get("/api/asset-history")
async def asset_history():
    """Return 10-year monthly normalized returns (start = 1.0) for all 6 tickers."""
    global _asset_history_cache
    now = datetime.now()

    # Serve from cache if still valid (1-hour TTL)
    if _asset_history_cache["data"] is not None and now < _asset_history_cache["expires"]:
        return _asset_history_cache["data"]

    tickers = ["VT", "SPY", "EWJ", "AGG", "GLD", "SHV"]
    end_dt   = now
    start_dt = end_dt - timedelta(days=365 * 10 + 45)   # +45-day buffer

    try:
        raw = yf.download(
            tickers,
            start=start_dt.strftime("%Y-%m-%d"),
            end=end_dt.strftime("%Y-%m-%d"),
            interval="1mo",
            auto_adjust=True,
            progress=False,
        )

        # yfinance returns MultiIndex columns when multiple tickers
        if isinstance(raw.columns, pd.MultiIndex):
            closes = raw["Close"]
        else:
            closes = raw[["Close"]] if "Close" in raw.columns else raw

        # Ensure all tickers are present
        for t in tickers:
            if t not in closes.columns:
                closes[t] = float("nan")

        closes = closes[tickers]
        closes = closes.dropna(how="all")
        closes = closes.ffill().bfill()

        # Normalize: divide every column by its first non-NaN value
        first_valid = closes.bfill().iloc[0]
        normalized  = closes / first_valid

        result = []
        for dt, row in normalized.iterrows():
            point: dict = {"date": pd.Timestamp(dt).strftime("%Y-%m")}
            for t in tickers:
                v = row[t]
                point[t] = round(float(v), 4) if pd.notna(v) else None
            result.append(point)

        _asset_history_cache["data"]    = result
        _asset_history_cache["expires"] = now + timedelta(hours=1)
        return result

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"asset-history fetch failed: {exc}")
