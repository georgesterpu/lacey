import { test, expect } from "bun:test";
import { retryTransient } from "../src/transient";
test("checkpointed collection retries transient timeouts, but stops after three attempts", async () => {
  let calls = 0;
  const delays: number[] = [];
  expect(
    await retryTransient(
      async () => {
        if (++calls < 3)
          throw new DOMException("Database timeout", "TimeoutError");
        return "checkpoint retained";
      },
      async (ms) => {
        delays.push(ms);
      },
    ),
  ).toBe("checkpoint retained");
  expect(calls).toBe(3);
  expect(delays).toEqual([1000, 2000]);
  calls = 0;
  await expect(
    retryTransient(
      async () => {
        calls++;
        throw new DOMException("Offline", "TimeoutError");
      },
      async () => {},
    ),
  ).rejects.toThrow("Offline");
  expect(calls).toBe(3);
});
test("contract failures are permanent and never treated as transient retries", async () => {
  let calls = 0;
  await expect(
    retryTransient(
      async () => {
        calls++;
        throw new Error("Product identity mismatch");
      },
      async () => {},
    ),
  ).rejects.toThrow("identity mismatch");
  expect(calls).toBe(1);
});
