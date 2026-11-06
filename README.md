# Exa MCP Server — HIPAA mode

Fork of [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server).
Every outgoing API request is guarded by the shared client: Search and Contents
always send `compliance: "hipaa"`. Search defaults to `lite`, and Contents uses
`maxAgeHours: -1` for cache-only retrieval. The flag cannot be disabled by tool input.

## Setup

Use Node.js 20 or later and an Exa API key whose team has Enterprise HIPAA mode
enabled. Contact [sales@exa.ai](mailto:sales@exa.ai) for enablement and BAA
requirements. An unenabled team receives `403 FEATURE_DISABLED`; the server never
retries without HIPAA mode. See [Exa's HIPAA documentation](https://exa.ai/docs/admin/security/hipaa).

```bash
git clone https://github.com/SukhmKang/exa-mcp-server-hipaa.git
cd exa-mcp-server-hipaa
npm ci
npm run build
EXA_API_KEY=your_api_key node dist/stdio.cjs
```

Configure your MCP client with the built entry point:

```json
{
  "mcpServers": {
    "exa-hipaa": {
      "command": "node",
      "args": ["/absolute/path/to/exa-mcp-server-hipaa/dist/stdio.cjs"],
      "env": { "EXA_API_KEY": "YOUR_HIPAA_ENABLED_EXA_API_KEY" }
    }
  }
}
```

Run this fork locally or deploy its server yourself. Exa's public hosted MCP and
the upstream npm package do not run this fork's changes.

## Tools

`web_search_exa` and `web_fetch_exa` are enabled by default. Optional
`web_search_advanced_exa` supports cached retrieval filters. Legacy search aliases
also use the shared HIPAA client.

`lite` is the default. Legacy `fast` and `instant` types are accepted. Explicit
`auto`, summaries, and live fetching are rejected. Advanced `lite` search retains
the upstream restrictions on filters and content options. Agent and deep research
endpoints are unavailable because Exa documents HIPAA mode only for `/search` and
`/contents`; requests to other endpoints are blocked before transmission.

Query and URL values are omitted from request logs, and third-party analytics are
disabled. HIPAA mode applies to Exa retrieval requests; configure the rest of your
MCP client and hosting environment according to your agreement and requirements.

## Development

```bash
npm ci
npm run ci
npm run build
```

Licensed under the upstream [MIT license](LICENSE).
