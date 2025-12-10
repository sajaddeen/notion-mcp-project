// @ts-nocheck
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Client } from "@notionhq/client";
import { z } from "zod";
import cors from "cors";
import axios from "axios";
// 1. CONFIGURATION
const PORT = Number(process.env.PORT) || 3000;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
if (!NOTION_API_KEY) {
    console.error("❌ Error: NOTION_API_KEY is missing.");
    process.exit(1);
}
const notion = new Client({ auth: NOTION_API_KEY });
const server = new McpServer({
    name: "notion-project-manager",
    version: "2.0.0",
});
// 2. DEFINE TOOLS
// We use 'as any' on the schemas to prevent TypeScript infinite recursion errors
// --- TOOL 1: SEARCH ---
server.tool("search_notion", "Search for a Database, Project, or Page ID.", { query: z.string() }, // <--- THE FIX
async (args) => {
    const { query } = args;
    console.log(`🔍 Searching Notion for: ${query}`);
    const response = await notion.search({
        query,
        filter: { property: "object", value: "database" },
        page_size: 5,
    });
    const simplified = response.results.map((item) => ({
        id: item.id,
        name: item.title?.[0]?.plain_text || "Untitled",
        url: item.url,
        type: item.object
    }));
    return {
        content: [{ type: "text", text: JSON.stringify(simplified, null, 2) }]
    };
});
// --- TOOL 2: CREATE TASK ---
server.tool("create_proposed_task", "Create a new task in Notion.", {
    database_id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    project_id: z.string().optional(),
    status: z.string().optional().default("To Review"),
}, // <--- THE FIX
async (args) => {
    const { database_id, title, description, project_id, status } = args;
    console.log(`📝 Creating Task: ${title}`);
    const properties = {
        Name: { title: [{ text: { content: title } }] },
        Status: { select: { name: status } },
    };
    if (project_id) {
        properties["Project"] = { relation: [{ id: project_id }] };
    }
    const response = await notion.pages.create({
        parent: { database_id: database_id },
        properties: properties,
        children: description
            ? [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: description } }] } }]
            : [],
    });
    return {
        content: [{ type: "text", text: `Created Task: ${response.url}` }]
    };
});
// --- TOOL 3: SLACK ---
server.tool("send_slack_proposal", "Send a message to Slack asking for approval.", {
    task_name: z.string(),
    notion_url: z.string(),
    reasoning: z.string(),
}, // <--- THE FIX
async (args) => {
    const { task_name, notion_url, reasoning } = args;
    if (!SLACK_WEBHOOK_URL) {
        return { content: [{ type: "text", text: "Error: No Slack URL set." }] };
    }
    await axios.post(SLACK_WEBHOOK_URL, {
        blocks: [
            { type: "header", text: { type: "plain_text", text: "🤖 New Task Proposal" } },
            { type: "section", text: { type: "mrkdwn", text: `*${task_name}*\n${reasoning}` } },
            {
                type: "actions",
                elements: [
                    { type: "button", text: { type: "plain_text", text: "View & Approve" }, url: notion_url, action_id: "view_notion" }
                ]
            }
        ]
    });
    return {
        content: [{ type: "text", text: "Slack notification sent." }]
    };
});
// 3. SERVER SETUP
const app = express();
app.use(cors());
let transport = null;
app.get("/sse", async (req, res) => {
    console.log("🔌 New SSE Connection");
    transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
});
app.post("/messages", async (req, res) => {
    if (transport)
        await transport.handlePostMessage(req, res);
});
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Notion MCP Server running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map