import { robotsAllows } from "./twentyone";
const origins = new Set([
  "https://ie.sportsdirect.com",
  "https://www.misterrunning.com",
  "https://www.runningwarehouse.eu",
]);
const policies = new Map<string, { text: string; until: number }>(),
  slots = new Map<string, number>();
export class RetailerRequestError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
async function document(url: URL, irelandVAT = false): Promise<string> {
  const at = Math.max(Date.now(), (slots.get(url.origin) ?? 0) + 1000);
  slots.set(url.origin, at);
  if (at > Date.now()) await Bun.sleep(at - Date.now());
  let status: number, text: string;
  if (
    ["ie.sportsdirect.com", "www.runningwarehouse.eu"].includes(url.hostname)
  ) {
    // This storefront stalls Bun's HTTP transport. Use the standard curl
    // client, without browser automation, cookies, proxies or blocked APIs.
    if (!Bun.which("curl"))
      throw new RetailerRequestError(
        "This retailer requires the curl HTTP transport on this worker",
      );
    const child = Bun.spawn(
      [
        "curl",
        "--silent",
        "--show-error",
        "--compressed",
        "--proto",
        "=https",
        "--connect-timeout",
        "8",
        "--max-time",
        "20",
        "--max-filesize",
        "10000000",
        "--write-out",
        "\n%{http_code}",
        ...(irelandVAT ? ["--data", "vat=IE"] : []),
        url.href,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, body] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0)
      throw new RetailerRequestError(
        `Retailer HTTP transport failed (${code})`,
        [5, 6, 7, 18, 28, 35, 52, 55, 56, 92].includes(code),
      );
    const cut = body.lastIndexOf("\n");
    status = Number(body.slice(cut + 1));
    text = body.slice(0, cut);
  } else {
    const r = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Lacey/0.4 (+https://lacey.january.ie)" },
      signal: AbortSignal.timeout(20000),
    });
    status = r.status;
    text = await r.text();
  }
  if ([401, 403, 406, 429].includes(status))
    throw new RetailerRequestError(
      `Retailer paused: HTTP ${status}; retry after 12 hours`,
    );
  if (status !== 200)
    throw new RetailerRequestError(`Retailer HTTP ${status}`, status >= 500);
  if (text.length > 10000000)
    throw new RetailerRequestError(
      "Retailer document exceeded 10 MB; snapshot withheld",
    );
  return text;
}
export async function retailerPage(
  value: string,
  { irelandVAT = false }: { irelandVAT?: boolean } = {},
) {
  const url = new URL(value);
  if (
    !origins.has(url.origin) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname.includes("..")
  )
    throw new Error("Unapproved retailer URL");
  if (irelandVAT && url.hostname !== "www.runningwarehouse.eu")
    throw new Error("VAT preference is only supported by Warehouse");
  if (url.pathname === "/robots.txt") return document(url);
  let policy = policies.get(url.origin);
  if (!policy || policy.until < Date.now()) {
    policy = {
      text: await document(new URL("/robots.txt", url)),
      until: Date.now() + 30 * 60000,
    };
    policies.set(url.origin, policy);
  }
  if (!robotsAllows(policy.text, url.pathname + url.search))
    throw new RetailerRequestError(
      "Retailer robots rules do not allow this page",
    );
  return document(url, irelandVAT);
}
