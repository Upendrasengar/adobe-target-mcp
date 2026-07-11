#!/usr/bin/env node

import dotenv from "dotenv";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { discoverTools } from "./lib/tools.js";
import { setTransportMode, logger } from "./lib/logger.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the package directory first, then fall back to the current
// working directory. Variables already present in the environment (e.g. set
// by an MCP client's `env` block) always take precedence — dotenv never
// overrides existing values.
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config();

const SERVER_NAME = "adobe-target-mcp";
const SERVER_VERSION = "0.1.0";

const REQUIRED_ENV_VARS = [
    "ADOBE_CLIENT_ID",
    "ADOBE_CLIENT_SECRET",
    "ADOBE_API_KEY",
    "ADOBE_TENANT",
];

function checkRequiredEnv() {
    const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        logger.error(
            `Missing required environment variables: ${missing.join(", ")}. ` +
                `Set them in your MCP client's "env" config or in a .env file. ` +
                `Tool calls will fail until they are provided.`
        );
    }
    return missing;
}

async function transformTools(tools) {
    return tools
        .map((tool) => {
            const definitionFunction = tool.definition?.function;
            if (!definitionFunction) return;
            return {
                name: definitionFunction.name,
                description: definitionFunction.description,
                inputSchema: definitionFunction.parameters,
            };
        })
        .filter(Boolean);
}

async function setupServerHandlers(server, tools) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: await transformTools(tools),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        const args = request.params.arguments;


        logger.info(`Tool called: ${toolName}`, { args });

        const tool = tools.find((t) => t.definition.function.name === toolName);
        if (!tool) {
            logger.error(`Unknown tool: ${toolName}`);
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
        }

        const requiredParameters =
            tool.definition?.function?.parameters?.required || [];
        for (const requiredParameter of requiredParameters) {
            if (!(requiredParameter in args)) {
                logger.error(`Missing required parameter: ${requiredParameter}`);
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `Missing required parameter: ${requiredParameter}`
                );
            }
        }
        try {
            logger.info(`Executing tool: ${toolName}`);
            const result = await tool.function(args);
            logger.success(`Tool ${toolName} completed successfully`);
            logger.debug(`Result for ${toolName}`, result);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            logger.error(`Tool ${toolName} failed: ${error.message}`, { stack: error.stack });
            throw new McpError(
                ErrorCode.InternalError,
                `API error: ${error.message}`
            );
        }
    });
}

async function setupStreamableHttp(tools) {
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
        try {
            const server = new Server(
                {
                    name: SERVER_NAME,
                    version: SERVER_VERSION,
                },
                {
                    capabilities: {
                        tools: {},
                    },
                }
            );
            server.onerror = (error) => logger.error("Server error", error);
            await setupServerHandlers(server, tools);

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });

            res.on("close", async () => {
                await transport.close();
                await server.close();
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error("Error handling MCP request", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error",
                    },
                    id: null,
                });
            }
        }
    });

    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        logger.info(`Streamable HTTP Server running at http://127.0.0.1:${port}/mcp`);
    });
}

async function setupSSE(tools) {
    const app = express();
    const transports = {};
    const servers = {};

    app.get("/sse", async (_req, res) => {
        const server = new Server(
            {
                name: SERVER_NAME,
                version: SERVER_VERSION,
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );
        server.onerror = (error) => logger.error("SSE Server error", error);
        await setupServerHandlers(server, tools);

        const transport = new SSEServerTransport("/messages", res);
        transports[transport.sessionId] = transport;
        servers[transport.sessionId] = server;

        res.on("close", async () => {
            delete transports[transport.sessionId];
            await server.close();
            delete servers[transport.sessionId];
        });

        await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
        const sessionId = req.query.sessionId;
        const transport = transports[sessionId];
        const server = servers[sessionId];

        if (transport && server) {
            await transport.handlePostMessage(req, res);
        } else {
            res.status(400).send("No transport/server found for sessionId");
        }
    });

    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        logger.info(`SSE Server running at http://127.0.0.1:${port}/sse`);
        logger.info(`Message input at http://127.0.0.1:${port}/messages`);
    });
}

async function setupStdio(tools) {
    // stdio mode: single server instance
    const server = new Server(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );
    server.onerror = (error) => logger.error("STDIO Server error", error);
    await setupServerHandlers(server, tools);

    process.on("SIGINT", async () => {
        await server.close();
        process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

async function run() {
    const args = process.argv.slice(2);
    const isStreamableHttp = args.includes("--streamable-http");
    const isSSE = args.includes("--sse");

    // Determine transport mode and configure logging
    let transportMode = 'stdio';
    if (isStreamableHttp) transportMode = 'http';
    else if (isSSE) transportMode = 'sse';
    
    setTransportMode(transportMode);

    // Now we can safely log
    logger.info(`Starting MCP Server: ${SERVER_NAME} v${SERVER_VERSION}`);
    checkRequiredEnv();
    if (process.env.PORT) {
        logger.info(`PORT set to: ${process.env.PORT}`);
    }

    logger.info("Loading tools...");
    const tools = await discoverTools();

    logger.info(`Loaded ${tools.length} tools:`);
    tools.forEach(tool => {
        logger.info(`  - ${tool.definition.function.name}: ${tool.definition.function.description}`);
    });

    if (isStreamableHttp && isSSE) {
        logger.error("Cannot specify both --streamable-http and --sse");
        process.exit(1);
    }

    if (isStreamableHttp) {
        logger.info("Starting in Streamable HTTP mode");
        await setupStreamableHttp(tools);
    } else if (isSSE) {
        logger.info("Starting in SSE mode");
        await setupSSE(tools);
    } else {
        logger.info("Starting in STDIO mode");
        await setupStdio(tools);
    }
}

run().catch(console.error);
