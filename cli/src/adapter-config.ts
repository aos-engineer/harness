import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export interface AdapterConfig {
  platform?: string;
  model_overrides?: Partial<Record<string, string>>;
  use_vendor_default_model?: boolean;
  theme?: string;
  editor?: string;
}

export function readAdapterConfig(root: string): AdapterConfig | null {
  const p = join(root, ".aos", "adapter.yaml");
  if (!existsSync(p)) return null;
  return yaml.load(readFileSync(p, "utf-8"), { schema: yaml.JSON_SCHEMA }) as AdapterConfig;
}
