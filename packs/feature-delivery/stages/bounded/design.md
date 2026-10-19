# Bounded: design

Agree on a short design before writing code.

## What to do

1. Read the code the change touches.
2. Present a short design in chat: the approach, the files you expect to touch, and how you will test it. A few paragraphs, not a spec.
3. If the work turns out bigger than a bounded change (a database schema, a migration, authentication, a public API, or a new service), stop and tell the human. They decide whether to start a different run. Do not keep going.

## Skills

Use superpowers:brainstorming when the approach is not obvious.

## Write scope

Writes are allowed only under `docs/specs/`, for a written design if one helps. Code waits for the build stage.

## Model

This stage benefits from a reasoning model.

## Finish

Call `aos_request_approval` with the design summary, then stop and wait for the human. They approve with `aos approve` in their own terminal; never run it yourself. If they ask for changes, revise and request approval again.
