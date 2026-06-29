// Assembles the work-product comment posted to Paperclip, and provides the
// canned message for the failed path.

import type { PassResult } from "./types";

export interface WorkProduct {
  /** The comment text posted to the issue (provenance header + package). */
  comment: string;
}

/**
 * Build the work-product comment from a completed pass. Prepends a short
 * provenance header so the human reviewer has the run metadata at a glance, then
 * the assembled package.
 */
export function buildWorkProduct(result: PassResult): WorkProduct {
  const pkg = (result.package ?? "").trim();

  const header = [
    "Work product (in review — not published).",
    `Cost: $${result.costUsd.toFixed(4)} | rounds: ${result.rounds} | ${result.elapsedMinutes.toFixed(1)} min.`,
  ].join("\n");

  return {
    comment: `${header}\n\n---\n\n${pkg}`,
  };
}

/** Comment when the AOS pass failed (issue goes blocked, liveness failed). */
export function failedPassComment(reason: string): string {
  return [
    "Failed: the worker pass did not complete.",
    "",
    `Reason: ${reason}`,
    "",
    "No package was produced and nothing was published. Owner: operator.",
    "Action needed: review the Harness logs for this run, then re-run.",
  ].join("\n");
}
