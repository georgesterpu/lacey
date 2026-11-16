import { test, expect, afterEach } from "bun:test";
import { collect, sources, type Product } from "../src/sources";
import { inventorySummary } from "../src/snapshots";
const original = globalThis.fetch;
afterEach(() => (globalThis.fetch = original));
const product = (id: number): Product => ({
  id,
  title: `Road Running Shoe Men ${id}`,
  vendor: "ASICS",
  product_type: "Running Shoe",
  tags: [],
  handle: `shoe-${id}`,
  options: [{ name: "UK Size", position: 1 }],
  images: [],
  variants: [
    {
      id: id * 10,
      price: "60",
      compare_at_price: "100",
      available: true,
      option1: "9",
      option2: null,
      option3: null,
    },
  ],
});
const source = { ...sources[0], collections: ["running"] };
test("Shopify follows every page beyond the former 500-product limit", async () => {
  const pages: number[] = [];
  globalThis.fetch = (async (input:RequestInfo|URL) => {
    const page = Number(new URL(String(input)).searchParams.get("page"));
    pages.push(page);
    return Response.json({
      products: Array.from({ length: page === 3 ? 1 : 250 }, (_, n) =>
        product((page - 1) * 250 + n + 1),
      ),
    });
  }) as unknown as typeof fetch;
  const result = await collect(source, new Date().toISOString());
  expect(pages).toEqual([1, 2, 3]);
  expect(result.complete).toBe(true);
  expect(result.offers).toHaveLength(501);
  const rows = result.offers.slice(0, 2);
  rows[0].available = 0;
  expect(inventorySummary(rows)).toEqual({
    products: 2,
    variants: 2,
    availableProducts: 1,
    soldOutProducts: 1,
  });
});
test("repeated pages and malformed contracts fail instead of publishing incomplete stock", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      products: Array.from({ length: 250 }, (_, n) => product(n + 1)),
    })) as unknown as typeof fetch;
  await expect(collect(source, new Date().toISOString())).rejects.toThrow(
    "repeated",
  );
  globalThis.fetch = (async () => Response.json({ items: [] })) as unknown as typeof fetch;
  await expect(collect(source, new Date().toISOString())).rejects.toThrow(
    "Contract changed",
  );
});
