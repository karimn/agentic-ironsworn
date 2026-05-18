import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ExpansionContext } from "../../loader.js";

export function register(server: McpServer, _ctx: ExpansionContext): void {
  server.tool(
    "stub_ping",
    "Stub expansion ping tool — confirms the expansion system loaded correctly",
    { message: z.string().optional().describe("Optional message to echo") },
    async ({ message }) => ({
      content: [{ type: "text", text: `stub_ping: ${message ?? "pong"}` }],
    }),
  );
}
