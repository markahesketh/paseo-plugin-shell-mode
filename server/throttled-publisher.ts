export interface ThrottledPublisher<Value> {
  now(value: Value): Promise<void>;
  schedule(build: () => Value): void;
  finish(value: Value): Promise<void>;
}

const ignore = () => undefined;

export function createThrottledPublisher<Value>(
  send: (value: Value) => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void,
): ThrottledPublisher<Value> {
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
