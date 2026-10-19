# Bounded: build

Implement the approved design, test first.

## What to do

1. Write a failing test, watch it fail, then make it pass. Repeat.
2. Add tasks with `aos_task_add` if the work splits naturally. The gate requires every task to be done.
3. Run the test command by itself: no pipes, no `|| true`, nothing chained after it. AOS observes that command's exit status, and a masked status does not count as a pass.
4. Commit as you go if you like. Commits are allowed from this stage.

## Skills

Use superpowers:test-driven-development.

## Write scope

Anywhere in the repository except `.aos/`.

## Model

A fast model is enough for this stage.

## Finish

When the tests pass at the current tree, call `aos_stage_advance`. An edit after the last passing run needs a new run. If the gate reports missing evidence, do what it says and call it again.
