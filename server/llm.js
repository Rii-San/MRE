const path = require("path");
const fs = require('fs');
const logger = require('./utils/logger');
const { embeddingCache } = require('./utils/lru');

let llama = null;
let model = null;
let context = null;

async function initModel() {
    if (llama) return;
    const modelPath = path.join(__dirname, '..', 'models', 'nomic-embed-text-v1.5.Q8_0.gguf');
    
    // Check if the file exists to avoid crashing if the user hasn't downloaded it yet
    if (!fs.existsSync(modelPath)) {
        logger.warn("⚠️ Native Model Missing: Please place 'nomic-embed-text-v1.5.Q8_0.gguf' in the models/ folder.", 'LLM');
        return;
    }

    try {
        logger.info("Loading native embedding model into VRAM...", 'LLM');
        // Use dynamic import because node-llama-cpp is an ESM module
        const { getLlama } = await import("node-llama-cpp");
        llama = await getLlama();
        model = await llama.loadModel({ 
            modelPath,
            gpuLayers: "max" // Fully offloads to the RTX 3060
        });
        context = await model.createEmbeddingContext();
        logger.info("✅ Nomic Embedding model successfully loaded natively into VRAM.", 'LLM');
    } catch (e) {
        logger.error(`❌ Failed to load native embedding model: ${e.message}`, 'LLM');
    }
}

// Call initModel asynchronously on startup
initModel();

async function getEmbedding(text) {
    if (!text || !context) {
        if (!context) logger.warn("Cannot generate embedding: model is not loaded.", 'LLM');
        return null;
    }
    
    const cached = embeddingCache.get(text);
    if (cached) return cached;

    try {
        // Generate embedding natively
        const embedding = await context.getEmbeddingFor(text);
        embeddingCache.set(text, embedding.vector);
        return embedding.vector; // Returns the float array
    } catch (e) {
        logger.error(`Native embedding generation failed: ${e.message}`, 'LLM');
        return null;
    }
}

module.exports = { getEmbedding };
