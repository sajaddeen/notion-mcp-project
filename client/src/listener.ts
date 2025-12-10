import express from "express";
import cors from "cors";
import { Agent, run } from "@openai/agents";
import { MCPServerSSE } from "@openai/agents"; 
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json()); 
app.use(cors());

const PORT = process.env.PORT || 4000;
// REPLACE THIS WITH YOUR DEPLOYED RAILWAY SERVER URL
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://notion-mcp-project-production.up.railway.app/sse";

// --- REUSABLE AI LOGIC ---
async function processTranscript(transcriptText: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OpenAI Key");

  console.log("🔌 Connecting to MCP Server...");
  const notionServer = new MCPServerSSE({
    url: MCP_SERVER_URL,
    transportOptions: { timeout: 15000 }
  });
  
  await notionServer.connect();
  console.log("✅ Connected to Tools.");

  const agent = new Agent({
    name: "Construction PM Bot",
    model: "gpt-4o",
    instructions: `
      You are an expert Project Manager for a home renovation company.
      
      YOUR WORKFLOW:
      1. Analyze the meeting transcript.
      2. Identify specific tasks and which project they belong to (e.g. 'Island Way' or 'Ridge Oak').
      3. SEARCH for the 'Tasks' database ID if you don't have it.
      4. SEARCH for the specific Project ID (e.g. search 'Island Way') to get the relation ID.
      5. Create the tasks in Notion with status 'To Review'.
      6. Send a Slack proposal for each major task created.
    `,
    mcpServers: [notionServer], 
  });

  console.log("🤖 Agent starting analysis...");
  const result = await run(agent, [
    { 
      role: "user", 
      content: `Please process this meeting transcript and extract actionable tasks: "${transcriptText}"` 
    }
  ]);

  return result.text;
}

// --- WEBHOOK ENDPOINT (The "n8n replacement") ---
app.post("/webhook", async (req: any, res: any) => {
  try {
    console.log("📨 Received Webhook...");
    
    // Handle different data formats from Read.ai/Zapier/Postman
    const transcript = req.body.transcript || req.body.text || req.body.content;

    if (!transcript) {
       console.error("❌ No transcript found in body:", req.body);
       return res.status(400).send("Missing 'transcript' or 'text' field.");
    }

    // Trigger the Agent (Run in background or await)
    // We await it here to send the reply back to the caller
    const reply = await processTranscript(transcript);
    
    console.log("✅ Workflow Complete.");
    res.status(200).json({ status: "success", agent_reply: reply });

  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    res.status(500).json({ error: "Internal Server Error", details: String(error) });
  }
});

// --- START LISTENER ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Agent Listener running on port ${PORT}`);
  console.log(`👉 Feed transcripts to: http://localhost:${PORT}/webhook`);
});