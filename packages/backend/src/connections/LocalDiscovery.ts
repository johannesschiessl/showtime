import {
  Context,
  Effect,
  Fiber,
  Layer,
  Ref,
  Schema,
  Semaphore,
  SubscriptionRef,
  type Fiber as FiberType,
} from "effect";
import { HttpServer } from "effect/http";
import {
  type ShowtimeHostName,
  ShowtimeHostnameLabel,
  type ShowtimeHostnameConnectionCandidate,
  type ShowtimeLocalDiscoveryState,
  showtimeHostnameLabel,
  showtimeHostnamePairingUrl,
  showtimeLocalHostname,
} from "@showtime/shared";
import * as Settings from "../settings/Settings.js";
import { MdnsAdvertiser, MdnsAdvertiserError, type MdnsAdvertisement } from "./MdnsAdvertiser.js";

export class LocalDiscovery extends Context.Service<
  LocalDiscovery,
  {
    readonly state: Effect.Effect<ShowtimeLocalDiscoveryState>;
    readonly pairingCandidate: (
      pairingToken: string,
    ) => Effect.Effect<ShowtimeHostnameConnectionCandidate | undefined>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void>;
    readonly setHostName: (hostName: ShowtimeHostName) => Effect.Effect<void>;
  }
>()("@showtime/backend/connections/LocalDiscovery") {}

export interface LocalDiscoveryOptions {
  readonly port: number;
  readonly runtimeEnabled: boolean;
}

const make = (options: LocalDiscoveryOptions) =>
  Effect.gen(function* () {
    // Requiring the acquired server makes advertisement startup and finalization ordered around TCP.
    yield* HttpServer.HttpServer;
    const scope = yield* Effect.scope;
    const advertiser = yield* MdnsAdvertiser;
    const settings = yield* Settings.Settings;
    const initialSettings = yield* settings.get;
    const configuredLabel = yield* Ref.make(showtimeHostnameLabel(initialSettings.hostName));
    const currentState = yield* SubscriptionRef.make<ShowtimeLocalDiscoveryState>({
      kind: "disabled",
    });
    const worker = yield* Ref.make<FiberType.Fiber<void, never> | undefined>(undefined);
    const transitionLock = yield* Semaphore.make(1);

    const setState = (state: ShowtimeLocalDiscoveryState) =>
      SubscriptionRef.set(currentState, state);
    const release = (advertisement: MdnsAdvertisement) =>
      advertisement.shutdown.pipe(
        Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.void }),
      );

    const waitForAdvertiser = (advertisement: MdnsAdvertisement) =>
      advertisement.nextEvent.pipe(
        Effect.flatMap((event) => {
          if (event.kind === "failed") return Effect.fail(event.error);
          return Effect.fail(
            new MdnsAdvertiserError({
              operation: "republish",
              cause: new Error("The fixed local hostname changed unexpectedly"),
            }),
          );
        }),
      );

    const runAttempt = (attempt: number): Effect.Effect<void, never> =>
      Effect.acquireRelease(
        Ref.get(configuredLabel).pipe(
          Effect.flatMap((label) =>
            advertiser.advertise({ preferredLabel: label, port: options.port }),
          ),
        ),
        release,
      ).pipe(
        Effect.flatMap((advertisement) =>
          setState({
            kind: "announced",
            hostname: showtimeLocalHostname(advertisement.hostnameLabel),
          }).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `Easy local address announced as ${showtimeLocalHostname(advertisement.hostnameLabel)}`,
              ),
            ),
            Effect.andThen(waitForAdvertiser(advertisement)),
          ),
        ),
        Effect.scoped,
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* setState({ kind: "degraded", reason: "network-unavailable" });
            if (attempt === 0) {
              yield* Effect.logWarning(
                "Easy local address is unavailable; using IP addresses",
              ).pipe(Effect.annotateLogs("operation", cause.operation));
            }
            const cappedMilliseconds = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
            const jitter = yield* Effect.sync(() => Math.floor(Math.random() * 250));
            yield* Effect.sleep(`${cappedMilliseconds + jitter} millis`);
            yield* setState({ kind: "probing" });
            return yield* runAttempt(attempt + 1);
          }),
        ),
      );

    const start = Effect.gen(function* () {
      yield* setState({ kind: "probing" });
      const fiber = yield* Effect.forkIn(runAttempt(0), scope);
      yield* Ref.set(worker, fiber);
    });

    const stop = Effect.gen(function* () {
      const running = yield* Ref.get(worker);
      if (running !== undefined) yield* Fiber.interrupt(running);
      yield* Ref.set(worker, undefined);
    });

    const setEnabled = (enabled: boolean) =>
      transitionLock.withPermits(1)(
        Effect.gen(function* () {
          const running = yield* Ref.get(worker);
          const shouldRun = options.runtimeEnabled && enabled;
          if (shouldRun && running === undefined) {
            yield* start;
          } else if (!shouldRun) {
            yield* stop;
            yield* setState({ kind: "disabled" });
          }
        }),
      );

    const setHostName = (hostName: ShowtimeHostName) =>
      transitionLock.withPermits(1)(
        Effect.gen(function* () {
          const nextLabel = showtimeHostnameLabel(hostName);
          if ((yield* Ref.get(configuredLabel)) === nextLabel) return;
          yield* Ref.set(configuredLabel, nextLabel);
          const running = yield* Ref.get(worker);
          if (running !== undefined) {
            yield* stop;
            yield* start;
          }
        }),
      );

    yield* setEnabled(initialSettings.connectionsEnabled);

    return LocalDiscovery.of({
      state: SubscriptionRef.get(currentState),
      pairingCandidate: (pairingToken) =>
        SubscriptionRef.get(currentState).pipe(
          Effect.map((state) => {
            if (state.kind !== "announced") return undefined;
            const hostnameLabel = Schema.decodeUnknownSync(ShowtimeHostnameLabel)(
              state.hostname.replace(/\.local$/i, ""),
            );
            return {
              kind: "hostname" as const,
              label: `Recommended — ${state.hostname}`,
              host: state.hostname,
              hostnameLabel,
              url: showtimeHostnamePairingUrl(hostnameLabel, pairingToken, options.port),
            };
          }),
        ),
      setEnabled,
      setHostName,
    });
  });

export const layer = (options: LocalDiscoveryOptions) =>
  Layer.effect(LocalDiscovery, make(options));
