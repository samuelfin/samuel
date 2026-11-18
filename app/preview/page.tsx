import { headers } from "next/headers";
import { redirect } from "next/navigation";
import TerminalDashboard from "@/components/terminal-dashboard";

export default async function PreviewPage() {
  // Make this route request-rendered so it is available only during local development.
  await headers();
  if (process.env.NODE_ENV !== "development") redirect("/login");

  return <TerminalDashboard userName="Local preview" isPlatformAdmin={false} isPreview />;
}
