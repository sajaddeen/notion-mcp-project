import express from "express";
import cors from "cors";
import { Agent, run } from "@openai/agents";
import { MCPServerSSE } from "@openai/agents"; 
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json()); 
app.use(cors());

const PORT = process.env.PORT || 4000;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/sse";

const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "a83cd5da55d947b9ba44e77a7887b891";

// Initialize standard OpenAI client for the Normalizer step
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- STEP 1: NORMALIZER AGENT (Pure AI) ---
// Cleans text and extracts Status ("Done", "In Progress", "Not Started")
async function runNormalizerAgent(rawTranscript: string) {
  console.log("🧹 Orchestrator: Sending raw text to Normalizer Agent...");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
          You are a Data Normalizer Agent.
          Your job is to clean raw meeting transcripts into a structured format.
          
          OUTPUT JSON FORMAT:
          {
            "meeting_title": "Inferred Title",
            "participants": ["Name 1", "Name 2"],
            "summary": "Brief summary",
            "critical_action_items": [
              {
                "title": "Task Name",
                "description": "Context about the task",
                "suggested_status": "Not Started" | "In Progress" | "Done"
              }
            ]
          }
          
          RULES FOR STATUS:
          - If the transcript says the task is finished, completed, or done -> "Done"
          - If they are currently working on it -> "In Progress"
          - If it is a new request or future task -> "Not Started"
        `
      },
      { role: "user", content: rawTranscript }
    ],
    response_format: { type: "json_object" }
  });

  const normalizedData = JSON.parse(response.choices[0].message.content || "{}");
  console.log("✨ Normalization Complete.");
  return normalizedData;
}

// --- STEP 2: TASK GENERATING AGENT (With Tools) ---
// Takes clean data -> Updates Notion -> Notifies Slack
async function runTaskAgent(normalizedData: any) {
  console.log("🔌 Connecting to MCP Server...");
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
         - status: Use the 'suggested_status' from the input. (Defaults to 'Not Started' if unsure).
      3. AFTER creating the task, send a notification using 'send_slack_proposal'.
         - You MUST provide the 'notion_url' returned by the create task tool.
         - Provide a short 'reasoning' based on the summary.
    `,
    mcpServers: [notionServer], 
  });

  console.log("🤖 Task Agent starting...");
  const result = await run(agent, [
    { 
      role: "user", 
      content: `Process this Normalized Meeting Data: ${JSON.stringify(normalizedData)}` 
    }
  ]);

  return result.text;
}

// --- ORCHESTRATOR ENDPOINT ---
app.post("/webhook", async (req: any, res: any) => {
  try {
    console.log("📨 Orchestrator: Received Webhook.");
    const transcript = req.body.transcript || req.body.text || req.body.content;

    if (!transcript) return res.status(400).send("Missing transcript.");

    // 1. Run Normalizer
    const normalizedData = await runNormalizerAgent(transcript);

    // 2. Run Task Generator (feeding it the clean data)
    const reply = await runTaskAgent(normalizedData);
    
    console.log("✅ Orchestrator: Workflow Complete.");
    res.status(200).json({ 
      status: "success", 
      normalized_data: normalizedData,
      agent_reply: reply 
    });

  } catch (error) {
    console.error("❌ Orchestrator Error:", error);
    res.status(500).json({ error: String(error) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Orchestrator running on port ${PORT}`);
});