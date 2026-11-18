import type { Metadata } from "next";
import { Notice, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getAiAssistantStatus } from "@/lib/data/content";

export const metadata: Metadata = { title: "AI Intelligence" };

const EXAMPLES = [
  "What happened in the Nigerian stock market today?",
  "Which banking companies recorded the highest revenue growth?",
  "Compare the financial performance of two Nigerian banks.",
  "How has inflation changed over the last twelve months?",
  "Explain the latest monetary policy decision.",
  "Compare the debt levels of selected listed companies.",
];

export default async function AiPage() {
  const status = await getAiAssistantStatus();
  const enabled = status.state === "ok";

  return (
    <>
      <PageHeader code="AI" title="AI Intelligence" description="A research assistant grounded in Samuel Terminal's validated data and approved documents — not a general-purpose chatbot." />
      <PanelGrid>
        <Panel title="Research assistant" span={8}>
          <form className="assistant" aria-describedby="assistant-status">
            <label htmlFor="assistant-q" className="sr-only">Ask a question</label>
            <textarea id="assistant-q" name="q" rows={3} disabled={!enabled} placeholder="Ask about Nigerian companies, markets or the economy…" />
            <button type="submit" className="btn btn-primary" disabled={!enabled}>Ask</button>
          </form>
          <div id="assistant-status">{status.state === "unavailable" && <Unavailable result={status} compact />}</div>
          <h3 className="subhead">Example questions</h3>
          <ul className="example-list">
            {EXAMPLES.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </Panel>
        <Panel title="How answers are produced" span={4}>
          <ol className="steps">
            <li>Retrieve relevant records and document passages from the platform.</li>
            <li>Run any arithmetic through deterministic backend calculations — never the language model.</li>
            <li>Cite the source, reporting period and as-of time for every figure.</li>
            <li>Separate reported facts from AI interpretation.</li>
            <li>Say plainly when the data needed is not available.</li>
          </ol>
          <Notice tone="caution">Information only. The assistant does not give personalised investment advice or recommendations.</Notice>
        </Panel>
      </PanelGrid>
    </>
  );
}
