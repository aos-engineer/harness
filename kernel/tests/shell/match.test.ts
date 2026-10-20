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
    patterns: ["^gh\\s+pr\\s+(create|new)\\b", "^gh\\s+api\\b.*\\bpulls\\b"],
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
  // A trailing `;` or newline runs nothing after the test, so its status stands; a trailing `&` backgrounds it
  ["bun test;", { role: "test", masked: false }],
  ["bun test <<EOF\na | b\nEOF", { role: "test", masked: false }],
  ['bash -c "bun test;"', { role: "test", masked: false }],
  ["bun test &", { role: "test", masked: true }],
  ["bun test <<EOF | tail\nx\nEOF", { role: "test", masked: true }],
])("matchRole(%j)", (cmd, want) => expect(matchRole(cmd, roles)).toEqual(want));

test.each([
  // Grouping, keywords, and transparent wrappers do not hide a test run
  ["time bun test", { role: "test", masked: false }],
  ["timeout 300 bun test", { role: "test", masked: false }],
  ["env CI=1 bun test", { role: "test", masked: false }],
  ["(bun test)", { role: "test", masked: false }],
  ["bun  test", { role: "test", masked: false }],
  ["(bun test | tail)", { role: "test", masked: true }],
  // `!` inverts the status, and a substitution's status is never the command's own
  ["! bun test", { role: "test", masked: true }],
  ["x=$(bun test)", { role: "test", masked: true }],
  // xargs and watch run the command on their own terms, so they stay opaque
  ["xargs bun test", null], ["watch bun test", null],
])("matchRole unwraps(%j)", (cmd, want) => expect(matchRole(cmd, roles)).toEqual(want));

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

test.each<[string, ActionName | null]>([
  // Grouping, keywords, negation, and `time`
  ["(git push)", "push"], ["{ git push; }", "push"], ["time git push", "push"], ["time -p git push", "push"],
  ["if ! git push; then echo x; fi", "push"], ["while true; do git push; done", "push"],
  // Transparent wrappers and their options
  ["nohup git push", "push"], ["command git push", "push"], ["exec git push", "push"],
  ["nice -n 5 git push", "push"], ["sudo git push", "push"], ["sudo -E git push", "push"],
  ["timeout 120 git push", "push"], ["timeout -s KILL 60 git push", "push"],
  ["env -i git push", "push"], ["env -u X git push", "push"],
  // The command word by path or quoted
  ["/usr/bin/git push", "push"], ["'git' push", "push"], ["\\git push", "push"],
  // Shell options before -c
  ['bash -o pipefail -c "git push"', "push"], ["bash -e -c 'git push'", "push"],
  // Substitutions are code
  ["URL=$(gh pr create --fill) && echo $URL", "pr_create"], ["echo `git push`", "push"], ["cat <(git push)", "push"],
  // Still not a push
  ['git commit -m "explain git push"', "commit"], [heredocCommit("It's about git push."), "commit"],
  ['echo "git push"', null], ["git stash push", null], ["xargs git push", null],
  ["cat <<'EOF'\n$(git push)\nEOF", null], ["cat <<EOF\n$(git push)\nEOF", "push"],
  ["git commit -F- <<'EOF'\nfix: stop `git push` early\nEOF", "commit"],
  ["git commit -F- <<EOF\nfix: stop `git push` early\nEOF", "push"],
])("matchAction unwraps(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

test.each<[string, ActionName | null]>([
  // A shell with no script operand runs what arrives on stdin: a heredoc, a herestring, or a pipe
  ["bash <<'EOF'\ngit push -q origin main\nEOF", "push"], ["bash <<EOF\ngit push\nEOF", "push"],
  ["sh <<-EOF\n\tgit push\n\tEOF", "push"], ["bash << 'EOF'\necho hi\ngit push\nEOF", "push"],
  ["/bin/bash -s <<'EOF'\ngit push\nEOF", "push"], ["bash -s -- a b <<'EOF'\ngit push\nEOF", "push"],
  ["bash - <<'EOF'\ngit push\nEOF", "push"], ["bash /dev/stdin <<'EOF'\ngit push\nEOF", "push"],
  ["sudo bash <<'EOF'\ngit push\nEOF", "push"], ["x=$(bash <<'EOF'\ngit push\nEOF\n)", "push"],
  ["bash <<<'git push'", "push"], ['bash <<< "git push origin main"', "push"], ["zsh 0<<<'git push'", "push"],
  ["echo 'git push origin main' | bash", "push"], ["printf 'git push\\n' | sh", "push"],
  ["printf '%s\\n' 'git push' | sh", "push"], ["echo git push | bash", "push"],
  ["cat <<'EOF' | bash\ngit push\nEOF", "push"],
  // Each heredoc body belongs to the command that opened it
  ["cat <<'A' && bash <<'B'\nnot code\nA\ngit push\nB", "push"],
  ["bash <<'A' && cat <<'B'\ngit status\nA\ngit push\nB", null],
  // Every common shell takes -c, by name or by path
  ["dash -c 'git push'", "push"], ["ksh -c 'git push'", "push"], ["fish -c 'git push'", "push"],
  ["fish --command 'git push'", "push"], ["fish --command='git push'", "push"], ["/usr/local/bin/fish -c 'git push'", "push"],
  ["mksh -c 'git push'", "push"], ["/bin/dash -ec 'git push'", "push"],
  // Still data: the heredoc goes to another command, to a script file, or to a -c script that reads it
  ["git commit -F - <<'EOF'\ngit push\nEOF", "commit"], ["cat <<'EOF'\ngit push\nEOF", null],
  ["bash script.sh <<'EOF'\ngit push\nEOF", null], ["bash -c 'cat' <<'EOF'\ngit push\nEOF", null],
  ["bash < notes.txt", null], ["echo 'git push' | grep push", null], ["tee x <<<'git push'", null],
  ["echo 'git push' > notes.txt", null],
])("matchAction reads scripts fed to a shell(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

test.each<[string, ActionName | null]>([
  // The default macOS filesystem runs `Git` as git, and a quoted value with spaces is still one value
  ["Git push", "push"], ["GIT push origin main", "push"], ["Gh pr create --fill", "pr_create"],
  ['git -C "my dir" push', "push"], ['git -c "user.name=A B" push origin main', "push"],
  ['git commit -m "fix: a b c"', "commit"], ['echo "Git push"', null], ['git log --grep "git push"', null],
])("matchAction folds case and keeps quoted words whole(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

test.each<[string, ActionName | null]>([
  // A command word that comes from an expansion cannot be classified, so its arguments decide
  ["G=git; $G push", "push"], ['G=git && "$G" push origin main', "push"], ["${G} push", "push"],
  ["$(echo git) push", "push"], ["`echo git` push", "push"], ["$(echo git push)", "push"],
  ['eval "$(echo git push)"', "push"], ["$GH pr create --fill", "pr_create"], ["$GH pr new", "pr_create"],
  ["$GH api repos/o/r/pulls -f title=x", "pr_create"], ["$(echo git) commit -m x", "commit"],
  ["$V deploy --prod", "deploy"], ["$K apply -f k8s/", "deploy"], ["$GH workflow run release.yml", "deploy"],
  // An expanded command word with ordinary arguments is not an action
  ['"$(git rev-parse --show-toplevel)/node_modules/.bin/tsc" --noEmit', null], ["$EDITOR notes.md", null],
  ['"$ROOT/scripts/push-docs.sh"', null],
  // git runs, but a subcommand from an expansion could be any of its subcommands
  ["S=push; git $S", "push"], ['git "$SUB" origin main', "push"], ["git -C repo $(echo push)", "push"],
  ["git -c user.name=x ${CMD}", "push"], ["git status $FILE", null], ['git log "$RANGE"', null],
])("matchAction treats an expanded command word conservatively(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

test.each<[string, ActionName | null]>([
  // An alias defined with -c runs its value, and a value starting with ! runs as a shell command
  ["git -c alias.p=push p", "push"], ["git -c alias.p=push p origin main", "push"],
  ["git -c 'alias.p=!git push' p", "push"], ["git -c 'alias.x=!git' x push", "push"],
  ["git -c alias.a=b -c alias.b=push a", "push"], ["git -c alias.P=push p", "push"],
  ["git -c alias.p=push -C . p", "push"], ["git -c alias.c=commit c -m x", "commit"],
  ["bash -c 'git -c alias.p=push p'", "push"],
  // A builtin always wins over an alias of the same name, and an unused alias changes nothing
  ["git -c alias.push=status push", "push"], ["git -c alias.st=status st", null], ["git -c alias.p=push status", null],
  // PR creation through the other gh spellings
  ["gh pr new --fill", "pr_create"], ["gh api repos/o/r/pulls -f title=x -f head=b", "pr_create"],
  ["gh api -X POST /repos/o/r/pulls", "pr_create"], ["gh api repos/o/r/issues", null],
])("matchAction resolves aliases and PR spellings(%j)", (cmd, want) => expect(matchAction(cmd, actions)).toBe(want));

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
  ["command aos approve", "approve"], ["(aos approve)", "approve"], ["echo y | sudo aos approve", "approve"],
  // Package runners, with their own flags and a pinned version
  ["npx -y aos-harness approve 01J", "approve"], ["bun x aos-harness approve", "approve"],
  ["bunx --bun aos-harness approve", "approve"], ["bunx aos-harness@latest approve", "approve"],
  ["npm exec aos-harness -- approve", "approve"], ["pnpm dlx aos-harness approve", "approve"],
  ["yarn dlx aos-harness waive 01J", "waive"],
  // The CLI from source, through node or run directly
  ["node cli/src/index.ts approve", "approve"], ["./cli/src/index.ts run cancel 01J", "run cancel"],
  ["npx aos-harness status", null], ["npm exec other-tool -- approve", null], ["node index.ts approve", null],
  // Wrappers that allocate a terminal, and inline interpreter code that can, carry the command anywhere
  ["script -q /dev/null aos approve 01J design", "approve"], ["script -qc 'aos run cancel 01J' /dev/null", "run cancel"],
  ["expect -c 'spawn aos approve 01J; send y\\r; interact'", "approve"], ["unbuffer aos approve 01J", "approve"],
  ["socat - EXEC:'aos approve 01J',pty", "approve"], ["unbuffer npx -y aos-harness waive 01J", "waive"],
  [`python3 -c "import pty; pty.spawn(['aos', 'approve', '01J'])"`, "approve"],
  [`perl -e 'exec "/usr/local/bin/aos", "approve", "01J"'`, "approve"], [`node -e "spawn('aos', ['approve'])"`, "approve"],
  [`ruby -e 'system("aos run cancel 01J")'`, "run cancel"], [`deno eval "Deno.run({cmd: ['aos', 'approve']})"`, "approve"],
  // ...but a wrapper or interpreter that does not carry one is ordinary, and so is a script file
  ["script -q /dev/null bun test", null], ['python3 -c "print(1)"', null], ["python3 tools/aos_approve.py", null],
  ["node scripts/chaos approve", null], ['git commit -m "script -q /dev/null aos approve"', null],
  // A command word or subcommand from an expansion, and the case the default macOS filesystem ignores
  ["A=aos; $A approve 01J", "approve"], ['"$(which aos)" approve 01J', "approve"], ['"$AOS" run cancel 01J', "run cancel"],
  ["x=approve; aos $x 01J", "$x"], ["AOS approve 01J", "approve"], ["Aos run cancel 01J", "run cancel"],
  ["$A status", null], ["aos status $RUN", null], ['"$EDITOR" approve.md', null],
])("matchHumanOnly(%j)", (cmd, want) => expect(matchHumanOnly(cmd)).toBe(want));

test.each([
  ["cat .aos/runs/x/state.json", true], ["echo hi >> .aos/runs/x/log.jsonl", true], ["echo hi>>.aos/x", true],
  ["rm -rf /repo/.aos", true], ['git commit -m "document the .aos/ layout"', false], ["ls -la", false],
  // cd and assignments are dropped from leaves but still touch the directory
  ["cd .aos && rm -rf runs", true], ["DIR=.aos/runs ls", true],
  ['bash -c "rm -rf .aos"', true], ["cat<.aos/x", true], ['cp a ".aos/runs/x"', true],
  [heredocCommit("It's in .aos/runs now."), false], ["ls .aosx my.aos", false],
  // Prose in a quoted argument is not a path, however it mentions .aos
  ['git commit -m "move logs to ./.aos/runs"', false], ['git commit -m "see DIR=.aos/runs"', false],
  ['git commit -m ".aos/ is ignored now"', false],
  ['git commit -m "feat: x" -m "Run logs live under repo/.aos/runs."', false],
  // Whitespace inside a substitution does not make the path around it prose
  ['cat "$(git rev-parse --show-toplevel)/.aos/runs/x"', true], ["cat $(echo .aos/x)", true],
  // Default macOS filesystems fold case, so .AOS reaches the same kernel files
  ["cat .AOS/runs/x/state.json", true], ["rm -rf /repo/.Aos", true], ["ls .AOSX", false],
  // ...and fold Unicode case: long s (U+017F) is s. Ignorable code points and compatibility forms fold away.
  ["cat .ao\u017f/runs/x/state.json", true], ["rm -rf .a\u200Bos", true], ["ls .\uFF41os", true],
  // A glob or brace expansion that bash expands to .aos, as checked against real bash
  ["rm -rf .a*", true], ["cat .ao?/runs/x/state.json", true], ["ls .[a]os", true], ["ls .[!x]os", true],
  ["rm -rf .*", true], ["cp -r ./.* /tmp/x", true], ["rm -rf .{aos,git}", true], ["rm -rf .ao{r..t}", true],
  ["cat {.aos,x}/runs/a", true], ["ls .A*", true], ["ls .[[:alpha:]]os", true], ["ls .a-*", false],
  ["echo .{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}{q,r}", true],
  // Without a literal leading dot, a glob does not match a dot directory, unless dotglob is on
  ["rm -rf dist/*", false], ["ls *", false], ["ls ?aos", false], ["ls [.]aos", false], ["ls .g*", false],
  ["shopt -s dotglob; rm -rf *", true], ["ls .git/*", false], ["echo {1..1000000}", false],
  ["echo ${HOME}", false], ["find . -name '*.ts' -exec wc -l {} +", false], ["ls .{git,github}", false],
])("mentionsAosDir(%j)", (cmd, want) => expect(mentionsAosDir(cmd)).toBe(want));
