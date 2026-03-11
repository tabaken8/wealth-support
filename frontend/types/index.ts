export type RiskLevel = 'low' | 'medium' | 'high';

export interface FutureChange {
  from_month: number;
  monthly_delta: number;
  description: string;
}

export interface LumpSumAddition {
  at_month: number;
  amount: number;   // negative = expense
  description: string;
}

export interface ParsedNotes {
  summary: string;
  future_changes: FutureChange[];
  lump_sum_additions: LumpSumAddition[];
}

export interface AssetStat {
  ticker: string;
  label: string;
  color: string;
  annual_return: number;
  annual_vol: number;
  weight: number;
}

export interface SimulateRequest {
  savings: number;
  monthly: number;
  goal: number;
  years: number;
  risk_level: RiskLevel;
  age?: number;
  notes?: string;
  future_changes?: FutureChange[];
  lump_sum_additions?: LumpSumAddition[];
  // Custom portfolio template (overrides risk_level allocation)
  portfolio_name?: string;
  // Free-form custom allocation (ticker → weight 0..1), takes priority over portfolio_name
  custom_allocation?: Record<string, number>;
  // Extended logging fields (sent to backend for Supabase)
  birth_year?: number;
  birth_month?: number;
  birth_day?: number;
  income_year1?: number;
  income_year_n?: number;
  capex_margin?: number;
  capex_mode?: string;
  invest_style?: string;
  invest_approach?: string;
  invest_start_years_later?: number;
}

export interface FrontierPoint {
  vol: number;
  ret: number;
  sharpe: number;
}

export interface SimulateResponse {
  percentiles: {
    '10': number[];
    '25': number[];
    '50': number[];
    '75': number[];
    '90': number[];
  };
  achievement_probability: number;
  allocation: Record<string, number>;
  allocation_labels: Record<string, string>;
  asset_colors: Record<string, string>;
  asset_stats: AssetStat[];
  explanation_analysis: string;
  explanation_advice: string;
  expected_annual_return: number;
  annual_volatility: number;
  diversification_ratio: number;
  // Reverse calculation
  required_monthly_50: number;
  required_monthly_70: number;
  // NISA benefit
  nisa_median_benefit: number;
  total_contributed: number;
  median_terminal: number;
  // Efficient frontier
  frontier_portfolios: FrontierPoint[];
  frontier_line: FrontierPoint[];
  current_portfolio_point: FrontierPoint;
  // Forward sensitivity
  prob_plus_1man: number;
  prob_plus_3years: number;
  // Performance vs deposit
  irr_median: number;
  deposit_terminal: number;
  // Active portfolio template
  portfolio_name?: string | null;
  portfolio_label?: string | null;
}
