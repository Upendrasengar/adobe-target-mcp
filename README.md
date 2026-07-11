# Adobe Target MCP

[![npm version](https://img.shields.io/npm/v/@upendra_sengar/adobe-target-mcp)](https://www.npmjs.com/package/@upendra_sengar/adobe-target-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@upendra_sengar/adobe-target-mcp)](https://www.npmjs.com/package/@upendra_sengar/adobe-target-mcp)
[![Node](https://img.shields.io/node/v/@upendra_sengar/adobe-target-mcp)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@upendra_sengar/adobe-target-mcp)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Adobe Target**. Lets AI assistants manage A/B and Experience Targeting activities through the Adobe Target Admin API, with automatic Adobe IMS OAuth token handling (fetch, cache, refresh).

## Quickstart

Via Claude Code:

```console
claude mcp add adobe-target \
  -e ADOBE_CLIENT_ID=your-client-id \
  -e ADOBE_API_KEY=your-client-id \
  -e ADOBE_CLIENT_SECRET=your-client-secret \
  -e ADOBE_TENANT=your-tenant \
  -- npx -y @upendra_sengar/adobe-target-mcp
```

## Requirements

- [Node.js](https://nodejs.org) >= 18
- An [Adobe Developer Console](https://developer.adobe.com/console) project with:
  - The **Adobe Target API** enabled
  - **OAuth Server-to-Server** credentials (client ID + client secret)
- Your Adobe Target **tenant** name (the subdomain in `mc.adobe.io/<tenant>/target/...`)

## Configuration

All configuration is passed as environment variables — no keys are ever stored in this package.

| Variable | Required | Description |
|----------|----------|-------------|
| `ADOBE_CLIENT_ID` | ✅ | Client ID from your Adobe Developer Console project |
| `ADOBE_API_KEY` | ✅ | API key sent as `X-Api-Key` (same value as the client ID) |
| `ADOBE_CLIENT_SECRET` | ✅ | Client secret from your Adobe Developer Console project |
| `ADOBE_TENANT` | ✅ | Adobe Target tenant subdomain |
| `PORT` | — | Port for SSE / Streamable HTTP modes (default `3001`) |
| `MCP_TOOL_LOGGING` | — | `true` to enable verbose per-tool logging |
| `MCP_LOG_FILE` | — | File path for logs in stdio mode |

For local development you can copy `.env.example` to `.env` instead.

## Installation

<details>
<summary><strong>Claude Desktop, Cursor, Windsurf, JetBrains</strong></summary>

These clients all use the same `mcpServers` format:

```json
{
  "mcpServers": {
    "adobe-target": {
      "command": "npx",
      "args": ["-y", "@upendra_sengar/adobe-target-mcp"],
      "env": {
        "ADOBE_CLIENT_ID": "your-client-id",
        "ADOBE_API_KEY": "your-client-id",
        "ADOBE_CLIENT_SECRET": "your-client-secret",
        "ADOBE_TENANT": "your-tenant"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "adobe-target": {
      "command": "npx",
      "args": ["-y", "@upendra_sengar/adobe-target-mcp"],
      "env": {
        "ADOBE_CLIENT_ID": "your-client-id",
        "ADOBE_API_KEY": "your-client-id",
        "ADOBE_CLIENT_SECRET": "your-client-secret",
        "ADOBE_TENANT": "your-tenant"
      }
    }
  }
}
```

</details>

## Transports

| Mode | Command | Use case |
|------|---------|----------|
| stdio (default) | `npx -y @upendra_sengar/adobe-target-mcp` | Local MCP clients (Claude Desktop, Cursor, …) |
| Streamable HTTP | `npx -y @upendra_sengar/adobe-target-mcp --streamable-http` | Remote / shared deployments (`POST /mcp`) |
| SSE | `npx -y @upendra_sengar/adobe-target-mcp --sse` | Legacy SSE clients (`GET /sse`, `POST /messages`) |

HTTP modes listen on `PORT` (default `3001`).

## Tools

| Tool | Description |
|------|-------------|
| `list_activities` | List activities with filters (state, name, type, priority) and pagination |
| `get_ab_activity_by_id` | Get full details of an A/B activity |
| `create_ab_activity` | Create a new A/B activity |
| `update_activity` | Update an existing activity |
| `update_activity_name` | Rename an activity |
| `update_activity_selector` | Update the DOM selector of an activity's experience location |

## Authentication flow

The server exchanges your client credentials for an Adobe IMS access token (`ims-na1.adobelogin.com`), caches it, and refreshes it automatically 5 minutes before expiry. Tokens are held in memory only — nothing is written to disk.

## Docker

```console
docker build -t adobe-target-mcp .
docker run -i --rm \
  -e ADOBE_CLIENT_ID=your-client-id \
  -e ADOBE_API_KEY=your-client-id \
  -e ADOBE_CLIENT_SECRET=your-client-secret \
  -e ADOBE_TENANT=your-tenant \
  adobe-target-mcp
```

## License

[MIT](LICENSE)
