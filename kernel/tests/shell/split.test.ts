import { expect, test } from "bun:test";
import { leafSegments, shellWords, splitCommand } from "../../src/shell/split.ts";

// The standard heredoc commit form agents use. The apostrophe inside the heredoc must not open a quote,
// or everything after the commit (here, a push) disappears into one unterminated string.
const HEREDOC_COMMIT = `git commit -m "$(cat <<'EOF'\nfix: x\n\nIt's done.\nEOF\n)"`;

test.each([
  ["cd kernel && bun test", ["cd kernel", "bun test"], ["&&"]],
  ["bun test 2>&1 | tail -5", ["bun test 2>&1", "tail -5"], ["|"]],
  ['git commit -m "a; b && c | d"', ['git commit -m "a; b && c | d"'], []],
  ["echo $(a; b) && c", ["echo $(a; b)", "c"], ["&&"]],
  ["a & b", ["a", "b"], ["&"]],
  ["a\nb", ["a", "b"], ["\n"]],
  // Operators and redirections
  ["a || b; c", ["a", "b", "c"], ["||", ";"]],
  ["a &> log && b >&2", ["a &> log", "b >&2"], ["&&"]],
  ["a 2>&1 & b", ["a 2>&1", "b"], ["&"]],
  ["echo a\\;b && c", ["echo a\\;b", "c"], ["&&"]],
  // A trailing newline ends the command; it does not chain another one
  ["  bun test\n", ["bun test"], []],
  // Opaque spans: nothing inside them splits
  ["echo `a | b` && c", ["echo `a | b`", "c"], ["&&"]],
  ["diff <(a | b) c; d", ["diff <(a | b) c", "d"], [";"]],
  ["echo ${x:-a;b} | c", ["echo ${x:-a;b}", "c"], ["|"]],
  ["echo $(a $(b; c) d) ; e", ["echo $(a $(b; c) d)", "e"], [";"]],
  ['echo $(echo ")") && x', ['echo $(echo ")")', "x"], ["&&"]],
  // Comments: quotes inside them open nothing, and their text is not part of the segment
  ["# don't push yet\ngit push", ["git push"], ["\n"]],
  ["bun test # all; really\necho ok", ["bun test", "echo ok"], ["\n"]],
  ["echo a#b; c", ["echo a#b", "c"], [";"]],
  // Heredoc bodies are data, not commands
  ["cat <<'EOF' > notes.txt\nit's a; b | c\nEOF\ngit push", ["cat <<'EOF' > notes.txt", "git push"], ["\n"]],
  ["cat <<-EOF\n\tbody;\n\tEOF\necho ok", ["cat <<-EOF", "echo ok"], ["\n"]],
  ["cat <<EOF && git push\nbody\nEOF", ["cat <<EOF", "git push"], ["&&", "\n"]],
  [HEREDOC_COMMIT + " && git push", [HEREDOC_COMMIT, "git push"], ["&&"]],
  ["grep x <<< 'a b'; echo ok", ["grep x <<< 'a b'", "echo ok"], [";"]],
])("splitCommand(%j)", (cmd, segments, operators) => expect(splitCommand(cmd)).toEqual({ segments, operators }));

test("shellWords removes quotes", () => expect(shellWords(`git commit -m "fix: x" 'y z'`)).toEqual(["git", "commit", "-m", "fix: x", "y z"]));

test.each([
  // Double quotes only escape $ ` " \ and newline; single quotes escape nothing
  [`a\\ b "c\\"d" 'e\\f' "g\\h"`, ["a b", 'c"d', "e\\f", "g\\h"]],
  ["a \\\nb", ["a", "b"]],
  [`a "" b`, ["a", "", "b"]],
  [`echo "$(a "b c")" d`, ["echo", '$(a "b c")', "d"]],
  ["cat <<EOF\nx y\nEOF", ["cat", "<<EOF"]],
  ["a b # c d", ["a", "b"]],
])("shellWords(%j)", (segment, want) => expect(shellWords(segment)).toEqual(want));

test("leafSegments strips env and cd and unwraps bash -c", () => expect(leafSegments(`cd a && FOO=1 bash -c "git push origin && echo ok"`)).toEqual(["git push origin", "echo ok"]));

test.each([
  [`FOO="a b" bun test`, ["bun test"]],
  ["FOO=1; bun test", ["bun test"]],
  ["env FOO=1 BAR=2 git push", ["git push"]],
  [`/bin/bash -lc 'git push'`, ["git push"]],
  [`sh -c 'bun test' 2>&1`, ["bun test"]],
  [`bash -c "cd x && bun test"`, ["bun test"]],
  ["bash script.sh", ["bash script.sh"]],
  ["eval git push origin", ["git push origin"]],
  [`eval "bun test | tail"`, ["bun test", "tail"]],
  // Unwrapping stops after three levels
  ["eval eval eval git push", ["git push"]],
  ["eval eval eval eval git push", ["eval git push"]],
])("leafSegments(%j)", (cmd, want) => expect(leafSegments(cmd)).toEqual(want));
