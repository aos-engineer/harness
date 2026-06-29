# Domain Enforcement

Domain enforcement provides structural, code-enforced file and tool permission boundaries per agent. These are not advisory prompts or instructions written into a system prompt -- they are real constraints evaluated at the adapter layer that block tool calls before execution ever begins. An agent cannot read, write, or delete a file outside its allowed paths, and cannot invoke a tool that is not permitted for its role.

## Adding Domain Rules to an Agent

Add a `domain` field to `agent.yaml` to declare what the agent is allowed to touch:

```yaml
domain:
  rules:
    - path: "src/api/**"        # Glob pattern matched against the requested file path
      read: true
      write: true
      delete: false
    - path: "src/config/**"
      read: true
      write: false              # Config is read-only for this agent
      delete: false
    - path: "**/*.env*"
      read: false               # Environment files completely blocked
      write: false
      delete: false
  tool_allowlist:               # Only these tools are available to this agent
    - read
    - write
    - edit
    - grep
    - glob
  tool_denylist:                # Blocked even if the tool appears in the allowlist
    - bash
  bash_restrictions:            # If bash IS allowed, these command patterns are blocked
    blocked_tokens:
      - tokens: ["rm", "recursive"]
        aliases: { recursive: ["-r", "-R", "--recursive"] }
      - tokens: ["git", "push"]
      - tokens: ["git", "reset"]
    blocked_patterns: ["curl.*-X DELETE"]
```

Rules are evaluated in specificity order (see [Path Matching Algorithm](#path-matching-algorithm) below). Each rule grants or denies `read`, `write`, and `delete` independently. A path that matches no rule is denied by default.

## Path Matching Algorithm

Rules are matched using glob patterns. When a file operation is requested, every rule whose pattern matches the target path is collected. The winner is determined by **specificity** -- the number of literal path segments in the pattern (segments without wildcards).

- `apps/web/**` has specificity 2 (`apps`, `web`)
- `apps/web/components/**` has specificity 3 (`apps`, `web`, `components`)

When two rules match the same path, the more specific rule wins. If two matching rules have equal specificity and one denies, the deny wins.

Examples:

| Request | Matching rules | Winner | Outcome |
|---|---|---|---|
| Write `apps/web/components/Button.tsx` | `apps/web/**` (specificity 2, allows write), `apps/web/components/**` (specificity 3, denies write) | specificity 3 | Denied |
| Write `apps/web/page.tsx` | `apps/web/**` (specificity 2, allows write) | specificity 2 | Allowed |

Paths that match no rule are denied by default. Always add an explicit rule for every path the agent legitimately needs to access.

## Tool Access Control

The `tool_allowlist` and `tool_denylist` fields control which tools an agent can invoke:

- If neither is defined, all tools are permitted.
- If `tool_allowlist` is defined, only the listed tools are permitted. Any tool not in the list is blocked.
- If `tool_denylist` is defined, the listed tools are always blocked -- even if they appear in the allowlist. The denylist takes precedence.

This means you can define a broad allowlist and use the denylist to carve out specific exceptions without rewriting the full list.

## Bash Restrictions

When `bash` is included in the allowlist, the `bash_restrictions` field adds a layer of command-level filtering.

### Token-Based Detection

`blocked_tokens` rules define sets of tokens that must not appear together in a single command. Detection is order-independent: the runtime expands aliases and checks for co-occurrence of the full token set anywhere in the command string.

For example, a rule with `tokens: ["rm", "recursive"]` and `aliases: { recursive: ["-r", "-R", "--recursive"] }` will block:

- `rm -rf /tmp/build`
- `rm -r -f /tmp/build`
- `rm --recursive --force /tmp/build`

All three trigger the same rule because the alias expansion maps `-r`, `-R`, and `--recursive` to the `recursive` token. The match fires as soon as all tokens in the set are present, regardless of order or flags interleaved between them.

### Pattern-Based Detection

`blocked_patterns` are evaluated as regular expressions against the full command string. These are useful for blocking constructs that cannot be expressed cleanly as token sets:

```yaml
blocked_patterns: ["curl.*-X DELETE"]
```

Patterns are checked after token expansion, as a fallback for command shapes that are difficult to enumerate with discrete tokens.

### Safety Scope

Bash restrictions are a heuristic safety net -- they raise the cost of accidental or unintended dangerous commands. They are not a security sandbox. A determined agent with bash access can still construct commands that avoid matching. Use `tool_denylist: [bash]` to fully remove bash access when it is not needed.

## Profile-Level Overrides

A profile can override an agent's domain rules for a specific assembly context using `domain_override`. This is useful when the same agent participates in both restricted operational contexts and broader exploratory profiles:

```yaml
assembly:
  perspectives:
    - agent: architect
      domain_override:
        rules:
          - path: "**"
            read: true
            write: true          # Full access in this profile context
```

`domain_override` replaces the agent's `domain.rules` entirely for that profile assembly. Tool allowlists and denylists from the base agent definition remain in effect unless also overridden.

## Domain Inheritance for Child Agents

When an agent spawns child agents (in nested orchestration), children inherit the parent's domain as a ceiling. Permissions are ANDed -- a child can only have permissions that the parent also has.

If the parent domain allows `src/** → write: true` and a child agent is configured with `src/** → delete: true`, the delete permission is silently denied at runtime because the parent does not grant delete on that path.

This ensures that a child agent cannot escalate its own privileges beyond what the spawning agent was allowed to do. The parent's domain acts as the upper bound; the child's domain can be equal to or more restrictive, never more permissive.

## Troubleshooting

### `no matching rule for path "X"`

The file path did not match any rule in the agent's domain configuration. Domain enforcement is deny-by-default -- unmatched paths are blocked. Add an explicit rule covering the path:

```yaml
rules:
  - path: "src/generated/**"
    read: true
    write: true
    delete: false
```

### `tool "X" is in denylist`

The tool is explicitly blocked via `tool_denylist`. Either remove it from the denylist, or use a different tool that achieves the same goal. If bash is the blocked tool, consider whether `read`, `grep`, or `glob` can replace the specific command needed.

### `tool "X" is not in allowlist`

A `tool_allowlist` is defined for this agent and the requested tool is not included. Add the tool to the allowlist:

```yaml
tool_allowlist:
  - read
  - grep
  - glob
  - bash           # Add the missing tool here
```

### `bash command matches blocked token set: [X, Y]`

The command contains a combination of tokens (after alias expansion) that matches a `blocked_tokens` rule. Review the command to determine whether it is genuinely needed. If it is, and the restriction is overly broad, adjust the `bash_restrictions` configuration in the agent's domain definition or use a more targeted `blocked_patterns` entry instead.
