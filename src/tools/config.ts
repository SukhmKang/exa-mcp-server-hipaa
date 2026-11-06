import { Exa } from "exa-js";
import { serializeMcpClientMetadata } from "../utils/mcpClientMetadata.js";

function encodeIntegrationSource(source: string): string {
  return Array.from(new TextEncoder().encode(source), (byte) =>
    byte <= 127
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");
}

// Build Exa reporting headers, appending x-exa-source if present
export function integrationHeaders(tool: string, config?: Record<string, unknown>) {
  const source = config?.exaSource;
  const mcpSessionId = config?.mcpSessionId;
  const mcpClient = serializeMcpClientMetadata(config?.mcpClient);
  const oauthAccessToken = config?.oauthAccessToken;
  const headers: Record<string, string> = {
    "x-exa-integration":
      typeof source === "string" ? `${tool}:${encodeIntegrationSource(source)}` : tool,
  };

  if (typeof oauthAccessToken === "string" && oauthAccessToken.length > 0) {
    headers["Authorization"] = `Bearer ${oauthAccessToken}`;
  }

  if (typeof mcpSessionId === "string" && mcpSessionId.length > 0) {
    headers["x-exa-mcp-session-id"] = mcpSessionId;
  }

  if (mcpClient) {
    headers["x-exa-mcp-client"] = mcpClient;
  }

  return headers;
}

export function createExaClient(config?: Record<string, unknown>, tool?: string) {
  const exa = createBaseExaClient(config);
  if (tool) {
    applyClientHeaders(exa, integrationHeaders(tool, config));
  }
  return enforceHipaa(exa);
}

/**
 * Construct an exa-js client for `apiKey`. `EXA_API_BASE_URL` overrides the
 * Exa API origin the tools call (the integration suite points it at a local
 * double); unset, exa-js keeps its default of https://api.exa.ai.
 */
function newExaClient(apiKey: string): Exa {
  let baseUrl = process.env.EXA_API_BASE_URL;
  return baseUrl ? new Exa(apiKey, baseUrl) : new Exa(apiKey);
}

function createBaseExaClient(config?: Record<string, unknown>) {
  const oauthAccessToken = config?.oauthAccessToken;
  if (typeof oauthAccessToken === "string" && oauthAccessToken.length > 0) {
    const exa = newExaClient("oauth");
    (exa as unknown as { headers: Headers }).headers.delete("x-api-key");
    return exa;
  }
  const exaApiKey = config?.exaApiKey;
  return newExaClient(
    typeof exaApiKey === "string" && exaApiKey.length > 0
      ? exaApiKey
      : process.env.EXA_API_KEY || "",
  );
}

function applyClientHeaders(exa: Exa, headers: Record<string, string>) {
  const client = exa as unknown as { headers: Headers | Record<string, string> };
  const headerBag = client.headers as Headers;
  if (typeof headerBag.set === "function") {
    Object.entries(headers).forEach(([key, value]) => headerBag.set(key, value));
    return;
  }

  client.headers = {
    ...client.headers,
    ...headers,
  };
}

// Configuration for API
export const API_CONFIG = {
  ENDPOINTS: {
    SEARCH: "/search",
    RESEARCH: "/research/v1",
  },
  TOOL_TIMEOUTS: {
    SEARCH_MS: 60_000,
    FETCH_MS: 60_000,
    ADVANCED_SEARCH_MS: 300_000,
  },
  DEFAULT_NUM_RESULTS: 10,
  DEFAULT_MAX_CHARACTERS: 3000,
} as const;

/** Enforce the documented HIPAA request contract at the shared SDK boundary. */
function hipaaBody(endpoint: string, method: string, body: any): Record<string, unknown> {
  if (method !== "POST" || !["/search", "/contents"].includes(endpoint)) {
    throw new Error("HIPAA mode supports only cached /search and /contents requests.");
  }
  const request = { ...body, compliance: "hipaa" };
  if (endpoint === "/search") {
    request.type ??= "lite";
    if (!["lite", "fast", "instant"].includes(request.type)) {
      throw new Error("HIPAA mode requires search type lite, fast, or instant.");
    }
  }
  const contents = endpoint === "/search" ? request.contents : request;
  if (contents?.summary != null && contents.summary !== false) {
    throw new Error("HIPAA mode does not support summaries.");
  }
  if (
    contents?.livecrawl != null ||
    contents?.livecrawlTimeout != null ||
    (contents?.maxAgeHours != null && contents.maxAgeHours !== -1)
  ) {
    throw new Error("HIPAA mode requires cached content; live fetching is unavailable.");
  }
  if (endpoint === "/contents") request.maxAgeHours = -1;
  return request;
}

function enforceHipaa(exa: Exa): Exa {
  const request = exa.request.bind(exa);
  exa.request = async (endpoint, method, body, params, headers) =>
    request(endpoint, method, hipaaBody(endpoint, method, body), params, headers);
  // Streaming SDK surfaces use rawRequest rather than request. Guard both.
  if (typeof exa.rawRequest === "function") {
    const rawRequest = exa.rawRequest.bind(exa);
    exa.rawRequest = async (endpoint, method = "POST", body, params, headers) =>
      rawRequest(endpoint, method, hipaaBody(endpoint, method, body), params, headers);
  }
  return exa;
}
