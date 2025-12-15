// client/src/index.ts (The Orchestrator API Service)

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { runNormalizerAgent, runTaskAgent } from './orchestrator_logic.js';

dotenv.config(); 
const PORT = process.env.PORT || 4000; 

const app = express();
app.use(express.json()); 
app.use(cors());

// --- PUBLIC API ENDPOINT (/process-transcript) ---
app.post("/process-transcript", async (req: any, res: any) => {
    try {
        const rawTranscript = req.body.transcript;

        if (!rawTranscript) {
            return res.status(400).send("Missing 'transcript' in request body.");
        }
        
        console.log(`API received transcript of length: ${rawTranscript.length}`);

        // 1. Run Normalizer Agent
        const normalizedData = await runNormalizerAgent(rawTranscript);

        // 2. Run Task Generating Agent (calls the deployed MCP Server)
        const reply = await runTaskAgent(normalizedData);
        
        res.status(200).json({ 
            status: "success", 
            message: "Transcript processed successfully.",
            agent_reply: reply 
        });

    } catch (error) {
        console.error("❌ Orchestrator API Error:", error);
        res.status(500).json({ error: String(error) });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🎧 Orchestrator API running on port ${PORT}`);
});