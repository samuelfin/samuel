import { requireUser } from "@/lib/auth/session";
import { notConnected } from "@/lib/providers/registry";
import { unavailable, type DataResult } from "@/lib/market-data/types";

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  publishedAt: string;
  category: string;
  related: string[];
  sourceName: string;
  sourceUrl: string;
  author?: string;
}

export interface CorporateAction {
  id: string;
  issuer: string;
  type: "ipo" | "rights_issue" | "public_offer" | "bonus" | "dividend" | "split" | "merger_acquisition" | "other";
  announcedAt: string;
  status: "announced" | "open" | "closed" | "completed" | "withdrawn";
  sourceUrl: string;
}

export type ReportReviewState = "ai_generated" | "analyst_reviewed" | "approved";

export interface ResearchReport {
  id: string;
  title: string;
  kind: string;
  reviewState: ReportReviewState;
  publishedAt?: string;
}

export interface WorkspaceItem {
  id: string;
  name: string;
}

export async function getNews(): Promise<DataResult<NewsItem[]>> {
  await requireUser();
  return notConnected("news.items");
}

export async function getCorporateActions(): Promise<DataResult<CorporateAction[]>> {
  await requireUser();
  return notConnected("corporate_actions");
}

export async function getResearchReports(): Promise<DataResult<ResearchReport[]>> {
  await requireUser();
  return notConnected("research.reports");
}

/** Watchlists, alerts and exports need per-user tables (Phase 5 / Phase 3). */
export async function getWorkspaceItems(kind: "watchlists" | "alerts" | "reports"): Promise<DataResult<WorkspaceItem[]>> {
  await requireUser();
  const phase = kind === "reports" ? 3 : 5;
  return unavailable(`workspace.${kind}`, "not_enabled", `Account storage for ${kind} is delivered in Phase ${phase}.`);
}

export async function getAiAssistantStatus(): Promise<DataResult<never>> {
  await requireUser();
  return unavailable("ai.assistant", "not_enabled", "The assistant is enabled in Phase 4, once an approved, validated data corpus exists.");
}
