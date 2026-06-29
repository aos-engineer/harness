# Paperclip seam

The HTTP seam between **Paperclip** (a control plane) and this **AOS-Harness**
(execution plane). One wake = one Council+Crew pass: the worker picks up an
issue, runs an AOS execution pass over it, posts the work product back for
review, and reports cost + liveness. The worker **never** marks an issue `done`
and **never** publishes — a human reviews and approves.

It is domain-agnostic: point it at your own execution profile (via
`PAPERCLIP_PROFILE_DIR`) to build whatever your business needs on top of the
seam. The bundled `paperclip-worker` profile is a generic reference.

## Flow (per wake)

```
POST /paperclip/wake (202)
  -> identity (GET /api/agents/me)
  -> budget gate (exhausted => no-op, liveness blocked)
  -> approval (read-only, if PAPERCLIP_APPROVAL_ID)
  -> inbox / issue (GET issue or company issues)
  -> checkout (POST /api/issues/{id}/checkout, X-Paperclip-Run-Id; 409 => stop)
  -> run one AOS execution pass (worker profile + workflow)  -- the part Paperclip never sees
  -> comment (work product) + PATCH status in_review   (NEVER done)
  -> cost (POST /api/costs)
  -> liveness (PATCH /api/heartbeat-runs/{runId})  -- completed | blocked | failed | empty_response
```

## Files

| File | Role |
|---|---|
| `server.ts` | Bun.serve entrypoint; wires config -> runner. Container CMD. |
| `http.ts` | Pure request handler (`/healthz`, `/paperclip/wake`, A2A ingress); auth + 202 ack. |
| `a2a-ingress.ts` | Adapts an `A2aServer` into the HTTP handler's optional A2A ingress. |
| `worker-runner.ts` | The per-wake heartbeat orchestration (injectable deps). |
| `paperclip-client.ts` | All Paperclip callbacks; every endpoint centralized here. |
| `pass-runner.ts` | Real AOS engine pass (claude-code adapter). |
| `brief.ts` | Issue -> brief markdown for the execution profile. |
| `package-builder.ts` | Work-product comment assembly + the failed-path message. |
| `config.ts` | Env-driven config; `redactConfig` for safe logging. |
| `types.ts` | Shared types (the Paperclip wire contract). |

The worker's AOS config lives in the repo's `core/`: the bundled
`core/profiles/paperclip-worker/` profile and
`core/workflows/paperclip-worker/workflow.yaml` (directory convention — the
engine resolves `profile.workflow` to `<workflowsDir>/<workflow>/workflow.yaml`),
using the generic agents under `core/agents/`.

## Environment (names only — values injected at deploy time, never in code)

| Var | Purpose |
|---|---|
| `PORT` | Listen port (default 8080). |
| `PAPERCLIP_WAKE_TOKEN` | Bearer token required on `/paperclip/wake`. |
| `PAPERCLIP_API_BASE` | Paperclip base URL. |
| `PAPERCLIP_API_KEY` | Agent API key for callbacks. |
| `ANTHROPIC_API_KEY` | Provider key for the claude-code adapter (the `claude` CLI). |
| `AOS_HARNESS_ROOT` | Repo root (defaults to cwd; `/app` in the image). |
| `AOS_PLATFORM` | AOS adapter platform (default `claude-code`). |
| `PAPERCLIP_PROFILE_DIR` | Execution profile dir (default `core/profiles/paperclip-worker`). |
| `PAPERCLIP_WORKFLOWS_DIR` | Workflows dir (default `core/workflows`). |

## Run / test

```bash
bun run cli/src/paperclip/server.ts      # start the wake server
bun test tests/paperclip                 # hermetic tests (no secrets, no network, no claude CLI)
```

Build the image with `Dockerfile.paperclip` (root). Tests inject a fake `fetch`
and a fake pass, so they run with no real Paperclip, model, or secrets.
