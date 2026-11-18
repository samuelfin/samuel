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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-NG" className={`${sans.variable} ${mono.variable} ${head.variable}`}>
      <body>{children}</body>
    </html>
  );
}
