export interface ThrottledPublisher<Value> {
  // Sends after any send already in flight. Rejects if this send fails.
  now(value: Value): Promise<void>;
  // Sends the latest requested value at most once per interval. `build` runs only when it sends.
  schedule(build: () => Value): void;
  // Drops any pending scheduled send, then sends the value after everything already in flight.
  finish(value: Value): Promise<void>;
}

const ignore = () => undefined;

export function createThrottledPublisher<Value>(
  send: (value: Value) => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void,
): ThrottledPublisher<Value> {
  // Sends run one at a time in order, so a late throttled value can never land after the final one.
  let tail: Promise<void> = Promise.resolve();
  let pending: (() => Value) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function enqueue(build: () => Value): Promise<void> {
    const sent = tail.then(() => send(build()));
    tail = sent.then(ignore, ignore);
    return sent.then(ignore);
  }

  return {
    now: (value) => enqueue(() => value),
    schedule(build) {
      pending = build;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) enqueue(next).catch(onError);
      }, intervalMs);
    },
    finish(value) {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      return enqueue(() => value).catch(onError);
    },
  };
}
