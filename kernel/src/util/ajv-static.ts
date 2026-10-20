// Side-effect module for entry points that get bundled (the plugin's MCP server, the CLI). It imports ajv
// statically, so a bundler includes it, and hands it to the kernel's lazy loader. Hook entry points must not
// import it: they never validate, and loading ajv would slow every tool call.
import * as ajv from "ajv";
import { provideAjv } from "./ajv.ts";

provideAjv(ajv as unknown as typeof import("ajv"));
