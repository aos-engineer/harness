# Bounded: design

Agree on a short design, and on the tests that will judge it, before writing code.

## What to do

1. Read the code the change touches.
2. Present a short design in chat: the approach, the files you expect to touch, and how you will test it. A few paragraphs, not a spec.
3. Write or pick the acceptance tests that prove the change and list them in `aos-oracle.txt` at the repository root, one path per line. Also list the config they run under and the script your test command runs through, such as `package.json#/scripts/test`. If the file already lists the right tests, keep it.
4. If the work turns out bigger than a bounded change (a database schema, a migration, authentication, a public API, or a new service), stop and tell the human. They decide whether to start a different run. Do not keep going.

## Skills

Use superpowers:brainstorming when the approach is not obvious.

## Write scope

`docs/specs/`, plus `aos-oracle.txt` and everything it lists. Code waits for the build stage.

## Model

This stage benefits from a reasoning model.

## Finish

Call `aos_request_approval` with the design summary and the oracle's entries, then stop and wait for the human. They approve with `aos approve` in their own terminal; never run it yourself. If they ask for changes, revise and request approval again. The oracle freezes when build begins; changing it after the request means requesting approval again.
