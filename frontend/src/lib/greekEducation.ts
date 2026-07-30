import type { GreekMetric } from "@/lib/strikeGreekAnalysis";

export const CORE_GREEKS_REFERENCE = "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks";
export const GREEKS_GLOSSARY_REFERENCE = "https://www.optionseducation.org/ReferenceLibrary/optionsglossary";

export const GREEK_EDUCATION: Record<GreekMetric, { label: string; description: string }> = {
  delta: { label: "Delta", description: "Estimated change in an option's value for a one-unit move in the underlying. Calls usually have positive Delta; puts usually have negative Delta." },
  gamma: { label: "Gamma", description: "How quickly Delta changes as the underlying moves. Gamma is technically second-order, but is commonly watched with the core Greeks." },
  theta: { label: "Theta", description: "Estimated sensitivity of option value to the passage of time. Time decay generally accelerates closer to expiry." },
  vega: { label: "Vega", description: "Estimated sensitivity of option value to a change in implied volatility, commonly quoted for a one-percentage-point IV move." },
  rho: { label: "Rho", description: "Estimated sensitivity of option value to a change in interest rates. It is normally less material for very short-dated options." },
  vanna: { label: "Vanna", description: "How Delta changes when implied volatility changes; it links directional and volatility exposure." },
  vomma: { label: "Vomma", description: "How Vega changes when implied volatility changes; it describes the convexity of volatility exposure." },
  charm: { label: "Charm", description: "How Delta changes as time passes, often called Delta decay." },
  speed: { label: "Speed", description: "How Gamma changes as the underlying price changes." },
  color: { label: "Color", description: "How Gamma changes as time passes; it helps describe how convexity evolves toward expiry." },
  zomma: { label: "Zomma", description: "How Gamma changes as implied volatility changes." },
  ultima: { label: "Ultima", description: "How Vomma changes as implied volatility changes; it is a higher-order volatility sensitivity." },
};
