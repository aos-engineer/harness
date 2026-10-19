# Spike: probe

Run the approved probe and answer the question with evidence, as cheaply as correctness allows.

## What to do

1. Build only what the probe needs. Code here is throwaway.
2. Show the result the question asked about. Prefer a real run over reasoning about one.
3. Commit if it helps you keep track. Spike code can never be pushed or opened as a pull request; if the answer is "build it", that is a new bounded run.
4. Report findings as a recommendation: what you found, how sure you are, and what you would do next.

## Skills

None bound to this stage.

## Write scope

Anywhere in the repository except `.aos/`.

## Model

A fast model is enough for this stage.

## Finish

Call `aos_stage_advance` once the recommendation is in chat.
