export interface AdapterProbeMetadata extends Record<string, string | undefined> {
  runtime?: string;
  install_surface?: string;
  execution_profiles?: "supported" | "unsupported";
  deliberation_profiles?: "supported" | "unsupported";
  transcript_streaming?: "local" | "local+platform" | "unsupported";
}

export interface AdapterProbeInfo {
  info?: Record<string, string>;
}

export function createAdapterProbeInfo(
  info: AdapterProbeMetadata = {},
): AdapterProbeInfo {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(info)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? { info: normalized } : {};
}

export async function probeAdapterInfo(_opts?: { timeoutMs?: number }): Promise<AdapterProbeInfo> {
  return createAdapterProbeInfo();
}
