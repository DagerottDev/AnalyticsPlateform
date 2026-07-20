import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { AlertEngineMount } from "@/components/AlertEngineMount";
import { ReplayController } from "@/components/replay/ReplayController";

export const metadata: Metadata = {
  title: "Option Analytics Platform",
  description:
    "Production-grade Indian options analytics with native Fyers broker support. Advanced Greeks, volatility dashboards, dealer-flow analytics, and TradingView-style UX.",
  keywords: [
    "options analytics",
    "Indian stock market",
    "NSE",
    "BSE",
    "NIFTY",
    "BANKNIFTY",
    "option chain",
    "Greeks",
    "implied volatility",
    "Fyers",
  ],
  authors: [{ name: "Option Analytics Team" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
        <AlertEngineMount />
        <ReplayController />
      </body>
    </html>
  );
}
