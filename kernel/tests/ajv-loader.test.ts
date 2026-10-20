import { afterEach, expect, test } from "bun:test";
import { loadAjv, provideAjv } from "../src/util/ajv.ts";

afterEach(() => provideAjv(null));

test("loadAjv requires ajv on first use when nothing was provided", () => {
  expect(typeof loadAjv().Ajv).toBe("function");
});

// A bundled build cannot follow the runtime require, so its entry point hands ajv over up front.
test("loadAjv returns the module a bundled entry point provided", () => {
  class FakeAjv {}
  provideAjv({ Ajv: FakeAjv } as unknown as typeof import("ajv"));
  expect(loadAjv().Ajv as unknown).toBe(FakeAjv);
});
