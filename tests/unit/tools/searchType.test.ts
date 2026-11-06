import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { searchResponse } from "../../fixtures/exaResponses.js";
import { FakeMcpServer } from "../../helpers/fakeMcpServer.js";

const { ExaMock, requestMock } = vi.hoisted(() => {
  const requestMock = vi.fn();
  class ExaMock {
    request = requestMock;
  }

  return { ExaMock, requestMock };
});

vi.mock("exa-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("exa-js")>()),
  Exa: ExaMock,
}));

vi.mock("agnost", () => ({
  checkpoint: vi.fn(),
}));

const SEARCH_TYPES = ["auto", "lite", "fast", "instant"] as const;

/** The body of the one /search request the tool sent. */
function sentRequest(): Record<string, any> {
  expect(requestMock).toHaveBeenCalledTimes(1);
  const [path, method, body] = requestMock.mock.calls[0];
  expect([path, method]).toEqual(["/search", "POST"]);
  return body;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseSearchType", () => {
  it.each(SEARCH_TYPES)("accepts %s", async (type) => {
    const { parseSearchType } = await import("../../../src/tools/searchType.js");

    expect(parseSearchType(type)).toBe(type);
  });

  it.each([null, undefined, "", "FAST", " lite", "neural", "keyword", "deep", "deep-lite"])(
    "names no search type for %o",
    async (value) => {
      const { parseSearchType } = await import("../../../src/tools/searchType.js");

      expect(parseSearchType(value)).toBeUndefined();
    },
  );

  it("lists the legacy types after the recommended ones", async () => {
    const { SEARCH_TYPES: exported } = await import("../../../src/tools/searchType.js");

    expect(exported).toEqual(SEARCH_TYPES);
  });
});

describe("web_search_exa search type", () => {
  async function registerWebSearch(defaultSearchType?: (typeof SEARCH_TYPES)[number]) {
    const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
    const server = new FakeMcpServer();
    registerWebSearchTool(server as any, { exaApiKey: "test-key", defaultSearchType });
    return server.getTool("web_search_exa");
  }

  it("searches with lite when no default search type is configured", async () => {
    const tool = await registerWebSearch();
    requestMock.mockResolvedValue(searchResponse);

    await tool.handler({ query: "AI breakthroughs" });

    expect(sentRequest().type).toBe("lite");
  });

  it.each(["lite", "fast", "instant"] as const)(
    "sends the configured %s default unchanged",
    async (type) => {
      const tool = await registerWebSearch(type);
      requestMock.mockResolvedValue(searchResponse);

      await tool.handler({ query: "category:company Exa", numResults: 3 });

      // Every field here is one lite serves, so any configured type is valid.
      expect(sentRequest()).toEqual({
        compliance: "hipaa",
        query: "Exa",
        type,
        numResults: 3,
        category: "company",
        contents: { highlights: true },
      });
    },
  );

  it("does not let the caller choose the search type", async () => {
    const tool = await registerWebSearch("lite");

    expect(Object.keys(tool.inputSchema as object)).not.toContain("type");
  });
});

describe("web_search_advanced_exa search type", () => {
  async function registerAdvancedTool() {
    const { registerWebSearchAdvancedTool } =
      await import("../../../src/tools/webSearchAdvanced.js");
    const server = new FakeMcpServer();
    registerWebSearchAdvancedTool(server as any, { exaApiKey: "test-key" });
    return server.getTool("web_search_advanced_exa");
  }

  function inputSchema(tool: { inputSchema?: unknown }) {
    return z.object(tool.inputSchema as Record<string, z.ZodTypeAny>);
  }

  it("describes the HIPAA-compatible search types", async () => {
    const tool = await registerAdvancedTool();

    const jsonSchema = zodToJsonSchema(inputSchema(tool), { strictUnions: true }) as {
      properties: Record<string, { enum?: string[]; description?: string }>;
      required?: string[];
    };
    expect(jsonSchema.properties.type.enum).toEqual([...SEARCH_TYPES]);
    expect(jsonSchema.required ?? []).not.toContain("type");
    expect(jsonSchema.properties.type.description).toContain(
      "HIPAA mode accepts 'lite' and the legacy 'fast' and 'instant' types; 'auto' is unavailable.",
    );
  });

  it.each(["deep", "deep-lite", "neural", "FAST", ""])(
    "rejects the %o type at schema validation",
    async (type) => {
      const tool = await registerAdvancedTool();

      expect(inputSchema(tool).safeParse({ query: "q", type }).success).toBe(false);
    },
  );

  it("searches with lite when no type is given", async () => {
    const tool = await registerAdvancedTool();
    requestMock.mockResolvedValue(searchResponse);

    await tool.handler({ query: "AI breakthroughs" });

    expect(sentRequest()).toMatchObject({
      type: "lite",
      compliance: "hipaa",
      contents: { text: true },
    });
  });

  it("searches with lite when the server has a default search type configured", async () => {
    const { registerWebSearchAdvancedTool } =
      await import("../../../src/tools/webSearchAdvanced.js");
    const server = new FakeMcpServer();
    registerWebSearchAdvancedTool(
      server as any,
      {
        exaApiKey: "test-key",
        defaultSearchType: "fast",
      } as any,
    );
    requestMock.mockResolvedValue(searchResponse);

    await server.getTool("web_search_advanced_exa").handler({ query: "AI breakthroughs" });

    expect(sentRequest().type).toBe("lite");
  });

  it.each(["fast", "instant"])(
    "still accepts the legacy %s type and sends it unchanged",
    async (type) => {
      const tool = await registerAdvancedTool();
      requestMock.mockResolvedValue(searchResponse);

      expect(inputSchema(tool).parse({ query: "q", type })).toMatchObject({ type });

      await tool.handler({ query: "AI breakthroughs", type });

      expect(sentRequest()).toMatchObject({
        type,
        contents: { text: true },
      });
    },
  );

  it.each(["auto", "fast", "instant"])(
    "refuses incompatible HIPAA requests with type %s before transmission",
    async (type) => {
      const tool = await registerAdvancedTool();
      const result = await tool.handler({ query: "q", type, enableSummary: true });
      expect(requestMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ isError: true });
    },
  );

  it("sends a lite search with every parameter lite serves and no livecrawl default", async () => {
    const tool = await registerAdvancedTool();
    requestMock.mockResolvedValue(searchResponse);

    const result = await tool.handler({
      query: "AI breakthroughs",
      type: "lite",
      numResults: 5,
      category: "news",
      includeDomains: ["example.com"],
      excludeDomains: ["spam.example"],
      startPublishedDate: "2026-01-01",
      endPublishedDate: "2026-06-01",
      userLocation: "US",
      moderation: true,
      textMaxCharacters: 500,
      enableHighlights: true,
      highlightsMaxCharacters: 1000,
      highlightsQuery: "model releases",
    });

    expect((result as any).isError).toBeUndefined();
    expect(sentRequest()).toEqual({
      compliance: "hipaa",
      query: "AI breakthroughs",
      type: "lite",
      numResults: 5,
      category: "news",
      includeDomains: ["example.com"],
      excludeDomains: ["spam.example"],
      startPublishedDate: "2026-01-01",
      endPublishedDate: "2026-06-01",
      userLocation: "US",
      moderation: true,
      contents: {
        text: { maxCharacters: 500 },
        highlights: { maxCharacters: 1000, query: "model releases" },
      },
    });
  });

  it.each([
    [{ enableSummary: true }, "enableSummary"],
    [{ enableSummary: true, summaryQuery: "key findings" }, "enableSummary"],
    [{ contextMaxCharacters: 2000 }, "contextMaxCharacters"],
    [{ maxAgeHours: 0 }, "maxAgeHours"],
    [{ maxAgeHours: -1 }, "maxAgeHours"],
    [{ livecrawlTimeout: 5000 }, "livecrawlTimeout"],
    [{ subpages: 2 }, "subpages"],
    [{ subpageTarget: ["docs"] }, "subpageTarget"],
    [{ startCrawlDate: "2026-01-01" }, "startCrawlDate"],
    [{ endCrawlDate: "2026-06-01" }, "endCrawlDate"],
    [{ includeText: ["rust"] }, "includeText"],
    [{ excludeText: ["rust"] }, "excludeText"],
    [{ additionalQueries: ["rust release notes"] }, "additionalQueries"],
  ])("refuses a lite search that sets %o without calling the API", async (params, parameter) => {
    const tool = await registerAdvancedTool();

    const result = await tool.handler({ query: "AI breakthroughs", type: "lite", ...params });

    expect(requestMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: `web_search_advanced_exa error: search type 'lite' does not support ${parameter}. Remove it; HIPAA mode requires cached retrieval.`,
        },
      ],
      isError: true,
    });
  });

  it("names every parameter lite does not serve, top-level ones first", async () => {
    const tool = await registerAdvancedTool();

    const result = await tool.handler({
      query: "AI breakthroughs",
      type: "lite",
      enableSummary: true,
      maxAgeHours: 1,
      includeText: ["rust"],
    });

    expect(requestMock).not.toHaveBeenCalled();
    expect((result as any).content[0].text).toBe(
      "web_search_advanced_exa error: search type 'lite' does not support includeText, maxAgeHours, enableSummary. Remove them; HIPAA mode requires cached retrieval.",
    );
  });
});
