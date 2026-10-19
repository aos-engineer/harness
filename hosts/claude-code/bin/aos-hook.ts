#!/usr/bin/env bun
// Stub entry point: drains the payload and exits 0, so an installed plugin passes every hook through.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
