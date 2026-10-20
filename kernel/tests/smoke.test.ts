import { expect, test } from "bun:test";

test("workspace resolves the kernel package", async () => {
  expect((await import("@aos-harness/kernel")).GENESIS_PREV).toStartWith("sha256:");
});
