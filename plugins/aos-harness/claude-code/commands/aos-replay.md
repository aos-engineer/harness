---
allowed-tools: Bash(plugins/aos-harness/scripts/aos_cli.sh replay:*)
argument-hint: <transcript.jsonl>
description: Replay an AOS session transcript
---

Run the shared AOS wrapper to replay the requested transcript.

Command output:
!`plugins/aos-harness/scripts/aos_cli.sh replay $ARGUMENTS`

Summarize the replayed session or surface the exact error if the transcript path
is missing or malformed.
