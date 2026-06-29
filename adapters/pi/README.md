# Pi Adapter — AOS Harness

This is the Pi CLI adapter for the AOS Harness. It runs both deliberation sessions and execution workflows inside Pi's terminal UI, wiring the harness runtime, event bus, workflow engine, and UI layer into Pi's interactive session model.

## Prerequisites

- [Pi CLI](https://pi.dev) installed and on your `PATH`
- [Bun](https://bun.sh) runtime
- An Anthropic API key set as `ANTHROPIC_API_KEY`

## Quick Start

```bash
cd aos-harness/adapters/pi && bun install
pi -e src/index.ts
# In the TUI, run:
/aos-run
```

In an AOS project, `aos init --adapter pi` generates `.pi/extensions/aos-harness.ts`, so you can also start Pi directly:

```bash
cd my-aos-project
pi
/aos-run
```

For all projects, run `aos setup-pi --global` once to create `~/.pi/agent/extensions/aos-harness.ts`.

## Configuration

Model tier mapping is controlled via environment variables. Each tier corresponds to an agent class used during deliberation and workflow execution.

| Variable            | Default              | Purpose                         |
|---------------------|----------------------|---------------------------------|
| `AOS_MODEL_ECONOMY`  | claude-haiku-...     | Lightweight / high-volume calls |
| `AOS_MODEL_STANDARD` | claude-sonnet-...    | Standard deliberation agents    |
| `AOS_MODEL_PREMIUM`  | claude-opus-...      | High-stakes reasoning agents    |

Set any of these in your shell or a `.env` file before launching Pi.

Pi differs from the other adapters: it keeps explicit tier models by default instead of deferring to the vendor CLI.

## User Controls During Deliberation

Once a session is running, the following inputs are recognised in the TUI:

| Input      | Effect                                                       |
|------------|--------------------------------------------------------------|
| `/aos-run` | Start a new deliberation                                     |
| `halt`     | Hard-stop the session immediately                            |
| `wrap`     | End early — triggers final statements and memo synthesis     |

When `aos run` launches Pi with an execution profile, the adapter skips arbiter kickoff and runs the workflow directly.

## Architecture

The adapter is organised into four layers, each implemented as a dedicated module:

| Layer           | File                | Responsibility                                      |
|-----------------|---------------------|-----------------------------------------------------|
| Agent Runtime   | `agent-runtime.ts`  | Instantiates and drives individual agent turns      |
| Event Bus       | `event-bus.ts`      | Routes messages between agents and the host shell   |
| UI              | `ui.ts`             | Renders deliberation output inside the Pi TUI       |
| Workflow        | `workflow.ts`       | Orchestrates phases: open, debate, synthesis, memo  |

The adapter entry point (`src/index.ts`) implements the `AOSAdapter` contract defined in the framework runtime, ensuring consistent behaviour across any platform adapter.
