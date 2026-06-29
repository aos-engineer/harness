# Contributing to the AOS Community Registry

The AOS community registry is the central index of agents, profiles, and domains available for the AOS Harness. This document describes how to submit your own.

## Submission Process

1. **Fork** the [aos-harness](https://github.com/aos-engineer/aos-harness) repository.
2. **Create** your agent, profile, or domain following the AOS schemas (`aos/agent/v1`, `aos/profile/v1`, `aos/domain/v1`).
3. **Add an entry** to `registry/registry.json` in the appropriate array (`agents`, `profiles`, or `domains`).
4. **Run validation** locally to confirm your entry passes:
   ```bash
   bun run registry/validate.ts
   ```
5. **Submit a pull request** against the `main` branch.
6. CI will automatically validate schema compliance and ID uniqueness.
7. A maintainer will review and merge your PR.

## Namespace Rules

Every registry entry has an `id` in `namespace/name` format.

- **Pattern:** `^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$`
- **Reserved namespace:** `aos` is reserved for official built-in entries. Do not use it.
- **Choose your namespace:** Use your GitHub username, organization name, or a consistent project identifier.
  - Good: `acme/fraud-detector`, `jsmith/devops-sentinel`
  - Bad: `MyCompany/Agent1`, `test/test`

## Quality Criteria

All submissions must meet these standards:

- **Description** must be 200 characters or fewer and clearly explain what the entry does.
- **Tags** must include at least one relevant tag for discoverability.
- **Version** must follow [semantic versioning](https://semver.org/) (e.g., `1.0.0`).
- **Source** must be a valid URI pointing to the source code or documentation.
- **Schema compliance** — agents must follow `aos/agent/v1`, profiles must follow `aos/profile/v1`, domains must follow `aos/domain/v1`.
- **Unique ID** — no two entries in the same category may share an `id`.

### Agents

- Must include `compatible_profiles` listing which profiles the agent works with.
- Must include `schema_version` (e.g., `aos/agent/v1`).

### Profiles

- Must include `agent_count` — the total number of agents (orchestrator + perspectives + operational) in the assembly.

### Domains

- Must include domain-specific lexicon, overlays, or both in the actual YAML file.

## Example Entry

Adding a custom agent to the registry:

```json
{
  "id": "acme/fraud-detector",
  "name": "Fraud Detector",
  "author": "acme-corp",
  "description": "Specialized fraud detection agent for e-commerce transaction analysis. Evaluates payment patterns and flags anomalies.",
  "tags": ["fraud", "e-commerce", "security", "payments"],
  "source": "https://github.com/acme-corp/aos-fraud-detector",
  "version": "1.0.0",
  "compatible_profiles": ["aos/security-review", "aos/incident-response"],
  "schema_version": "aos/agent/v1"
}
```

## Questions

Open an issue on the [aos-harness](https://github.com/aos-engineer/aos-harness) repository if you have questions about the submission process or need help structuring your entry.
