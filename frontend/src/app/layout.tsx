import type { Metadata } from "next";
import "./globals.css";
import { AlertEngineMount } from "@/components/AlertEngineMount";
import { ReplayController } from "@/components/replay/ReplayController";
import { TickerFeedMount } from "@/components/market/TickerFeedMount";
import { ThemeSync } from "@/components/ThemeSync";
import { AppToaster } from "@/components/AppToaster";

// Runs before paint to apply the persisted theme class, avoiding a flash of
// the wrong theme (the <html> element below defaults to "dark" for the
// server-rendered HTML / no-JS case). Mirrors ThemeSync.tsx for post-load
// toggling.
const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem("settings-storage");var theme="dark";if(raw){var parsed=JSON.parse(raw);if(parsed&&parsed.state&&parsed.state.theme==="light")theme="light";}var root=document.documentElement;root.classList.remove("dark","light");root.classList.add(theme);}catch(e){}})();`;

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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
        <ThemeSync />
        <AppToaster />
        <AlertEngineMount />
        <ReplayController />
        <TickerFeedMount />
      </body>
    </html>
  );
}
