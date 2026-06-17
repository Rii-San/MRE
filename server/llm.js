const path = require("path");
const fs = require('fs');

let llama = null;
let model = null;
let context = null;

async function initModel() {
    if (llama) return;
    const modelPath = path.join(__dirname, '..', 'models', 'nomic-embed-text-v1.5.Q8_0.gguf');
    
    // Check if the file exists to avoid crashing if the user hasn't downloaded it yet
    if (!fs.existsSync(modelPath)) {
        console.warn("⚠️ Native Model Missing: Please place 'nomic-embed-text-v1.5.Q8_0.gguf' in the models/ folder.");
        return;
    }

    try {
        console.log("Loading native embedding model into VRAM...");
        // Use dynamic import because node-llama-cpp is an ESM module
        const { getLlama } = await import("node-llama-cpp");
        llama = await getLlama();
        model = await llama.loadModel({ 
            modelPath,
            gpuLayers: "max" // Fully offloads to the RTX 3060
        });
        context = await model.createEmbeddingContext();
        console.log("✅ Nomic Embedding model successfully loaded natively into VRAM.");
    } catch (e) {
        console.error("❌ Failed to load native embedding model:", e);
    }
}

// Call initModel asynchronously on startup
initModel();

async function getEmbedding(text) {
    if (!text || !context) {
        if (!context) console.warn("Cannot generate embedding: model is not loaded.");
        return null;
    }
    
    try {
        // Generate embedding natively
        const embedding = await context.getEmbeddingFor(text);
        return embedding.vector; // Returns the float array
    } catch (e) {
        console.error("Native embedding generation failed:", e);
        return null;
    }
}

module.exports = { getEmbedding };
