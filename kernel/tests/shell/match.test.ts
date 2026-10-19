import { expect, test } from "bun:test";
import { matchAction, matchHumanOnly, matchRole, mentionsAosDir } from "../../src/shell/match.ts";
import type { ActionDef, ActionName } from "../../src/types.ts";

// The reference pack's values, inlined so these tests pin shell semantics rather than pack loading.
const roles: Record<string, string[]> = {
  test: ["bun test", "bun run test", "npm test", "npm run test", "pnpm test", "yarn test", "pytest", "go test", "cargo test"],
};
const actions: Record<ActionName, ActionDef> = {
  commit: {
    patterns: ["^git(\\s+(-[cC]\\s+\\S+|--\\S+))*\\s+commit\\b"],
    policy: { spike: { allow: "always" }, bounded: { allow: "in_stages", stages: ["build", "verify"] } },
  },
  push: {
    patterns: ["^git(\\s+(-[cC]\\s+\\S+|--\\S+))*\\s+push\\b"],
    policy: { spike: { allow: "never" }, bounded: { allow: "after_gate", gate: "verify" } },
  },
  pr_create: {
    patterns: ["^gh\\s+pr\\s+create\\b"],
    policy: { spike: { allow: "never" }, bounded: { allow: "after_gate", gate: "verify" } },
  },
  deploy: {
    patterns: [
      "^(vercel|netlify|flyctl|fly)\\s+deploy\\b", "^kubectl\\s+(apply|rollout)\\b", "^terraform\\s+apply\\b",
      "^helm\\s+(install|upgrade)\\b", "\\bdokploy\\b", "^gh\\s+workflow\\s+run\\b",
    ],
    policy: { spike: { allow: "never" }, bounded: { allow: "never" } },
  },
};

// The usual agent commit: a heredoc message inside a substitution, apostrophe and all.
const heredocCommit = (body: string) => `git commit -m "$(cat <<'EOF'\nfix: x\n\n${body}\nEOF\n)"`;

test.each([
  ["bun test", { role: "test", masked: false }],
  ["FOO=1 bun test ./kernel", { role: "test", masked: false }],
  ["cd kernel && bun test", { role: "test", masked: false }],
  ["bun test 2>&1 | tail -20", { role: "test", masked: true }],
  ["bun test || true", { role: "test", masked: true }],
  ["bun test; echo done", { role: "test", masked: true }],
  ['bash -c "bun test"', { role: "test", masked: false }],
  ['bash -c "bun test | tail"', { role: "test", masked: true }],
  ["bun testing", null], ["echo bun test", null],
  // A pipe two wrappers deep still hides the exit status
  [`bash -c "bash -c 'bun test | tail'"`, { role: "test", masked: true }],
  ["bun test > out.log", { role: "test", masked: false }],
])("matchRole(%j)", (cmd, want) => expect(matchRole(cmd, roles)).toEqual(want));

test("matchRole checks roles in pack order, not leaf order", () => {
  const lintFirst = { lint: ["bun run lint"], ...roles };
  expect(matchRole("bun test && bun run lint", lintFirst)).toEqual({ role: "lint", masked: false });
  expect(matchRole("bun run lint && bun test", { ...roles, lint: ["bun run lint"] })).toEqual({ role: "test", masked: false });
});

test.each<[string, ActionName | null]>([
  ["git push", "push"], ["git -C ../x push origin main", "push"], ["git --no-pager push", "push"],
  ['git commit -m "explain the git push guard"', "commit"],
  ["bash -c 'git push'", "push"],
  ["gh pr create --fill", "pr_create"], ["git push && gh pr create", "pr_create"],
  ["vercel deploy --prod", "deploy"], ['echo "git push"', null], ["git status", null],
  [heredocCommit("It's about the git push guard."), "commit"],
  [heredocCommit("It's done.") + " && git push", "push"],
  ["# don't push yet\ngit push", "push"],
  ["git commit -F - <<EOF\ngit push\nEOF", "commit"],
])("matchAction(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

test.each([
  ["aos approve 01J design", "approve"], ["bun cli/src/index.ts approve 01J", "approve"],
  ["bun run /abs/aos-framework/cli/src/index.ts run cancel 01J", "run cancel"], ["aos tier  lower", "tier lower"],
  ['git commit -m "add aos approve"', null],
  ["aos status", null],
  // An installed binary called by path is still the human-only command
  ["~/.bun/bin/aos approve 01J", "approve"], ["./node_modules/.bin/aos waive 01J", "waive"],
  ["npx aos-harness budget extend 01J", "budget extend"], ["aos run pause 01J", "run pause"],
  ['bash -c "aos approve 01J"', "approve"],
  ["chaos approve", null], ["aos approved", null],
])("matchHumanOnly(%j)", (cmd, want) => expect(matchHumanOnly(cmd)).toBe(want));

test.each([
  ["cat .aos/runs/x/state.json", true], ["echo hi >> .aos/runs/x/log.jsonl", true], ["echo hi>>.aos/x", true],
  ["rm -rf /repo/.aos", true], ['git commit -m "document the .aos/ layout"', false], ["ls -la", false],
  // cd and assignments are dropped from leaves but still touch the directory
  ["cd .aos && rm -rf runs", true], ["DIR=.aos/runs ls", true],
  ['bash -c "rm -rf .aos"', true], ["cat<.aos/x", true], ['cp a ".aos/runs/x"', true],
  [heredocCommit("It's in .aos/runs now."), false], ["ls .aosx my.aos", false],
])("mentionsAosDir(%j)", (cmd, want) => expect(mentionsAosDir(cmd)).toBe(want));
