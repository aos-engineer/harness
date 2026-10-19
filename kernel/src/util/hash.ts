import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The tagged form used in events and evidence, so the algorithm travels with the digest. */
export function sha256Tag(data: string | Uint8Array): string {
  return "sha256:" + sha256Hex(data);
}
