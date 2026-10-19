# Bounded: design

Agree on a short design before writing code.

## What to do

1. Read the code the change touches.
2. Present a short design in chat: the approach, the files you expect to touch, and how you will test it. A few paragraphs, not a spec.
3. If the change reaches a schema, a migration, authentication, a public API, or a new service, say so before going further: it is bigger than a bounded change.

## Skills

Use superpowers:brainstorming when the approach is not obvious.

## Write scope

Writes are allowed only under `docs/specs/`, for a written design if one helps. Code waits for the build stage.

## Model

This stage benefits from a reasoning model.

## Finish

Call `aos_request_approval` with the design summary, then stop and wait for the human. They approve with `aos approve` in their own terminal; never run it yourself. If they ask for changes, revise and request approval again.
