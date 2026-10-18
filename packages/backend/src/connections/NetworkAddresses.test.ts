import type { networkInterfaces } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { discoverCandidates } from "./NetworkAddresses.js";

const address = (value: string) => ({
  address: value,
  family: "IPv4" as const,
  internal: false,
  netmask: "255.255.255.0",
  cidr: `${value}/24`,
  mac: "00:00:00:00:00:00",
});

const ipv6 = (value: string, scopeid = 0) => ({
  address: value,
  family: "IPv6" as const,
  internal: false,
  netmask: "ffff:ffff:ffff:ffff::",
  cidr: `${value}/64`,
  mac: "00:00:00:00:00:00",
  scopeid,
});

describe("discoverCandidates", () => {
  it("includes DHCP-free IPv4 and ULA IPv6 without offering scoped IPv6 URLs", () => {
    const candidates = discoverCandidates(
      {
        ethernet: [
          address("169.254.10.2"),
          ipv6("fd00::2"),
          ipv6("2001:db8::2"),
          ipv6("fe80::2", 3),
        ],
      },
      8585,
      "token",
    );
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "http://169.254.10.2:8585/#pair=token",
      "http://[fd00::2]:8585/#pair=token",
      "http://[2001:db8::2]:8585/#pair=token",
    ]);
  });
  it("rejects the full IPv6 link-local range even when its scope id is zero", () => {
    const candidates = discoverCandidates(
      {
        ethernet: [
          ipv6("fe80::2"),
          ipv6("fe90::2"),
          ipv6("fea0::2"),
          ipv6("feBf::2"),
          ipv6("fe7f::2"),
          ipv6("fec0::2"),
        ],
      },
      8585,
      "token",
    );

    expect(candidates.map((candidate) => candidate.host)).toEqual(["fe7f::2", "fec0::2"]);
  });
  it("only exposes private LAN IPv4 addresses", () => {
    const interfaces = {
      ethernet: [address("192.168.1.20"), address("203.0.113.10")],
      wifi: [address("10.0.0.8"), address("172.31.4.5"), address("172.32.4.5")],
    } as ReturnType<typeof networkInterfaces>;

    expect(discoverCandidates(interfaces, 4010, "pairing-token")).toEqual([
      {
        kind: "ip-address",
        label: "ethernet — 192.168.1.20",
        host: "192.168.1.20",
        interfaceName: "ethernet",
        url: "http://192.168.1.20:4010/#pair=pairing-token",
      },
      {
        kind: "ip-address",
        label: "wifi — 10.0.0.8",
        host: "10.0.0.8",
        interfaceName: "wifi",
        url: "http://10.0.0.8:4010/#pair=pairing-token",
      },
      {
        kind: "ip-address",
        label: "wifi — 172.31.4.5",
        host: "172.31.4.5",
        interfaceName: "wifi",
        url: "http://172.31.4.5:4010/#pair=pairing-token",
      },
    ]);
  });
});
