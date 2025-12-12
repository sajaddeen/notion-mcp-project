// client/src/orchestrator_test.ts
// This script simulates the logic of your Orchestrator API Service

import { Agent, run } from "@openai/agents";
import { MCPServerSSE } from "@openai/agents"; 
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai"; 

// --- Configuration Setup ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/sse";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// --- SCHEMA FOR NORMALIZER AGENT (Simplified) ---
const NORMALIZED_SCHEMA_PROMPT = `
  OUTPUT JSON FORMAT should include:
  {
    "meeting_title": "string",
    "critical_action_items": [
      {
        "title": "Task Name",
        "description": "Context about the task",
        "suggested_status": "Not Started" | "In Progress" | "Done"
      }
    ]
  }
`;


// --- STEP 1: NORMALIZER AGENT (Pure AI) ---
async function runNormalizerAgent(rawTranscript: string) {
  console.log("🧹 1. Orchestrator: Sending raw text to Normalizer Agent...");
  
  const prompt = `
    Raw Transcript: "${rawTranscript}"
    
    Identify all actionable tasks, their status, and a brief description.
    Output the result ONLY as a JSON object conforming to the required schema.
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are the Normalizer Agent. Your task is to process the transcript and output tasks following this exact schema: ${NORMALIZED_SCHEMA_PROMPT}`
      },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" }
  });

  const rawJson = response.choices[0].message.content || "{}";
  const normalizedData = JSON.parse(rawJson);
  console.log("✨ 1. Normalization Complete.");
  return normalizedData;
}

// --- STEP 2: TASK GENERATING AGENT (With Tools) ---
async function runTaskAgent(normalizedData: any) {
  console.log("🔌 2. Connecting to MCP Server...");
  
  const notionServer = new MCPServerSSE({
    url: MCP_SERVER_URL,
    transportOptions: { timeout: 15000 }
  });
  await notionServer.connect();

  const agent = new Agent({
    name: "Construction PM Bot",
    model: "gpt-4o",
    instructions: `
      You are an expert Project Manager.
      
      INPUT DATA:
      You are receiving a PRE-NORMALIZED JSON object containing tasks with 'suggested_status'.
      
      CONFIGURATION:
      - Target Database ID: "${NOTION_DATABASE_ID}"
      
      YOUR WORKFLOW:
      1. Iterate through the 'critical_action_items' in the input data.
      2. For each item, create a task in Notion using 'create_proposed_task'.
         - database_id: Use the Target Database ID provided above.
         - title: Use the item's 'title'.
         - description: Use the item's 'description'.
         - status: Use the 'suggested_status' from the input.
      3. AFTER creating the task, send a notification using 'send_slack_proposal'.
         - You MUST provide the 'notion_url' returned by the create task tool.
         - Provide a short 'reasoning' based on the summary/description.
    `,
    mcpServers: [notionServer], 
  });

  console.log("🤖 2. Task Agent starting analysis...");
  const result = await run(agent, [
    { 
      role: "user", 
      content: `Process this Normalized Meeting Data: ${JSON.stringify(normalizedData)}` 
    }
  ]);

  return result.text;
}


// --- MAIN TEST FUNCTION (Simulates the Backend API Call) ---
async function main() {
  const testTranscript = "Sunthar: The Living Room Painting is 100% complete, so mark that done. Master Bath Plumbing is in progress. We haven't started the HVAC installation yet. Order those supplies immediately.";
  
  console.log(`\n\n--- Starting Full Orchestrator Workflow ---\n`);
  console.log(`Input Transcript: "${testTranscript}"\n`);

  if (!process.env.OPENAI_API_KEY || !NOTION_DATABASE_ID) {
      console.error("❌ ERROR: Missing OPENAI_API_KEY or NOTION_DATABASE_ID in client/.env.");
      process.exit(1);
  }

  try {
    // Stage 1: Normalization
    const normalizedData = await runNormalizerAgent(testTranscript);
    
    // Stage 2: Task Generation (Calling MCP Server)
    const reply = await runTaskAgent(normalizedData);
    
    console.log("\n-------------------------------------------------------");
    console.log("✅ Workflow Complete. Tasks Created and Notifications Sent.");
    console.log(`Final Agent Reply: ${reply}`);
    console.log("-------------------------------------------------------\n");
    
  } catch (error) {
    console.error("❌ Orchestrator Workflow Failed:", error);
  }
}

main();