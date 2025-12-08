// server/src/index.ts
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Client } from "@notionhq/client";
import { z } from "zod";
import cors from "cors";

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

if (!NOTION_API_KEY) {
  console.error("Error: NOTION_API_KEY is missing in environment variables.");
  process.exit(1);
}

// --- 2. SETUP NOTION & MCP ---
const notion = new Client({ auth: NOTION_API_KEY });
const server = new McpServer({
  name: "notion-mcp-server",
  version: "1.0.0",
});

// --- 3. DEFINE TOOLS ---

// Tool 1: Search Notion
server.tool(
  "search_notion",
  "Search for any page or database in Notion. Useful to find IDs.",
  { query: z.string().describe("The text to search for") },
  async ({ query }) => {
    const response = await notion.search({ query });
    return {
      content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }],
    };
  }
);

// Tool 2: Read Page Content (For reading meeting notes)
server.tool(
  "get_page_content",
  "Get the content blocks of a specific page.",
  { page_id: z.string().describe("The ID of the page to read") },
  async ({ page_id }) => {
    const response = await notion.blocks.children.list({ block_id: page_id });
    return {
      content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }],
    };
  }
);

// Tool 3: Add Task (For your workflow)
server.tool(
  "add_task",
  "Add a new item to a specific Notion database.",
  {
    database_id: z.string().describe("ID of the Task Database"),
    title: z.string().describe("Name of the task"),
    status: z.string().optional().describe("Status (e.g. 'To Do')"),
  },
  async ({ database_id, title, status }) => {
    const response = await notion.pages.create({
      parent: { database_id: database_id },
      properties: {
        Name: { title: [{ text: { content: title } }] }, // Adjust 'Name' if your DB uses a different column name
        Status: { select: { name: status || "To Do" } }, // Adjust 'Status' if needed
      },
    });
    return {
      content: [{ type: "text", text: `Task created successfully. URL: ${(response as any).url}` }],
    };
  }
);

// --- 4. EXPRESS SERVER (SSE Transport) ---
const app = express();
app.use(cors());

let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("Client connected via SSE");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Notion MCP Server running on port ${PORT}`);
});