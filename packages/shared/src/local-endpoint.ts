import { Hash, Schema } from "effect";

export const showtimeLocalPort = 8585;
export const showtimeLocalBaseLabel = "showtime";
export const showtimeHostNameMaxLength = 54;

const hostNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const ShowtimeHostName = Schema.String.check(
  Schema.isPattern(hostNamePattern, {
    expected: "a lowercase device name using letters, numbers, and hyphens",
  }),
  Schema.isMaxLength(showtimeHostNameMaxLength),
);
export type ShowtimeHostName = typeof ShowtimeHostName.Type;

const hostnameLabelPattern = /^showtime-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const ShowtimeHostnameLabel = Schema.String.check(
  Schema.isPattern(hostnameLabelPattern, { expected: "a Showtime .local hostname label" }),
  Schema.isMaxLength(63),
);
export type ShowtimeHostnameLabel = typeof ShowtimeHostnameLabel.Type;

export const normalizeShowtimeHostName = (value: string): ShowtimeHostName => {
  const canonicalValue = value.normalize("NFKD").toLowerCase();
  const normalized = canonicalValue
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, showtimeHostNameMaxLength)
    .replace(/-+$/g, "");
  const fallback = `device-${Hash.string(canonicalValue).toString(36)}`;
  return Schema.decodeUnknownSync(ShowtimeHostName)(normalized || fallback);
};

export const showtimeHostnameLabel = (hostName: ShowtimeHostName): ShowtimeHostnameLabel =>
  Schema.decodeUnknownSync(ShowtimeHostnameLabel)(`${showtimeLocalBaseLabel}-${hostName}`);

export const showtimeLocalHostname = (label: ShowtimeHostnameLabel) => `${label}.local`;

export const showtimePairingUrl = (host: string, pairingToken: string, port = showtimeLocalPort) =>
  `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/#pair=${encodeURIComponent(pairingToken)}`;

export const showtimeHostnamePairingUrl = (
  label: ShowtimeHostnameLabel,
  pairingToken: string,
  port = showtimeLocalPort,
) => showtimePairingUrl(showtimeLocalHostname(label), pairingToken, port);
