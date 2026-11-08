/**
 * Demo data for mock mode (NEXT_PUBLIC_USE_MOCKS=true).
 * Prices and report text are SAMPLE DATA for UI development only, not market facts.
 */
import type { Holding, Report, TriggerSpec } from "../types";

export const SEED_HOLDINGS: Holding[] = [
  { id: "h-cash-1", asset_class: "cash", name: "High-yield savings", ticker: null, quantity: null, cost_basis: null, principal: 32400, apy: 0.04, start_date: null, maturity_date: null },
  { id: "h-cash-2", asset_class: "cash", name: "Checking", ticker: null, quantity: null, cost_basis: null, principal: 6150, apy: null, start_date: null, maturity_date: null },
  { id: "h-cd-1", asset_class: "cd", name: "12-month CD", ticker: null, quantity: null, cost_basis: null, principal: 25000, apy: 0.046, start_date: "2026-03-02", maturity_date: "2027-03-02" },
  { id: "h-cd-2", asset_class: "cd", name: "6-month CD", ticker: null, quantity: null, cost_basis: null, principal: 15000, apy: 0.043, start_date: "2026-07-15", maturity_date: "2027-01-15" },
  { id: "h-voo", asset_class: "stock", name: "Vanguard S&P 500 ETF", ticker: "VOO", quantity: 180, cost_basis: 73800, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h-nvda", asset_class: "stock", name: "NVIDIA", ticker: "NVDA", quantity: 120, cost_basis: 5760, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h-msft", asset_class: "stock", name: "Microsoft", ticker: "MSFT", quantity: 40, cost_basis: 12400, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h-aapl", asset_class: "stock", name: "Apple", ticker: "AAPL", quantity: 60, cost_basis: 10920, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h-tsla", asset_class: "stock", name: "Tesla", ticker: "TSLA", quantity: 40, cost_basis: 8200, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h-amzn", asset_class: "stock", name: "Amazon", ticker: "AMZN", quantity: 50, cost_basis: 7000, principal: null, apy: null, start_date: null, maturity_date: null },
];

/** Sample previous-close prices. */
export const SEED_PRICES: Record<string, number> = {
  VOO: 552.4,
  NVDA: 138.2,
  MSFT: 412.6,
  AAPL: 228.1,
  TSLA: 251.9,
  AMZN: 198.3,
};

export const SEED_TRIGGER: TriggerSpec = {
  name: "NVIDIA – earnings and guidance",
  entity: "NVIDIA",
  tickers: ["NVDA"],
  hypothesis: "Earnings surprises or guidance changes move NVDA",
  signals: [
    { source: "news", query: "NVIDIA earnings OR guidance OR outlook", detector: "text_event", poll: "5m" },
    { source: "price", query: "NVDA", detector: "daily_change", params: { threshold: 0.03 }, poll: "1m" },
  ],
  critical_capable: false,
  cooldown: { normal: "6h", critical: "1h" },
};

/** The four proposals the mock agent offers for the Tesla question. */
export const TESLA_PROPOSALS: TriggerSpec[] = [
  {
    name: "Tesla – leadership & legal",
    entity: "Tesla",
    tickers: ["TSLA"],
    hypothesis: "Investigations or legal action involving Tesla or Elon Musk move TSLA",
    signals: [
      { source: "news", query: "Tesla OR Musk investigation OR lawsuit OR SEC", detector: "text_event", poll: "5m" },
      { source: "sec_edgar", query: "TSLA 8-K", detector: "text_event", poll: "15m" },
      { source: "price", query: "TSLA", detector: "daily_change", params: { threshold: 0.03 }, poll: "1m" },
    ],
    critical_capable: true,
    cooldown: { normal: "6h", critical: "1h" },
  },
  {
    name: "Tesla – EV policy",
    entity: "Tesla",
    tickers: ["TSLA"],
    hypothesis: "Changes to federal or state EV incentives and tariffs move TSLA",
    signals: [
      { source: "news", query: "EV tax credit OR EV incentive OR auto tariff", detector: "text_event", poll: "5m" },
      { source: "federal_register", query: "electric vehicle", detector: "text_event", poll: "60m" },
    ],
    critical_capable: false,
    cooldown: { normal: "6h", critical: "1h" },
  },
  {
    name: "Tesla – safety recalls",
    entity: "Tesla",
    tickers: ["TSLA"],
    hypothesis: "NHTSA recalls and defect investigations move TSLA",
    signals: [{ source: "nhtsa", query: "Tesla", detector: "text_event", poll: "60m" }],
    critical_capable: false,
    cooldown: { normal: "6h", critical: "1h" },
  },
  {
    name: "Tesla – price moves",
    entity: "Tesla",
    tickers: ["TSLA"],
    hypothesis: "Large daily moves in TSLA need a look",
    signals: [{ source: "price", query: "TSLA", detector: "daily_change", params: { threshold: 0.03 }, poll: "1m" }],
    critical_capable: true,
    cooldown: { normal: "6h", critical: "1h" },
  },
];

const SAMPLE = "Sample source (mock mode)";

export const SEED_REPORTS: Report[] = [
  {
    id: "r-ev-policy",
    title: "EV policy: what incentives and tariffs mean for automakers",
    topic: "EV policy",
    summary:
      "How federal and state EV incentives, subsidies and tariffs shape demand, pricing and margins for US automakers, and which signals to watch.",
    tickers: ["TSLA", "GM", "F"],
    created_at: "2026-11-05T15:10:00Z",
    body_md: `## Summary

EV demand in the US is sensitive to purchase incentives. When subsidies or tax credits change, buyers pull purchases forward or wait, and automakers adjust prices to protect volume.

## Key findings

- **Incentives move timing more than totals.** Changes to EV subsidies tend to shift when people buy rather than whether they buy.
- **Tariffs raise input costs.** Duties on batteries and parts pressure margins for brands that import components.
- **State programs matter.** Several states run their own rebates, so national headlines miss part of the picture.

## Drivers and risks

| Bull case | Bear case |
| --- | --- |
| New or extended incentives lift demand | Incentives end and demand drops |
| Battery costs keep falling | Tariffs raise battery and parts costs |

## Affected tickers and your exposure

TSLA is about 4% of your net worth in this sample portfolio.

## Suggested triggers

- Federal Register rules mentioning electric vehicles
- News on EV tax credits, subsidies or tariffs`,
    sources: [
      { url: "https://example.com/ev-incentives-overview", publisher: SAMPLE, published_at: "2026-10-28", excerpt: "Overview of how purchase incentives affect EV demand timing." },
      { url: "https://example.com/battery-tariffs", publisher: SAMPLE, published_at: "2026-10-30", excerpt: "Tariffs on imported batteries and parts raise input costs." },
    ],
    similar: [],
  },
  {
    id: "r-us-auto",
    title: "The US auto market: who is gaining share",
    topic: "US auto market",
    summary:
      "Where US auto sales are shifting between gas, hybrid and electric vehicles, which brands are gaining share, and what that means for related stocks.",
    tickers: ["TSLA", "TM", "GM"],
    created_at: "2026-11-02T18:40:00Z",
    body_md: `## Summary

US buyers are spreading across gas, hybrid and electric options. Hybrids have gained ground with buyers who want better mileage without charging, while EV adoption depends heavily on price and charging access.

## Key findings

- **Hybrids are a middle path.** Many buyers choose hybrids as a step between gas and fully electric cars.
- **Price cuts drive EV volume.** EV makers that lowered prices kept volume up, at some cost to margins.
- **Charging access shapes adoption.** Regions with dense charging networks adopt EVs faster.

## Affected tickers and your exposure

TSLA is about 4% of your net worth in this sample portfolio.

## Suggested triggers

- Quarterly delivery reports from major automakers
- Large daily moves in TSLA`,
    sources: [
      { url: "https://example.com/auto-sales-mix", publisher: SAMPLE, published_at: "2026-10-25", excerpt: "Sales mix across gas, hybrid and electric vehicles." },
    ],
    similar: [],
  },
];
