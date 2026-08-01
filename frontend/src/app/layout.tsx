import type { Metadata } from "next";
import "./globals.css";
import { AlertEngineMount } from "@/components/AlertEngineMount";
import { ReplayController } from "@/components/replay/ReplayController";
import { TickerFeedMount } from "@/components/market/TickerFeedMount";
import { ThemeSync } from "@/components/ThemeSync";
import { AppToaster } from "@/components/AppToaster";
import { PaperBasketMonitorMount } from "@/components/PaperBasketMonitorMount";
import { SettingsSyncMount } from "@/components/SettingsSyncMount";
import { PaperGttMonitorMount } from "@/components/PaperGttMonitorMount";

// Runs before paint to apply the persisted theme class, avoiding a flash of
// the wrong theme (the <html> element below defaults to "dark" for the
// server-rendered HTML / no-JS case). Mirrors ThemeSync.tsx for post-load
// toggling.
const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem("settings-storage");var theme="dark";if(raw){var parsed=JSON.parse(raw);var state=parsed&&parsed.state;if(state&&((state.appearance&&state.appearance.theme)||state.theme)==="light")theme="light";}var root=document.documentElement;root.classList.remove("dark","light");root.classList.add(theme);}catch(e){}})();`;

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
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <ThemeSync />
        <SettingsSyncMount />
        <AppToaster />
        <AlertEngineMount />
        <PaperBasketMonitorMount />
        <PaperGttMonitorMount />
        <ReplayController />
        <TickerFeedMount />
      </body>
    </html>
  );
}
