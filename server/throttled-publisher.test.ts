import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledPublisher } from "./throttled-publisher";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function recorder(delayMs = 0) {
  const sent: string[] = [];
  const send = async (value: string) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    sent.push(value);
  };
  return { sent, send };
}

describe("createThrottledPublisher", () => {
  it("sends the latest scheduled value once per interval", async () => {
    const { sent, send } = recorder();
    const publisher = createThrottledPublisher(send, 250, () => {});
    publisher.schedule(() => "a");
    publisher.schedule(() => "b");
    publisher.schedule(() => "c");
    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual(["c"]);
    publisher.schedule(() => "d");
    await vi.advanceTimersByTimeAsync(250);
    expect(sent).toEqual(["c", "d"]);
  });

  it("lands the final value after a slow in-flight send and drops the pending one", async () => {
    const { sent, send } = recorder(100);
    const publisher = createThrottledPublisher(send, 250, () => {});
    publisher.schedule(() => "throttled");
    await vi.advanceTimersByTimeAsync(250);
    publisher.schedule(() => "never sent");
    const finished = publisher.finish("final");
    await vi.advanceTimersByTimeAsync(1000);
    await finished;
    expect(sent).toEqual(["throttled", "final"]);
  });

  it("reports a failed background send and keeps going", async () => {
    const errors: unknown[] = [];
    const sent: string[] = [];
    const publisher = createThrottledPublisher(
      async (value: string) => {
        if (value === "bad") throw new Error("rejected");
        sent.push(value);
      },
      250,
      (error) => errors.push(error),
    );
    publisher.schedule(() => "bad");
    await vi.advanceTimersByTimeAsync(250);
    await publisher.finish("final");
    expect(errors).toHaveLength(1);
    expect(sent).toEqual(["final"]);
  });

  it("rejects now() when its send fails", async () => {
    const publisher = createThrottledPublisher(
      async () => {
        throw new Error("rejected");
      },
      250,
      () => {},
    );
    await expect(publisher.now("first")).rejects.toThrow("rejected");
  });
});
