const BAR_WIDTH = 16;

function color(text: string, code: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function renderTextGauge(
  label: string,
  value: number,
  min: number,
  max: number,
  unit: string,
): string {
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const colored = value < min ? color(bar, "32") : value >= max * 0.9 ? color(bar, "31") : color(bar, "33");
  const valueStr = unit === "$" ? `$${value.toFixed(2)}` : `${value.toFixed(1)} ${unit}`;
  const minStr = unit === "$" ? `$${min}` : `${min}`;
  const maxStr = unit === "$" ? `$${max}` : `${max}`;
  return `  ${label.padEnd(7)} ${valueStr.padEnd(10)} [${colored}] (min: ${minStr}, max: ${maxStr})`;
}

export interface RoundSummary {
  round: number;
  maxRounds: number;
  minutes: number;
  dollars: number;
}

export function renderRoundOneLiner(s: RoundSummary): string {
  return color(`[Round ${s.round}/${s.maxRounds} · ${s.minutes.toFixed(1)}min · $${s.dollars.toFixed(2)}]`, "90");
}
