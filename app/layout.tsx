import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Mono, DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import "./styles/terminal.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
const head = Manrope({ subsets: ["latin"], variable: "--font-head", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Samuel Terminal | SFI", template: "%s · Samuel Terminal" },
  description: "Nigerian financial market intelligence by Samuel Financial Intelligence.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  colorScheme: "dark",
};

/**
 * Required by the nonce-based Content Security Policy in `proxy.ts`. A nonce only
 * exists for a request, so a prerendered page would ship script tags without one and
 * `strict-dynamic` would block them — silently breaking /reset-password and the 404
 * page. Every other route is already request-rendered because it checks the session,
 * so this gives up no static output.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-NG" className={`${sans.variable} ${mono.variable} ${head.variable}`}>
      <body>{children}</body>
    </html>
  );
}
