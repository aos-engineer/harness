# AOS Harness Pi Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pi CLI adapter — a Pi extension that implements all 4 adapter layers (Agent Runtime, Event Bus, UI, Workflow Engine) and wires them to the AOS runtime engine. When complete, a user can run `pi -e adapters/pi/src/index.ts`, execute `/aos-run`, select a profile and brief, and watch a full multi-agent deliberation with real-time streaming, constraint gauges, and a structured memo output.

**Architecture:** The adapter is a Pi extension (`export default function(pi: ExtensionAPI)`) that:
1. Creates an `AOSAdapter` implementation using Pi's native APIs
2. Instantiates `AOSEngine` from the runtime
3. Registers two custom tools (`delegate` and `end`) that the Arbiter calls
4. Registers the `/aos-run` command that starts a session
5. Handles TUI rendering (streaming widgets, constraint gauges, agent status footer)
6. Manages agent subprocesses via `pi --mode json --session <file>` spawning

**Tech Stack:** TypeScript, Pi extension API (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`), AOS runtime (`@aos-harness/runtime`)

**Spec:** `docs/specs/2026-03-23-aos-harness-design.md` (Sections 2.2, 2.3, 6.1-6.15)

**Reference:** Pi API usage patterns — subprocess spawning, JSON event parsing, TUI widgets, and tool registration — are well established in the Pi ecosystem (including IndyDevDan's public ceo-agents project). This adapter implements them against the AOS adapter contract.

---

## File Structure

```
aos-harness/
├── adapters/
│   └── pi/
│       ├── src/
│       │   ├── index.ts              # Extension entry point — registers everything
│       │   ├── agent-runtime.ts      # L1: Pi subprocess spawning, session management
│       │   ├── event-bus.ts          # L2: Pi lifecycle event wiring
│       │   ├── ui.ts                 # L3: TUI widgets, command/tool registration, rendering
│       │   └── workflow.ts           # L4: Parallel dispatch, file ops, state persistence
│       ├── package.json
│       └── tsconfig.json
```

---

### Task 1: Pi Adapter Scaffolding

**Files:**
- Create: `adapters/pi/package.json`
- Create: `adapters/pi/tsconfig.json`

- [ ] **Step 1: Create directories**

```bash
mkdir -p adapters/pi/src
```

- [ ] **Step 2: Create package.json**

Create `adapters/pi/package.json`:

```json
{
  "name": "@aos-harness/pi-adapter",
  "version": "0.1.0",
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `adapters/pi/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": ".",
    "paths": {
      "@aos-harness/runtime/*": ["../../runtime/src/*"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd adapters/pi && bun install
```

- [ ] **Step 5: Commit**

```bash
cd aos-harness
git add adapters/pi/package.json adapters/pi/tsconfig.json adapters/pi/bun.lock
git commit -m "chore: scaffold Pi adapter package"
```

---

### Task 2: Agent Runtime Layer (L1)

**Files:**
- Create: `adapters/pi/src/agent-runtime.ts`

This is the core subprocess management. It spawns Pi agent subprocesses with persistent sessions, parses JSON event streams, and tracks token usage/cost.

- [ ] **Step 1: Implement agent-runtime.ts**

This module must:

1. **`spawnAgent(config, sessionId)`** — Create a session file path at `.aos/sessions/<sessionId>/<agentId>.jsonl`. Don't spawn yet — just record config and session path. Return an `AgentHandle`.

2. **`sendMessage(handle, message, opts)`** — Spawn a Pi subprocess:
   ```
   pi --mode json -p --no-extensions --no-skills --no-prompt-templates --no-themes \
      --session <sessionFile> --thinking <off|on> <message>
   ```
   - First call (session file doesn't exist): add `--system-prompt <resolved prompt> --model <model>`
   - Subsequent calls: just `--session <file>` — Pi auto-resumes
   - Context files on first call: add `@<filepath>` args
   - Parse JSON events from stdout:
     - `message_update` with `assistantMessageEvent.type === "text_delta"` → call `opts.onStream`
     - `message_end` → extract response text, usage stats (tokensIn, tokensOut, cost, contextTokens, model)
     - `tool_execution_start` → track tool usage
   - Handle abort signal: kill subprocess on signal abort
   - Handle timeout: kill subprocess after `agent_timeout_seconds`
   - Return `AgentResponse`

3. **`destroyAgent(handle)`** — No-op (sessions persist on disk)

4. **`setOrchestratorPrompt(prompt)`** — Store for injection via `before_agent_start`

5. **`injectContext(handle, files)`** — Store context files to be passed as `@file` on next sendMessage

6. **`getContextUsage(handle)`** — Return last known token count from message_end

7. **`setModel(handle, config)`** — Store model config, used on first subprocess spawn

8. **`getAuthMode()`** — Check if `ANTHROPIC_API_KEY` is set → metered. If Pi is using subscription auth → unmetered. Default to metered.

9. **`getModelCost(tier)`** — Return hardcoded Anthropic pricing for economy/standard/premium tiers

10. **`abort()`** — Kill all active subprocesses

Key Pi adapter patterns to implement:
- `spawn("pi", args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: subprocessEnv })`
- Parse stdout line by line, JSON.parse each line
- Buffer handling: accumulate partial lines, split on `\n`
- Handle non-zero exit codes and stderr

Map model tiers to actual Pi model IDs using env-configurable defaults:
- economy → `anthropic/claude-haiku-4-5`
- standard → `anthropic/claude-sonnet-4-6`
- premium → `anthropic/claude-opus-4-6`

- [ ] **Step 2: Commit**

```bash
git add adapters/pi/src/agent-runtime.ts
git commit -m "feat(pi-adapter): add agent runtime — Pi subprocess spawning with session management"
```

---

### Task 3: Event Bus Layer (L2)

**Files:**
- Create: `adapters/pi/src/event-bus.ts`

This module wires Pi's lifecycle events to the adapter contract.

- [ ] **Step 1: Implement event-bus.ts**

Create a class `PiEventBus` that:
1. Stores handler functions registered by the engine
2. Exposes a `wire(pi: ExtensionAPI)` method that calls `pi.on(...)` for each Pi event and delegates to the stored handlers
3. Maps Pi events to adapter events:
   - `pi.on("session_start")` → calls stored `onSessionStart` handler
   - `pi.on("session_shutdown")` → calls stored `onSessionShutdown` handler
   - `pi.on("before_agent_start")` → calls stored `onBeforeAgentStart` handler, returns `{ systemPrompt }` if provided
   - `pi.on("agent_end")` → calls stored `onAgentEnd` handler
   - `pi.on("tool_call")` → calls stored `onToolCall` handler, returns `{ block }` if handler says to block
   - `pi.on("tool_result")` → calls stored `onToolResult` handler
   - `pi.on("message_end")` → extracts usage from event, calls stored `onMessageEnd` handler
   - `pi.on("session_before_compact")` → calls stored `onCompaction` handler

- [ ] **Step 2: Commit**

```bash
git add adapters/pi/src/event-bus.ts
git commit -m "feat(pi-adapter): add event bus — Pi lifecycle event wiring"
```

---

### Task 4: UI Layer (L3)

**Files:**
- Create: `adapters/pi/src/ui.ts`

This module handles all TUI rendering, command registration, tool registration, and user interaction.

- [ ] **Step 1: Implement ui.ts**

Create a class `PiUI` that takes `pi: ExtensionAPI` and a context reference. Implements:

**Commands:**
- `registerCommand(name, handler)` → `pi.registerCommand(name, { description, handler })`

**Tools (delegate and end):**
- `registerTool(name, schema, handler)` → `pi.registerTool({ name, label, description, parameters: Type.Object(schema), execute: handler, renderCall, renderResult })`
- The `delegate` tool: parameters `{ to: string | string[], message: string }`, renders as "Arbiter → [targets]" with message preview
- The `end` tool: parameters `{ message: string }`, renders as "Closing deliberation"

**Rendering:**
- `renderAgentResponse(agent, response, color)` → `pi.sendMessage({ customType: "agent-response", content: response, display: true, details: { agent, color } })` + register a custom message renderer
- `setWidget(id, renderer)` → `ctx.ui.setWidget(id, () => ({ render(width: number): string[] { ... }, invalidate() {} }))` — Pi's widget API expects a factory returning an object with `render(width)` and `invalidate()`. Used for live streaming feed and constraint gauges. Pass `undefined` to remove a widget.
- `setFooter(renderer)` → `ctx.ui.setFooter((_tui, _theme, _footerData) => ({ render(width: number): string[] { ... }, invalidate() {}, dispose() {} }))` — Pi's footer API expects a factory returning an object with `render`, `invalidate`, and `dispose` methods. Used for agent status cards.
- `setStatus(key, text)` → `ctx.ui.setStatus(key, text)`
- `setTheme(name)` → `ctx.ui.setTheme(name)`

**User Interaction:**
- `promptSelect(label, options)` → `ctx.ui.select(label, options)`
- `promptConfirm(title, message)` → `ctx.ui.confirm(title, message)`
- `promptInput(label)` → `ctx.ui.input(label)`
- `notify(message, level)` → `ctx.ui.notify(message, level)`

**Input Control:**
- `blockInput(allowedCommands)` → register `pi.on("input")` handler that returns `{ action: "handled" as const }` for blocked input (with notification) and `{ action: "continue" as const }` for extension-sourced messages. Only text matching `allowedCommands` (e.g., "halt", "wrap") passes through.
- `unblockInput()` → set a flag that makes the input handler return `{ action: "continue" as const }` for all input
- `steerMessage(message)` → `pi.sendUserMessage(message, { deliverAs: "steer" })`

**Streaming Widget:**
Create a live feed widget that shows all agents' streaming responses in config order. Each agent gets a colored header with status icon (responding/done) and the last line of their response. This widget is created during `dispatchParallel` and removed when all agents complete.

**Constraint Gauge Widget:**
Create a progress bar widget showing TIME, BUDGET (if metered), and ROUNDS gauges with min/max threshold markers, driven by the AOS ConstraintState.

- [ ] **Step 2: Commit**

```bash
git add adapters/pi/src/ui.ts
git commit -m "feat(pi-adapter): add UI layer — TUI widgets, commands, tools, rendering"
```

---

### Task 5: Workflow Layer (L4)

**Files:**
- Create: `adapters/pi/src/workflow.ts`

- [ ] **Step 1: Implement workflow.ts**

Create a class `PiWorkflow` that implements:

1. **`dispatchParallel(handles, message, opts)`** — Call `agentRuntime.sendMessage` for each handle via `Promise.allSettled`. Stream updates to the live feed widget during execution. Return all responses (fulfilled + rejected as failed status).

2. **`isolateWorkspace()`** — Create a git worktree via `spawn("git", ["worktree", "add", ...])`. Return path + cleanup function.

3. **`writeFile(path, content)`** — `writeFileSync(path, content, "utf-8")` with `mkdirSync` for parent dirs.

4. **`readFile(path)`** — `readFileSync(path, "utf-8")`

5. **`openInEditor(path, editor)`** — `spawn(editor, [path], { detached: true, stdio: "ignore" }).unref()`

6. **`persistState(key, value)`** — Write to `.aos/state/<key>.json`

7. **`loadState(key)`** — Read from `.aos/state/<key>.json`, return null if missing

- [ ] **Step 2: Commit**

```bash
git add adapters/pi/src/workflow.ts
git commit -m "feat(pi-adapter): add workflow layer — parallel dispatch, file ops, state persistence"
```

---

### Task 6: Extension Entry Point (index.ts)

**Files:**
- Create: `adapters/pi/src/index.ts`

This is the main Pi extension entry point that wires everything together.

- [ ] **Step 1: Implement index.ts**

The extension entry point must:

1. **`export default function(pi: ExtensionAPI)`** — Pi calls this on load

2. **On `session_start`:**
   - Discover project root (walk up from cwd looking for `core/` directory or `.aos/` config)
   - Load `.env` if it exists
   - Set theme (e.g., "synthwave" or a custom AOS theme)
   - Set title "AOS Harness"
   - Display startup notification with available profiles and agent count
   - Set status line

3. **Register `/aos-run` command:**
   - List available profiles from `core/profiles/` (sorted by mtime). If none found, notify user with instructions and return early.
   - `ctx.ui.select()` to pick a profile
   - List available briefs from `core/briefs/` (directories containing brief.md). If none found, notify user and return early.
   - `ctx.ui.select()` to pick a brief
   - Optionally select a domain from `core/domains/`
   - Create the `AOSAdapter` by composing PiAgentRuntime, PiEventBus, PiUI, PiWorkflow into a single object: `const adapter: AOSAdapter = Object.assign({}, agentRuntime, eventBus, ui, workflow)`
   - Resolve paths: `const agentsDir = join(projectRoot, "core/agents")`, `const domainDir = selectedDomain ? join(projectRoot, "core/domains", selectedDomain) : undefined`
   - Create the `AOSEngine`: `new AOSEngine(adapter, profileDir, { agentsDir, domain: selectedDomain, domainDir })`
   - Call `engine.start(briefPath)` — validates brief, initializes session
   - Inject Arbiter system prompt via `before_agent_start`
   - Register `delegate` tool (calls `engine.delegateMessage`)
   - Register `end` tool (calls `engine.end`)
   - Set up constraint gauge widget
   - Set up footer with agent status cards
   - Block input (only allow "halt" and "wrap")
   - `pi.sendUserMessage(kickoff)` — sends the brief to the Arbiter

4. **Register `delegate` tool:**
   - Parameters: `to` (string | string[]), `message` (string)
   - Execute: calls `engine.delegateMessage(to, message)`
   - Before dispatch: update streaming widget
   - After dispatch: remove streaming widget, return responses + constraint state
   - If constraint state `hit_maximum`: include hard message to call `end`
   - `renderCall`: show "Arbiter → [targets]" with message preview
   - `renderResult`: show response count, constraint summary, expandable responses

5. **Register `end` tool:**
   - Parameters: `message` (string)
   - Execute: calls `engine.end(message)`
   - Returns final statements + deliberation summary
   - After completion: set up memo frontmatter injection via `tool_result` handler

6. **Handle `input` event:**
   - During deliberation: block all input except "halt" and "wrap"
   - "halt" → abort, save transcript, notify
   - "wrap" → `pi.sendUserMessage("Call end now.", { deliverAs: "steer" })`

7. **Handle `tool_result` for memo:**
   - When a `write` tool completes and path contains "memo": inject YAML frontmatter with session metadata
   - After frontmatter injection: call `unblockInput()` to restore user input
   - Open memo in configured editor via `openInEditor`

8. **Handle `before_agent_start`:**
   - If session is active: resolve the Arbiter's system prompt using `resolveTemplate()` with session variables (session_id, participants, constraints, brief content, output_path, deliberation_dir, expertise_block). Return `{ systemPrompt: resolvedPrompt }`

9. **Handle transcript persistence:**
   - After `engine.end()` completes (or on session shutdown): write `engine.getTranscript()` to `.aos/sessions/<sessionId>/transcript.jsonl` (one JSON object per line)
   - Also write transcript on "halt" (abort)

10. **Handle `session_shutdown`:**
    - Kill all active agent subprocesses via `agentRuntime.abort()`
    - Persist any unsaved transcript
    - Notify user of cleanup

- [ ] **Step 2: Verify the extension loads**

```bash
cd aos-harness
pi -e adapters/pi/src/index.ts --help
```

Expected: Pi loads without errors. The extension should show the AOS startup notification.

- [ ] **Step 3: Commit**

```bash
git add adapters/pi/src/index.ts
git commit -m "feat(pi-adapter): add extension entry point — wires all layers, registers tools and commands"
```

---

### Task 7: Integration Testing

- [ ] **Step 1: Manual smoke test**

```bash
cd aos-harness
pi -e adapters/pi/src/index.ts
```

In the Pi TUI:
1. Run `/aos-run`
2. Select "strategic-council" profile
3. Select "sample-product-decision" brief
4. Watch the Arbiter frame the question and call `delegate("all", ...)`
5. Observe streaming responses from agents
6. Observe constraint gauges updating
7. Watch the Arbiter drive follow-up rounds
8. See `end` called when constraints are met
9. Verify memo is written

- [ ] **Step 2: Verify transcript output**

```bash
cat .aos/sessions/*/transcript.jsonl | head -20
```

Expected: Well-formed JSONL with session_start, delegation, response, constraint_check events.

- [ ] **Step 3: Verify memo output**

Check the output memo has YAML frontmatter and all required sections (ranked recommendations, agent stances, dissent, trade-offs, next actions, summary).

- [ ] **Step 4: Fix any issues found during smoke test**

Address any bugs, rendering issues, or lifecycle problems discovered.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix(pi-adapter): address integration testing findings"
git tag v0.1.0-pi-adapter
```

---

### Task 8: Documentation

**Files:**
- Create: `adapters/pi/README.md`
- Update: project root `README.md`

- [ ] **Step 1: Create adapter README**

Create `adapters/pi/README.md` with:
- What this is (Pi CLI adapter for AOS Harness)
- Prerequisites (Pi, Bun, Anthropic API key)
- Quick start (`pi -e adapters/pi/src/index.ts` then `/aos-run`)
- Configuration (model tier mapping, editor, theme)
- Available commands and controls

- [ ] **Step 2: Create project README**

Create root `README.md` with:
- Project name and one-line description
- What AOS Harness is (agentic orchestration system)
- Quick start for Tier 1 users
- Architecture overview (config + runtime + adapter)
- Agent roster table
- Link to adapter README for detailed usage

- [ ] **Step 3: Commit**

```bash
git add adapters/pi/README.md README.md
git commit -m "docs: add Pi adapter and project README"
```

---

## Notes for Implementers

**Pi Extension API patterns to use:**
- `pi.on("session_start", async (_event, ctx) => { ... })` for initialization
- `pi.registerCommand("name", { description, handler: async (args, ctx) => { ... } })` for commands
- `pi.registerTool({ name, label, description, parameters: Type.Object({...}), execute, renderCall, renderResult })` for tools
- `pi.sendUserMessage(text)` to kick off the Arbiter
- `pi.sendUserMessage(text, { deliverAs: "steer" })` for wrap command
- `pi.on("input", async (event, ctx) => { ... })` for input blocking
- `pi.on("before_agent_start", async (event, ctx) => { return { systemPrompt } })` for prompt injection
- `pi.on("tool_result", async (event, ctx) => { ... })` for memo frontmatter
- `ctx.ui.setWidget(id, renderer)` for streaming and constraint widgets
- `ctx.ui.setFooter(renderer)` for agent status
- `ctx.ui.select(label, options)` for brief/profile selection
- `pi.sendMessage({ customType, content, display, details })` for custom messages
- `pi.registerMessageRenderer(type, renderer)` for custom message rendering

**Subprocess spawning pattern:**
```typescript
const proc = spawn("pi", args, {
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
  env: subprocessEnv,
});
// Parse stdout line by line as JSON events
// Handle message_update (text_delta), message_end (usage), tool_execution_start
```

**ANSI color for agent responses:**
Use 24-bit ANSI: `\x1b[48;2;R;G;Bm` for background, `\x1b[38;2;R;G;Bm` for foreground. Parse hex colors from agent config.

**Adapter composition pattern:**
The four layer classes (PiAgentRuntime, PiEventBus, PiUI, PiWorkflow) are composed into a single `AOSAdapter` via `Object.assign({}, runtime, eventBus, ui, workflow)`. Each class holds its own state (e.g., PiAgentRuntime holds subprocess handles, PiUI holds the Pi context reference). The engine receives the combined object and calls methods from any layer.

**Model tier mapping function:**
```typescript
function resolveModelId(tier: ModelTier): string {
  const map: Record<ModelTier, string> = {
    economy: process.env.AOS_MODEL_ECONOMY || "anthropic/claude-haiku-4-5",
    standard: process.env.AOS_MODEL_STANDARD || "anthropic/claude-sonnet-4-6",
    premium: process.env.AOS_MODEL_PREMIUM || "anthropic/claude-opus-4-6",
  };
  return map[tier];
}
```
This lives in `agent-runtime.ts` and is used when building the `--model` flag for subprocess spawning.

**Event bus handler-storage pattern:**
PiEventBus stores handlers in an internal map. During `wire(pi)`, it registers Pi event listeners that delegate to whatever handler is currently stored. This means handlers can be set BEFORE `wire()` is called (the engine sets them during construction, then the extension entry point calls `wire()` during `session_start`).

**Implement original code against the AOS adapter contract.** Understand the Pi APIs and write implementations that follow the AOS adapter contract.
