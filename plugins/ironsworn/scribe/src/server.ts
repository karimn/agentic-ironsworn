import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as readTools from "./tools/read.js";
import * as mechanicsTools from "./tools/mechanics.js";
import * as mutationsTools from "./tools/mutations.js";
import * as narrativeTools from "./tools/narrative.js";
import * as loreTools from "./tools/lore.js";
import * as campaignTools from "./tools/campaign.js";

const CAMPAIGN_PATH = process.env.SCRIBE_CAMPAIGN ?? "campaigns/default";

const server = new McpServer({
  name: "scribe",
  version: "0.0.1",
});

readTools.register(server, CAMPAIGN_PATH);
mechanicsTools.register(server, CAMPAIGN_PATH);
mutationsTools.register(server, CAMPAIGN_PATH);
narrativeTools.register(server, CAMPAIGN_PATH);
loreTools.register(server, CAMPAIGN_PATH);
campaignTools.register(server, CAMPAIGN_PATH);

const transport = new StdioServerTransport();
await server.connect(transport);
