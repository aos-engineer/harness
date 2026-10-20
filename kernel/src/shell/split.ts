// Quote-aware splitting of a shell command line. The scanning rules live in lexer.ts and the
// unwrapping rules in leaves.ts; this module is the public surface.
import { walk } from "./leaves.ts";
import { lex } from "./lexer.ts";

/** Top-level simple commands and the operators between them (`&&`, `||`, `|`, `;`, newline, `&`). */
export function splitCommand(cmd: string): { segments: string[]; operators: string[] } {
  const { segments, operators } = lex(cmd);
  return { segments: segments.map((s) => s.text), operators };
}

/** Words of a command with quotes removed and escapes applied. Substitutions stay as written. */
export function shellWords(segment: string): string[] {
  return lex(segment).segments.flatMap((s) => s.words.map((w) => w.value));
}

/** The simple commands that actually run: env assignments stripped, `cd` dropped, `bash -c` and `eval` unwrapped. */
export function leafSegments(cmd: string): string[] {
  return walk(cmd).leaves.map((l) => l.text);
}
