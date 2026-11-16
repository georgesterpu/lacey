// Use only for idempotent writes or lease-protected, checkpointed collection.
// Email delivery and counter increments must retain their own idempotency rules.
export async function retryTransient<T>(
  work: () => Promise<T>,
  wait: (ms: number) => Promise<unknown> = (ms) => Bun.sleep(ms),
) {
  for (let attempt = 1; ; attempt++)
    try {
      return await work();
    } catch (error) {
      const e = error as { name?: string; code?: string };
      if (
        attempt >= 3 ||
        !(
          ["TimeoutError", "AbortError"].includes(e.name ?? "") ||
          [
            "SERVER_ERROR",
            "HTTP_SERVER_ERROR",
            "SQLITE_BUSY",
            "CONNECTION_CLOSED",
          ].includes(e.code ?? "")
        )
      )
        throw error;
      console.warn("Transient collection failure; retrying", {
        attempt,
        type: e.name ?? e.code,
      });
      await wait(attempt * 1000);
    }
}
