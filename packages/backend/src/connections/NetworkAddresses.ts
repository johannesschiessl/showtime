import { Context, Effect, Layer } from "effect";
import { networkInterfaces } from "node:os";
import type { ShowtimeConnectionCandidate } from "@showtime/shared";
import { showtimePairingUrl } from "@showtime/shared";

export class NetworkAddresses extends Context.Service<
  NetworkAddresses,
  {
    readonly candidates: (
      port: number,
      pairingToken: string,
    ) => Effect.Effect<ReadonlyArray<ShowtimeConnectionCandidate>>;
  }
>()("@showtime/backend/connections/NetworkAddresses") {}

const isPrivateIpv4 = (address: string) =>
  address.startsWith("10.") ||
  address.startsWith("192.168.") ||
  address.startsWith("169.254.") ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address);

export const discoverCandidates = (
  interfaces: ReturnType<typeof networkInterfaces>,
  port: number,
  pairingToken: string,
): ReadonlyArray<ShowtimeConnectionCandidate> =>
  Object.entries(interfaces)
    .flatMap(([interfaceName, addresses]) =>
      (addresses ?? [])
        .filter(
          (address) =>
            !address.internal &&
            (address.family === "IPv4"
              ? isPrivateIpv4(address.address)
              : address.family === "IPv6" &&
                address.scopeid === 0 &&
                !/^fe[89ab][0-9a-f]:/i.test(address.address) &&
                !address.address.toLowerCase().startsWith("ff")),
        )
        .map((address) => ({
          kind: "ip-address" as const,
          label: `${interfaceName} — ${address.address}`,
          host: address.address,
          interfaceName,
          url: showtimePairingUrl(address.address, pairingToken, port),
        })),
    )
    .sort((left, right) => left.interfaceName.localeCompare(right.interfaceName));

export const layer = Layer.succeed(
  NetworkAddresses,
  NetworkAddresses.of({
    candidates: (port, pairingToken) =>
      Effect.sync(() => discoverCandidates(networkInterfaces(), port, pairingToken)),
  }),
);
