import { test, expect } from "bun:test";
import { jsonStream } from "../src/json-stream";
test("a catalogue larger than the buffered hosting limit remains complete, valid UTF-8 JSON", async () => {
  const offers = Array.from({ length: 7000 }, (_, n) => ({
    id: String(n),
    title: `Happy feet 😊 ${n}`,
    image: "https://cdn.shopify.com/image?" + "x".repeat(700),
    sizes: ["8", "8.5", "9"],
  }));
  const payload = { offers };
  expect(
    new TextEncoder().encode(JSON.stringify(payload)).length,
  ).toBeGreaterThan(4500000);
  const response = jsonStream(payload),
    data = await response.json();
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(data.offers).toHaveLength(7000);
  expect(data.offers[0]).toEqual(offers[0]);
  expect(data.offers.at(-1)).toEqual(offers.at(-1));
});
