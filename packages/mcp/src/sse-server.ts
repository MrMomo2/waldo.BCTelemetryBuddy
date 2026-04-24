/**
 * SSE HTTP Server for Rovo Studio integration
 *
 * Uses official @modelcontextprotocol/sdk with SSEServerTransport
 * to expose bc-telemetry-buddy-mcp via HTTP/SSE for Rovo Studio agents.
 *
 * Architecture:
 * - SSEServerTransport handles MCP protocol over HTTP/SSE
 * - Express serves the SSE endpoint and message endpoint
 * - API-Key middleware validates Bearer tokens
 * - ToolHandlers from Waldo's mcp package handle all business logic
 */

import express, { Express, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfigFromFile, validateConfig, MCPConfig } from './config.js';
import { initializeServices } from './tools/toolHandlers.js';
import { createSdkServer } from './mcpSdkServer.js';
import { VERSION } from './version.js';
import * as crypto from 'crypto';

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.BCTB_API_KEY || '';

interface ClientSession {
    transport: SSEServerTransport;
    connectedAt: string;
}

const sessions = new Map<string, ClientSession>();

function apiKeyAuth(req: Request, res: Response, next: express.NextFunction): void {
    if (!API_KEY) {
        next();
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or invalid Authorization header. Expected: Bearer <api-key>'
        });
        return;
    }

    const providedKey = authHeader.substring(7);
    if (providedKey !== API_KEY) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key'
        });
        return;
    }

    next();
}

async function createApp(mcpServer: McpServer): Promise<Express> {
    const app = express();
    app.use(express.json());

    app.use((req: Request, res: Response, next: express.NextFunction) => {
        const sanitizedPath = req.path.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        console.error(`[${new Date().toISOString()}] ${req.method} ${sanitizedPath}`);
        next();
    });

    app.get('/sse', apiKeyAuth, async (req: Request, res: Response) => {
        const clientId = crypto.randomUUID();
        console.error(`[SSE] Client connected: ${clientId}`);

        const transport = new SSEServerTransport('/message', res);
        sessions.set(clientId, { transport, connectedAt: new Date().toISOString() });

        await mcpServer.connect(transport);

        res.on('close', () => {
            console.error(`[SSE] Client disconnected: ${clientId}`);
            sessions.delete(clientId);
        });
    });

    app.post('/message', apiKeyAuth, async (req: Request, res: Response) => {
        const clientId = req.headers['mcp-client-id'] as string;
        if (!clientId) {
            res.status(400).json({ error: 'Missing mcp-client-id header' });
            return;
        }

        const session = sessions.get(clientId);
        if (!session) {
            res.status(404).json({ error: 'Client session not found. Connect via /sse first.' });
            return;
        }

        try {
            await session.transport.handlePostMessage(req.body, req.headers);
            res.status(200).json({ ok: true });
        } catch (error: any) {
            console.error('[Message] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/health', (req: Request, res: Response) => {
        res.json({
            status: 'ok',
            version: VERSION,
            timestamp: new Date().toISOString(),
            activeSessions: sessions.size
        });
    });

    return app;
}

async function main(): Promise<void> {
    let resolvedConfig: MCPConfig;

    const fileConfig = loadConfigFromFile(undefined, undefined, false);
    if (fileConfig) {
        resolvedConfig = fileConfig;
    } else {
        resolvedConfig = loadConfigFromFile(undefined, undefined, true) as MCPConfig;
    }

    const configErrors = validateConfig(resolvedConfig);

    if (configErrors.length > 0) {
        console.error('Configuration issues:');
        configErrors.forEach(e => console.error(`  - ${e}`));
    }

    const services = initializeServices(resolvedConfig, false, undefined, undefined);

    const { ToolHandlers } = await import('./tools/toolHandlers.js');
    const toolHandlers = new ToolHandlers(resolvedConfig, services, true, configErrors);

    const mcpServer = createSdkServer(toolHandlers);

    const app = await createApp(mcpServer);

    const server = app.listen(PORT, () => {
        console.error(`BC Telemetry Buddy MCP SSE Server v${VERSION}`);
        console.error(`Listening on port ${PORT}`);
        console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
        console.error(`Message endpoint: http://localhost:${PORT}/message`);
        console.error(`API key: ${API_KEY ? 'enabled' : 'disabled (not set)'}`);
        console.error(`Config: ${resolvedConfig.connectionName}`);
    });

    const shutdown = async () => {
        console.error('Shutting down...');
        server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(console.error);