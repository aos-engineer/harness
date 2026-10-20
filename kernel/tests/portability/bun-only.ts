// Source patterns that only run under Bun. The kernel must load in-process under Node (the Pi host).
// Covers bun: specifiers in any import form (static, side-effect, dynamic, require) and Bun's import.meta extras.
export const BUN_ONLY = /\bBun\.|["']bun:|import\.meta\.(?:dir|file|path|main)\b/;
