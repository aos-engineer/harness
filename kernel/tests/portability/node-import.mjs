// Loaded by Node (not Bun) to prove the kernel barrel is portable.
const { ulid } = await import("../../src/index.ts");
console.log(ulid());
