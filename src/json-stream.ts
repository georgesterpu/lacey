// Keep the JSON contract while avoiding Vercel's buffered response-size limit
// as retailer coverage grows. Backpressure bounds the queued output chunks.
export function jsonStream(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 65536, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
