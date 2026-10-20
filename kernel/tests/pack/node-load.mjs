// Run by Node (not Bun): the Pi host loads packs in-process, so the loader's lazy ajv require and JSON
// schema import must work there too.
const { loadPack } = await import("../../src/index.ts");
const p = loadPack(process.argv[2]);
console.log(JSON.stringify({ instructions: Object.keys(p.instructions), integrity: p.integrity }));
