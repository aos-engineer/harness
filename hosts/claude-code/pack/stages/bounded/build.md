# Bounded: build

Implement the approved design, test first.

## What to do

1. Write a failing test, watch it fail, then make it pass. Repeat.
2. Add tasks with `aos_task_add` if the work splits naturally. The gate requires every task to be done.
3. Run the test command by itself and in full: no pipes, no `|| true`, nothing chained after it, no added arguments or redirections. AOS observes that command's exit status; a masked status, or a run narrowed to some tests, does not count as a pass.
4. Commit as you go if you like. Commits are allowed from this stage.
5. The oracle in `aos-oracle.txt` is frozen: AOS refuses edits to it, and every gate fails while it differs from what was approved. Put new tests of your own outside it. If a frozen test is wrong, stop and tell the human.

## Skills

Use superpowers:test-driven-development.

## Write scope

Anywhere in the repository except `.aos/` and the frozen oracle.

Never run human-only commands such as `aos approve` or `aos run cancel`, and never read or write `.aos/`.

## Model

A fast model is enough for this stage.

## Finish

When the tests pass at the current tree, call `aos_stage_advance`. An edit after the last passing run needs a new run. If the gate reports missing evidence, do what it says and call it again.
