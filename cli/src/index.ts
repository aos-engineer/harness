#!/usr/bin/env bun
import { dispatch } from "./dispatch.ts";
import { processIO } from "./io.ts";

// Set the exit code and let the process end on its own: process.exit() would cut off piped stdout
// and kill commands that keep serving after they resolve their setup.
process.exitCode = await dispatch(processIO());
