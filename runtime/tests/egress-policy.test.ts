import { test, expect, describe } from "bun:test";
import {
  MeshEgressPolicy,
  validateEgressUrl,
  isPrivateHost,
  EgressBlockedError,
} from "../src/egress-policy";

describe("MeshEgressPolicy", () => {
  test("blocks private / loopback / link-local / internal targets", () => {
    const blocked = [
      "http://localhost:3000",
      "http://127.0.0.1",
      "https://10.0.0.5/mcp",
      "https://192.168.1.1",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://169.254.169.254/latest/meta-data", // cloud metadata
      "https://100.64.0.1", // CGNAT
      "https://[::1]/mcp",
      "https://service.local",
      "https://db.internal",
    ];
    for (const u of blocked) {
      expect(() => validateEgressUrl(u)).toThrow(EgressBlockedError);
    }
  });

  test("blocks IPv6-embedded-IPv4 SSRF bypasses (NAT64, IPv4-compatible/translated, 6to4)", () => {
    // Each is a different IPv6 spelling of an internal IPv4 target.
    const blocked = [
      "https://[64:ff9b::a9fe:a9fe]", // NAT64 of 169.254.169.254 (cloud metadata)
      "https://[64:ff9b::7f00:1]", // NAT64 of 127.0.0.1
      "https://[::7f00:1]", // IPv4-compatible ::127.0.0.1
      "https://[::a9fe:a9fe]", // IPv4-compatible 169.254.169.254
      "https://[::ffff:0:7f00:1]", // IPv4-translated ::ffff:0:127.0.0.1
      "https://[2002:7f00:1::]", // 6to4 of 127.0.0.1
      "https://[2002:a9fe:a9fe::]", // 6to4 of 169.254.169.254
    ];
    for (const u of blocked) {
      expect(() => validateEgressUrl(u)).toThrow(EgressBlockedError);
      expect(isPrivateHost(new URL(u).hostname)).toBe(true);
    }
    // A genuine global IPv6 is still allowed (no false positive).
    expect(isPrivateHost("[2606:4700:4700::1111]")).toBe(false);
  });

  test("blocks SSRF encoding bypasses (decimal/hex IP, mapped IPv6, trailing dot)", () => {
    const bypasses = [
      "https://2130706433", // decimal 127.0.0.1
      "https://0x7f000001", // hex 127.0.0.1
      "https://0177.0.0.1", // octal 127.0.0.1
      "https://0", // 0.0.0.0
      "https://[::ffff:127.0.0.1]", // IPv4-mapped loopback (normalizes to hex)
      "https://[::ffff:169.254.169.254]", // IPv4-mapped metadata service
      "https://user@10.0.0.1/x", // userinfo does not change the host
      "https://localhost./x", // FQDN trailing dot
      "https://service.local./x",
    ];
    for (const u of bypasses) {
      expect(() => validateEgressUrl(u)).toThrow(EgressBlockedError);
    }
  });

  test("allows public https endpoints", () => {
    expect(validateEgressUrl("https://api.example.com/mcp").hostname).toBe("api.example.com");
    expect(validateEgressUrl("https://8.8.8.8/mcp").hostname).toBe("8.8.8.8");
  });

  test("rejects non-http(s) schemes", () => {
    expect(() => validateEgressUrl("ftp://example.com")).toThrow(EgressBlockedError);
    expect(() => validateEgressUrl("file:///etc/passwd")).toThrow(EgressBlockedError);
    expect(() => validateEgressUrl("not a url")).toThrow(EgressBlockedError);
  });

  test("rejects plain http to a public host (https required)", () => {
    expect(() => validateEgressUrl("http://api.example.com")).toThrow(EgressBlockedError);
  });

  test("allowlist permits a specific private host", () => {
    const policy = new MeshEgressPolicy({ allowlist: ["10.0.0.5", "db.internal:5432"] });
    expect(policy.check("https://10.0.0.5/mcp").hostname).toBe("10.0.0.5");
    expect(policy.check("https://db.internal:5432/x").hostname).toBe("db.internal");
    // a different private host is still blocked
    expect(() => policy.check("https://10.0.0.6/mcp")).toThrow(EgressBlockedError);
  });

  test("allowPrivate permits loopback http (local dev)", () => {
    const policy = new MeshEgressPolicy({ allowPrivate: true });
    expect(policy.check("http://localhost:8080").hostname).toBe("localhost");
    expect(policy.check("https://192.168.0.10").hostname).toBe("192.168.0.10");
  });

  test("isPrivateHost classification", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("169.254.1.1")).toBe(true);
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("foo.local")).toBe(true);
  });
});
