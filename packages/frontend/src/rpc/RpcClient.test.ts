import { Effect, Layer } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { Socket } from "effect/socket";
import { describe, expect, it } from "vite-plus/test";
import { makeShowtimeFrontend } from "../index.js";

class TestWebSocket extends EventTarget {
  static instances: Array<TestWebSocket> = [];
  readyState = 0;

  constructor() {
    super();
    TestWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send() {}

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }
}

describe("RPC connection lifecycle", () => {
  it("rebuilds only the RPC runtime for a new connection attempt", async () => {
    TestWebSocket.instances = [];
    const attempt = Atom.make(0);
    const connected: Array<number> = [];
    const disconnected: Array<number> = [];
    const webSocketConstructor = Layer.succeed(Socket.WebSocketConstructor)(
      () => new TestWebSocket() as unknown as WebSocket,
    );
    const frontend = makeShowtimeFrontend({
      webSocketUrl: "ws://showtime.test/rpc",
      webSocketConstructor,
      connectionLifecycle: {
        attemptSignal: attempt,
        onConnect: (value) => connected.push(value),
        onDisconnect: (value) => disconnected.push(value),
      },
    });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(frontend.showsAtom);

    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(connected).toEqual([0]);

    registry.set(attempt, 1);
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(connected).toEqual([0, 1]);
    expect(disconnected).toContain(0);
    expect(TestWebSocket.instances).toHaveLength(2);
    unmount();
    registry.dispose();
  });
});
