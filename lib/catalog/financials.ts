/**
 * Company financial line items and ratio definitions.
 * Ratios are computed by deterministic backend functions (Phase 3) and only from
 * inputs that share a reporting period, as each `periodRule` requires.
 */

export const STATEMENT_LINE_ITEMS = [
  { id: "revenue", label: "Revenue", statement: "Income statement" },
  { id: "cost_of_sales", label: "Cost of sales", statement: "Income statement" },
  { id: "gross_profit", label: "Gross profit", statement: "Income statement" },
  { id: "operating_profit", label: "Operating profit", statement: "Income statement" },
  { id: "profit_before_tax", label: "Profit before tax", statement: "Income statement" },
  { id: "profit_after_tax", label: "Profit after tax", statement: "Income statement" },
  { id: "eps_basic", label: "Earnings per share (basic)", statement: "Income statement" },
  { id: "total_assets", label: "Total assets", statement: "Balance sheet" },
  { id: "total_liabilities", label: "Total liabilities", statement: "Balance sheet" },
  { id: "shareholders_equity", label: "Shareholders' equity", statement: "Balance sheet" },
  { id: "operating_cash_flow", label: "Operating cash flow", statement: "Cash flow" },
  { id: "capex", label: "Capital expenditure", statement: "Cash flow" },
  { id: "dividends_paid", label: "Dividends paid", statement: "Cash flow" },
] as const;

export interface RatioDefinition {
  id: string;
  name: string;
  formula: string;
  periodRule: string;
}

export const RATIOS: readonly RatioDefinition[] = [
  { id: "pe", name: "Price-to-earnings", formula: "Share price ÷ basic EPS", periodRule: "Price as of a stated date; EPS from the latest full financial year or trailing four quarters, labelled." },
  { id: "pb", name: "Price-to-book", formula: "Market capitalisation ÷ shareholders' equity", periodRule: "Equity from the latest balance sheet; price as of a stated date." },
  { id: "dividend_yield", name: "Dividend yield", formula: "Dividends per share declared for the year ÷ share price", periodRule: "Dividends for one financial year; price as of a stated date." },
  { id: "roe", name: "Return on equity", formula: "Profit after tax ÷ average shareholders' equity", periodRule: "Profit and opening/closing equity from the same financial year." },
  { id: "roa", name: "Return on assets", formula: "Profit after tax ÷ average total assets", periodRule: "Profit and opening/closing assets from the same financial year." },
  { id: "debt_to_equity", name: "Debt-to-equity", formula: "Total borrowings ÷ shareholders' equity", periodRule: "Both from the same balance-sheet date." },
  { id: "current_ratio", name: "Current ratio", formula: "Current assets ÷ current liabilities", periodRule: "Both from the same balance-sheet date. Not meaningful for banks." },
  { id: "net_margin", name: "Net profit margin", formula: "Profit after tax ÷ revenue", periodRule: "Both from the same reporting period." },
  { id: "revenue_growth", name: "Revenue growth", formula: "(Revenue ÷ revenue for the comparable prior period) − 1", periodRule: "Equal-length periods: FY vs prior FY, or a quarter vs the same quarter a year earlier." },
];
