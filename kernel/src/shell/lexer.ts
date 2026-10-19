// A small bash lexer: just enough grammar to find where one command ends and the next begins, and what
// each word's value is once quotes are removed. It is not a parser. It never expands variables and never
// runs anything. Nothing splits inside quotes, $(...), backticks, ${...}, <(...), or heredoc bodies,
// because a guard that splits inside them would mistake data (a commit message, a heredoc) for commands.
// Substitution bodies are still recorded per word, since bash runs them; heredoc bodies are dropped.
// Not exported from the package barrel: split.ts and match.ts are the public surface.

export interface Word {
  value: string; // quotes removed, escapes applied; substitutions kept as written
  raw: string; // as written
  at: number; // offset of raw within its segment's text
  subs: string[]; // bodies of the $(...), `...`, <(...), and >(...) substitutions in this word
}

export interface Segment {
  text: string; // trimmed source of one simple command, comments dropped
  words: Word[];
}

export interface Lexed {
  segments: Segment[];
  operators: string[];
  trailing: number; // how many operators come after the last segment
}

// The closer of the opaque span being scanned: null at top level.
type Close = null | ")" | "}" | "`";

interface Heredoc {
  delim: string;
  stripTabs: boolean;
}

interface ScanResult extends Lexed {
  end: number; // index just past the span's closer, or the input length
  closed: boolean;
  subs: string[]; // every substitution body found at this level
}

interface Span {
  end: number;
  subs: string[];
}

const BLANK = new Set([" ", "\t"]);
const DELIM_STOP = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
// Nesting past this depth is read as literal text. Honest commands nest a few levels; the cap keeps a
// deliberately deep or unclosed input from overflowing the stack, which is smaller under Node than Bun.
const MAX_NESTING = 64;

export function lex(input: string): Lexed {
  // Surrounding whitespace is not a separator: a command typed with a trailing newline is still one command.
  const { segments, operators, trailing } = scan(input.trim(), 0, null, 0);
  return { segments, operators, trailing };
}

/** Scan from `start` until `close` (unquoted, at depth zero) or the end of input. */
function scan(src: string, start: number, close: Close, level: number): ScanResult {
  const segments: Segment[] = [];
  const operators: string[] = [];
  const subs: string[] = [];
  // Inside ${...} the text is parameter-expansion syntax, not shell grammar: `#` there is not a comment.
  const grammar = close !== "}";
  const opener = close === ")" ? "(" : close === "}" ? "{" : null;
  let depth = 0;
  let pending: Heredoc[] = [];
  let words: Word[] = [];
  let cur: { start: number; value: string; subs: string[] } | null = null;
  let segStart = start;
  let commentStart: number | null = null;
  let opsAtLastSegment = 0;
  let i = start;

  const begin = (at: number) => {
    if (cur === null) cur = { start: at, value: "", subs: [] };
    return cur;
  };
  const addSubs = (found: string[]) => {
    begin(i).subs.push(...found);
    subs.push(...found);
  };
  const endWord = (at: number) => {
    if (cur !== null) words.push({ value: cur.value, raw: src.slice(cur.start, at), at: cur.start, subs: cur.subs });
    cur = null;
  };
  const endSegment = (at: number) => {
    endWord(at);
    const raw = src.slice(segStart, commentStart ?? at);
    const text = raw.trim();
    if (text !== "") {
      const textStart = segStart + (raw.length - raw.trimStart().length);
      segments.push({ text, words: words.map((w) => ({ ...w, at: w.at - textStart })) });
      opsAtLastSegment = operators.length;
    }
    words = [];
    commentStart = null;
  };
  const operator = (op: string, at: number) => {
    endSegment(at);
    operators.push(op);
    segStart = at + op.length;
  };
  const result = (end: number, closed: boolean): ScanResult => ({
    segments, operators, trailing: operators.length - opsAtLastSegment, end, closed, subs,
  });

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (close !== null && c === close && depth === 0) {
      endSegment(i);
      return result(i + 1, true);
    }
    if (opener !== null && c === opener) depth++;
    if (close === ")" && c === ")") depth--;
    if (close === "}" && c === "}") depth--;

    if (c === "\\") {
      if (next === "\n") {
        i += 2; // line continuation: joins lines, starts nothing
        continue;
      }
      begin(i).value += next ?? "\\";
      i += next === undefined ? 1 : 2;
      continue;
    }
    if (c === "'") {
      const w = begin(i);
      const j = src.indexOf("'", i + 1);
      const stop = j < 0 ? src.length : j;
      w.value += src.slice(i + 1, stop);
      i = j < 0 ? src.length : j + 1;
      continue;
    }
    if (c === '"') {
      const r = readDouble(src, i + 1, level);
      begin(i).value += r.value;
      addSubs(r.subs);
      i = r.end;
      continue;
    }
    const span = spanAt(src, i, level);
    if (span !== null) {
      begin(i).value += src.slice(i, span.end);
      addSubs(span.subs);
      i = span.end;
      continue;
    }

    if (!grammar) {
      begin(i).value += c;
      i++;
      continue;
    }

    if (BLANK.has(c)) {
      endWord(i);
      i++;
      continue;
    }
    if (c === "#" && cur === null) {
      // A comment runs to the end of the line; quotes inside it (an apostrophe in prose) open nothing.
      commentStart ??= i;
      const j = src.indexOf("\n", i);
      i = j < 0 ? src.length : j;
      continue;
    }
    if (c === "\n") {
      operator("\n", i);
      i++;
      if (pending.length > 0) {
        i = skipHeredocBodies(src, i, pending);
        pending = [];
        segStart = i;
      }
      continue;
    }
    if (c === ";") {
      operator(";", i);
      i++;
      continue;
    }
    if (c === "|") {
      const op = next === "|" ? "||" : "|";
      operator(op, i);
      i += op.length;
      continue;
    }
    if (c === "&") {
      if (next === "&") {
        operator("&&", i);
        i += 2;
        continue;
      }
      // `&>`, `>&` and `<&` are redirections, part of the word, not a background operator.
      const prev = src[i - 1];
      if (next !== ">" && prev !== ">" && prev !== "<") {
        operator("&", i);
        i++;
        continue;
      }
    }
    if (c === "(" || c === ")") {
      // Parentheses are metacharacters: a subshell's `(` and `)` are words of their own, never part of one.
      endWord(i);
      words.push({ value: c, raw: c, at: i, subs: [] });
      i++;
      continue;
    }
    if (c === "<" && next === "<" && src[i + 2] !== "<" && src[i - 1] !== "<") {
      // Heredoc. The delimiter is the next word; the body starts after the current line ends.
      begin(i).value += "<<";
      i += 2;
      const stripTabs = src[i] === "-";
      if (stripTabs) {
        cur!.value += "-";
        i++;
      }
      if (BLANK.has(src[i] ?? "")) {
        endWord(i);
        while (BLANK.has(src[i] ?? "")) i++;
      }
      const d = readDelimiter(src, i);
      if (d.end > i) {
        begin(i).value += d.delim;
        pending.push({ delim: d.delim, stripTabs });
        i = d.end;
      }
      continue;
    }

    begin(i).value += c;
    i++;
  }

  endSegment(src.length);
  return result(src.length, false);
}

/** If an opaque span opens at `i`, return the index just past its closer and the substitutions inside it. */
function spanAt(src: string, i: number, level: number): Span | null {
  if (level >= MAX_NESTING) return null;
  const c = src[i];
  const next = src[i + 1];
  if ((c === "$" || c === "<" || c === ">") && next === "(") return substitution(src, i + 2, ")", level);
  if (c === "`") return substitution(src, i + 1, "`", level);
  if (c === "$" && next === "{") {
    // A parameter expansion is not code itself, but a substitution inside its default value is.
    const r = scan(src, i + 2, "}", level + 1);
    return { end: r.end, subs: r.subs };
  }
  return null;
}

/** A command, process, or backtick substitution: its body is code, recorded for the caller to classify. */
function substitution(src: string, bodyStart: number, close: ")" | "`", level: number): Span {
  const r = scan(src, bodyStart, close, level + 1);
  return { end: r.end, subs: [src.slice(bodyStart, r.closed ? r.end - 1 : r.end)] };
}

/** Read a double-quoted string starting after its opening quote. */
function readDouble(src: string, start: number, level: number): { value: string; end: number; subs: string[] } {
  let value = "";
  const subs: string[] = [];
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') return { value, end: i + 1, subs };
    if (c === "\\") {
      const next = src[i + 1];
      // Inside double quotes a backslash escapes only these; before anything else it stays literal.
      if (next === "$" || next === "`" || next === '"' || next === "\\") {
        value += next;
        i += 2;
      } else if (next === "\n") {
        i += 2;
      } else {
        value += "\\";
        i++;
      }
      continue;
    }
    // `<(` is not process substitution inside double quotes, so only `$` and backtick spans apply here.
    const span = c === "$" || c === "`" ? spanAt(src, i, level) : null;
    if (span !== null) {
      value += src.slice(i, span.end);
      subs.push(...span.subs);
      i = span.end;
      continue;
    }
    value += c;
    i++;
  }
  return { value, end: src.length, subs };
}

/** Read a heredoc delimiter word. Quoting it only disables expansion in the body, so quotes are removed. */
function readDelimiter(src: string, start: number): { delim: string; end: number } {
  let delim = "";
  let i = start;
  while (i < src.length && !DELIM_STOP.has(src[i])) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      delim += src.slice(i + 1, j < 0 ? src.length : j);
      i = j < 0 ? src.length : j + 1;
    } else if (c === "\\") {
      delim += src[i + 1] ?? "";
      i += 2;
    } else {
      delim += c;
      i++;
    }
  }
  return { delim, end: Math.min(i, src.length) };
}

/** Skip the bodies of the heredocs opened on the line that just ended; return where commands resume. */
function skipHeredocBodies(src: string, start: number, pending: Heredoc[]): number {
  let i = start;
  for (const h of pending) {
    while (i < src.length) {
      const j = src.indexOf("\n", i);
      const line = src.slice(i, j < 0 ? src.length : j);
      i = j < 0 ? src.length : j + 1;
      if ((h.stripTabs ? line.replace(/^\t+/, "") : line) === h.delim) break;
    }
  }
  return i;
}
