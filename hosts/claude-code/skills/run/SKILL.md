---
name: run
description: "Start or continue an AOS gated run for a piece of work: risk-tiered stages, observed test evidence, and human approvals. Use when the user types /aos:run or asks to do work under AOS."
---

# Work under an AOS run

AOS splits a piece of work into stages. Each stage ends at a gate, and a gate passes only on evidence: test runs AOS observed itself, reviews you record, and approvals only the human can give. The tools below come from the aos MCP server.

## 1. Start the run

If this session already has an active run (a session-start note names it), call `aos_status` with its run id and continue from its current stage instead of starting another.

Otherwise call `aos_run_start` with the user's request as the brief: the text after `/aos:run`, or the request in the user's own words. Then tell the human the tier and the reason in one sentence.

If `aos_run_start` refuses, stop. Tell the human what it said and ask how to proceed. Do not reword the brief to get a different tier.

## 2. Follow the stage instructions

Each stage comes with instructions, first from `aos_run_start` and then from every `aos_stage_advance` that moves the run on. Follow them, use the skills they name, and keep to the write scope they give. Split the work with `aos_task_add` if it helps, and close each task with `aos_task_complete`: open tasks hold the gate.

## 3. Human gates

When a stage needs the human's approval:

1. Present the design, or the spike's question and probe, in chat.
2. Call `aos_request_approval` with a short summary of it.
3. Pass on the instructions it returns, including the exact command, and end your turn.

Never run `aos approve`, `aos run cancel`, or any other human-only AOS command yourself. Never read, write, or delete anything under `.aos/`. Only the human, in their own terminal, decides a human gate.

## 4. Tests

Run the test command on its own, never piped, chained, or wrapped: no `| tail`, no `|| true`, no `; echo`. AOS observes that command's exit code, and a hidden exit code does not count as a pass.

## 5. Reviews

Record every review with `aos_evidence_record` (kind `review`), with the reviewer's honest status and feedback, including when it asks for changes. Record artifacts, citations, and skills the same way when a stage asks for them.

## 6. Moving on

Call `aos_stage_advance` when a stage's work is done. If it lists gaps, close them and call it again. Call `aos_status` whenever you are unsure where the run stands.

## 7. When a hook blocks you

Read the reason. It lists exactly what is missing. Do that, rather than looking for a way around the block.
