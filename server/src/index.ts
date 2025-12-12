// @ts-nocheck
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Client } from "@notionhq/client";
import { z } from "zod";
import cors from "cors";
import axios from "axios";
import bodyParser from 'body-parser'; 

// --- UTILITY FUNCTION ---
function getPageIdFromUrl(url: string): string | null {
  // Extracts the 32-character page ID from a Notion URL
  const match = url.match(/notion\.so\/(.+?)([?\/]|$)/);
  if (match && match[1]) {
    return match[1].slice(-32);
  }
  return null;
}

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

// 2. DEFINE TOOLS (Tool definitions remain the same)
// ... (Tool 1: search_notion) ...
server.tool("search_notion", "Search for a Database, Project, or Page ID.", { query: z.string() } as any, async (args: any) => { return { content: [{ type: "text", text: "Search results placeholder." }] }; });

// ... (Tool 2: create_proposed_task) ...
server.tool("create_proposed_task", "Create a new task in Notion.", { database_id: z.string(), title: z.string(), description: z.string().optional(), project_id: z.string().optional(), status: z.string().optional().default("Not Started"), } as any, async (args: any) => {
    const { database_id, title, description, status } = args;
    console.log(`📝 Creating Task: ${title} [Status: ${status}]`);
    const properties: any = { "Job": { title: [{ text: { content: title } }] }, "Status": { select: { name: status } }, };
    const response = await notion.pages.create({ parent: { database_id: database_id }, properties: properties, children: description ? [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: description } }] } }] : [], });
    return { content: [{ type: "text", text: `Created Task: ${(response as any).url}` }] };
});

// ... (Tool 3: update_notion_task) ...
server.tool("update_notion_task", "Update the status or title of an existing task in Notion.", { page_id: z.string(), title: z.string().optional(), status: z.string().optional() } as any, async (args: any) => { return { content: [{ type: "text", text: `Updated Task ${args.page_id} successfully (SIMULATED).` }] }; });

// ... (Tool 4: delete_notion_task) ...
server.tool("delete_notion_task", "Archive a task in Notion (Notion's version of delete).", { page_id: z.string(), } as any, async (args: any) => { return { content: [{ type: "text", text: `Archived Task ${args.page_id} successfully (SIMULATED).` }] }; });

// --- TOOL 5: SLACK (Functional Buttons) ---
server.tool("send_slack_proposal", "Send a message to Slack asking for approval.", { task_name: z.string(), notion_url: z.string(), reasoning: z.string(), } as any, async (args: any) => {
    const { task_name, notion_url, reasoning } = args;
    console.log(`💬 Sending Functional Slack Notification for: ${task_name}`);

    if (!SLACK_WEBHOOK_URL) return { content: [{ type: "text", text: "Error: No Slack URL set in .env" }] };

    await axios.post(SLACK_WEBHOOK_URL, {
      blocks: [
        { type: "header", text: { type: "plain_text", text: "New Task Proposal" } },
        { type: "section", text: { type: "mrkdwn", text: `*${task_name}*\n${reasoning}` } },
        { type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "approve_task", value: notion_url },
            { type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "skip_task", value: notion_url },
            { type: "button", text: { type: "plain_text", text: "Feedback" }, action_id: "feedback_task" }
        ]}
      ]
    });
    return { content: [{ type: "text", text: "Slack notification sent with functional buttons." }] };
});


// 3. SERVER SETUP
const app = express();
app.use(cors());

// --- BODY PARSERS DEFINITION (NOT GLOBAL APPLICATION) ---
// Define parsers locally. express.json is used for the MCP stream.
const jsonParser = express.json(); 
const slackParser = bodyParser.urlencoded({ extended: true });

let transport: SSEServerTransport | null = null;

// --- SLACK INTERACTIVITY ENDPOINT (FUNCTIONAL LOGIC) ---
// Applies the Slack-specific URL-encoded parser (slackParser)
app.post('/slack/events', slackParser, async (req, res) => {
    res.status(200).send('Processing...'); 
    
    try {
        const payload = JSON.parse(req.body.payload);
        const action = payload.actions[0];
        const actionId = action.action_id;
        const notionUrl = action.value;
        const responseUrl = payload.response_url; 
        const user = payload.user.name;

        console.log(`🔔 Slack Interactivity: Received ${actionId} click by ${user} for URL: ${notionUrl}`);

        const pageId = getPageIdFromUrl(notionUrl);

        if (!pageId) {
            await axios.post(responseUrl, { text: "Error: Could not find Notion Task ID." });
            return;
        }

        let updateStatus = null;

        if (actionId === 'approve_task') {
            updateStatus = "Done"; 
        } else if (actionId === 'skip_task') {
            await notion.pages.update({ page_id: pageId, archived: true });
            updateStatus = "Archived";
        }

        // A. Update Notion Status
        if (updateStatus && updateStatus !== "Archived") {
            await notion.pages.update({ page_id: pageId, properties: { "Status": { select: { name: updateStatus } } } });
        }

        // B. Update Slack Message (Disable buttons and show result)
        const updatedMessage = {
            replace_original: true, 
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: actionId === 'approve_task' ? `✅ Task Approved by *${user}* and set to *Done* in Notion.` : `❌ Task Skipped and Archived by *${user}*.` } },
                { type: "context", elements: [{ type: "mrkdwn", text: `<${notionUrl}|View Task in Notion>` }] }
            ]
        };
        
        await axios.post(responseUrl, updatedMessage);

    } catch (error) {
        console.error('❌ Slack Interactivity Error:', error);
    }
});


// --- MCP ENDPOINTS ---
app.get("/sse", async (req, res) => {
  console.log("🔌 New SSE Connection");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

// CRITICAL FIX: The /messages route applies the JSON parser exclusively to avoid conflict.
app.post("/messages", jsonParser, async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Notion MCP Server running on port ${PORT}`);
});