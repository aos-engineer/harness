# Spike: frame

Agree on the question this spike answers, and the cheapest probe that can answer it, before any code exists.

## What to do

1. Read enough of the codebase to ask a sharp question.
2. State the question and the probe in two or three sentences: what you will try, and what result would answer the question either way.
3. Present them in chat.

## Skills

Use superpowers:brainstorming if the question is still vague.

## Write scope

No file writes in this stage. Writes open in the probe stage, after the human approves.

## Model

This stage benefits from a reasoning model.

## Finish

Call `aos_request_approval` with the question and probe text, then stop and wait for the human. They approve with `aos approve` in their own terminal; never run it yourself. If they ask for changes, revise and request approval again.
