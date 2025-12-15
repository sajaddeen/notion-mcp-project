// client/src/orchestrator_logic.ts

import { Agent, run } from "@openai/agents";
import { MCPServerSSE } from "@openai/agents"; 
import OpenAI from "openai"; 

// --- CONFIGURATION ---
const MCP_SERVER_URL = process.env.MCP_SERVER_URL; 
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NORMALIZED_SCHEMA_PROMPT = `{
  "meeting_title": "string",
  "critical_action_items": [
    { "title": "Task Name", "description": "Context about the task", "suggested_status": "Not Started" | "In Progress" | "Done" }
  ]
}`;

export async function runNormalizerAgent(rawTranscript: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "system", content: `You are the Normalizer Agent. Output tasks following this exact schema: ${NORMALIZED_SCHEMA_PROMPT}` }],
    response_format: { type: "json_object" }
  });
  return JSON.parse(response.choices[0].message.content || "{}");
}

export async function runTaskAgent(normalizedData: any) {
  const notionServer = new MCPServerSSE({ url: MCP_SERVER_URL, transportOptions: { timeout: 15000 } });
  await notionServer.connect();

  const agent = new Agent({
    name: "Construction PM Bot",
    model: "gpt-4o",
    instructions: `You are an expert Project Manager. Target Database ID: "${NOTION_DATABASE_ID}". 
        Iterate through 'critical_action_items', call 'create_proposed_task' for each, 
        and then call 'send_slack_proposal' using the returned notion_url.`,
    mcpServers: [notionServer], 
  });

  const result = await run(agent, [{ role: "user", content: `Process this Normalized Meeting Data: ${JSON.stringify(normalizedData)}` }]);
  return result.text;
}