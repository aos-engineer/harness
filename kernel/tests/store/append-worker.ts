// Child process for the concurrency test: appends `count` events to one run, one appendEvents call each,
// the way separate hook processes do.
import { appendEvents } from "../../src/store/store.ts";
import { worktreeDraft } from "./fixtures.ts";
import { testProjector } from "./test-projector.ts";

const [root, run, count] = process.argv.slice(2);
if (!root || !run || !count) {
  console.error("usage: append-worker.ts <root> <run> <count>");
  process.exit(2);
}
for (let i = 0; i < Number(count); i++) {
  appendEvents({ root, run }, [worktreeDraft(i, `worker-${process.pid}/${i}`)], testProjector);
}
