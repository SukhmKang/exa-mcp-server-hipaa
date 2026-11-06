import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createExaClient } from "../../../src/tools/config.js";
import { createRequestLogger } from "../../../src/utils/logger.js";

let server: Server;
let requests: Array<{ path: string; body: Record<string, any> }>;
let status: number;

beforeEach(async () => {
  requests = [];
  status = 200;
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, body: JSON.parse(body) });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status === 403 ? { error: "FEATURE_DISABLED" } : { results: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  vi.stubEnv("EXA_API_BASE_URL", `http://127.0.0.1:${address.port}`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("HIPAA transport policy", () => {
  it.each(["lite", "fast", "instant"])("always sends compliance for %s searches", async (type) => {
    const exa = createExaClient({ exaApiKey: "synthetic-key" });
    await exa.request("/search", "POST", { query: "example", type, compliance: "none" });
    expect(requests).toEqual([
      { path: "/search", body: { query: "example", type, compliance: "hipaa" } },
    ]);
  });

  it("defaults omitted search type to lite and makes contents cache-only", async () => {
    const exa = createExaClient({ exaApiKey: "synthetic-key" });
    await exa.request("/search", "POST", { query: "example" });
    await exa.request("/contents", "POST", { urls: ["https://example.com"], text: true });
    expect(requests[0].body).toMatchObject({ type: "lite", compliance: "hipaa" });
    expect(requests[1].body).toMatchObject({ maxAgeHours: -1, compliance: "hipaa" });
  });

  it.each([
    ["/search", { type: "auto" }],
    ["/search", { type: "deep" }],
    ["/search", { type: "lite", contents: { summary: true } }],
    ["/search", { type: "lite", contents: { maxAgeHours: 0 } }],
    ["/contents", { summary: true }],
    ["/contents", { maxAgeHours: 1 }],
    ["/contents", { livecrawl: "always" }],
    ["/agent/runs", {}],
    ["/research/v1", {}],
  ] as const)("blocks incompatible request to %s before network I/O", async (path, body) => {
    const exa = createExaClient({ exaApiKey: "synthetic-key" });
    await expect(exa.request(path, "POST", body)).rejects.toThrow("HIPAA mode");
    await expect(exa.rawRequest(path, "POST", body)).rejects.toThrow("HIPAA mode");
    expect(requests).toEqual([]);
  });

  it("blocks Agent SDK streaming without transmitting its input", async () => {
    const exa = createExaClient({ exaApiKey: "synthetic-key" });
    await expect(exa.agent.runs.create({ query: "example", stream: true })).rejects.toThrow(
      "HIPAA mode",
    );
    expect(requests).toEqual([]);
  });

  it("does not fall back when HIPAA is not enabled", async () => {
    status = 403;
    const exa = createExaClient({ exaApiKey: "synthetic-key" });
    await expect(exa.request("/search", "POST", { query: "example" })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0].body.compliance).toBe("hipaa");
  });

  it("omits request and error payloads from request logs", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createRequestLogger("web_search_exa");
    logger.start("sensitive-synthetic-query");
    logger.error(new Error("sensitive-synthetic-query"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive-synthetic-query");
  });
});
