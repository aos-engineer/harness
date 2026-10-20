# Bounded: verify

Confirm the change works and has been reviewed before it leaves this machine.

## What to do

1. If the tree changed since the last passing test run, run the test command again, by itself.
2. Get a code review of the whole change.
3. Record it with `aos_evidence_record`, kind `review`, with the reviewer's honest status and feedback. If the review asks for changes, fix them, re-test, and review again.
4. Any edit after the review needs a new review.

## Skills

Use superpowers:requesting-code-review to get the review, and superpowers:verification-before-completion before you claim the work is done.

## Write scope

Anywhere in the repository except `.aos/`.

Never run human-only commands such as `aos approve` or `aos run cancel`, and never read or write `.aos/`.

## Model

This stage benefits from a reasoning model.

## Finish

Call `aos_stage_advance`. Push and pull request creation unlock once this gate passes.
