import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * recordAcceptedAction turns a run's accepted suggestions into a statement.
 * These tests hold it to what it must not do: record anything undecided or
 * rejected, infer audited/consolidated, or drop the ai_assisted label.
 */

const rpc = vi.fn();
let batchRow: Record<string, unknown> | null;
let suggestionRows: Record<string, unknown>[];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/financials", () => ({
  assignmentFor: vi.fn(),
  listTemplateAssignments: vi.fn(),
  listTemplateLines: vi.fn(),
}));
vi.mock("@/lib/adapters/extraction", () => ({ getExtractor: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/staff", () => ({
  requireStaffRole: vi.fn(async () => ({ userId: "79ce88a1-c175-47fa-ad36-e04b3e1d9509", roles: [], isPlatformAdmin: true, name: "t" })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => (table === "figure_suggestions" ? Promise.resolve({ data: suggestionRows, error: null }) : chain),
        maybeSingle: () =>
          Promise.resolve({
            data: table === "figure_suggestion_batches" ? batchRow : { published_at: "2025-03-31" },
            error: null,
          }),
      };
      return chain;
    },
    rpc,
  }),
}));

const BATCH = "661c3218-cbfa-4c67-902f-62cece43ef99";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) =>
    name === "record_statement" ? { data: "11111111-1111-1111-1111-111111111111", error: null } : { data: null, error: null },
  );
  batchRow = {
    id: BATCH,
    company_id: "80c5b13b-a8b1-4310-94e7-ad8ad7ab0a4b",
    document_id: "7b2395dc-91c4-402d-99ec-f368b891f956",
    statement_type: "balance_sheet",
    period_type: "FY",
    period_start: "2024-01-01",
    period_end: "2024-12-31",
    currency: "NGN",
    magnitude: "thousands",
    status: "open",
  };
  suggestionRows = [
    { line_item: "total_assets", value_reported: 100, presentation: "plain", magnitude: null, source_page: 127, status: "accepted" },
    { line_item: "total_liabilities", value_reported: 80, presentation: "plain", magnitude: null, source_page: 127, status: "rejected" },
  ];
});

const { recordAcceptedAction } = await import("./actions");
const ok = { batchId: BATCH, audited: "yes", consolidated: "yes" };

describe("recordAcceptedAction", () => {
  it("records only accepted figures, marked AI-assisted, then closes the run against the statement", async () => {
    const result = await recordAcceptedAction({}, form(ok));
    expect(result.error).toBeUndefined();

    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("record_statement");
    expect(args.p_lines).toEqual([
      expect.objectContaining({ line_item: "total_assets", value_reported: 100, source_page: 127, ai_assisted: true }),
    ]);
    expect(args.p_audited).toBe(true);
    expect(args.p_consolidated).toBe(true);
    expect(args.p_published_at).toBe("2025-03-31");

    expect(rpc.mock.calls[1][0]).toBe("close_suggestion_batch");
    expect(rpc.mock.calls[1][1].p_statement_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("refuses while any suggestion is still undecided", async () => {
    suggestionRows.push({ line_item: "customer_deposits", value_reported: 5, presentation: "plain", magnitude: null, source_page: 127, status: "pending" });
    const result = await recordAcceptedAction({}, form(ok));
    expect(result.error).toMatch(/still to check/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when nothing was accepted", async () => {
    suggestionRows = suggestionRows.map((s) => ({ ...s, status: "rejected" }));
    const result = await recordAcceptedAction({}, form(ok));
    expect(result.error).toMatch(/nothing to record/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not infer audited or consolidated", async () => {
    expect((await recordAcceptedAction({}, form({ batchId: BATCH, consolidated: "yes" }))).error).toMatch(/audited/);
    expect((await recordAcceptedAction({}, form({ batchId: BATCH, audited: "yes" }))).error).toMatch(/consolidated/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a closed run", async () => {
    batchRow = { ...batchRow, status: "closed" };
    expect((await recordAcceptedAction({}, form(ok))).error).toMatch(/already closed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes on the database's refusal and does not close the run", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: "23514", message: "A required figure is missing: Revenue" } }));
    const result = await recordAcceptedAction({}, form(ok));
    expect(result.error).toBe("A required figure is missing: Revenue");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
