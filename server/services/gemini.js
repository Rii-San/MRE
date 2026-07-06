const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
require('dotenv').config();
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Model Router State ──────────────────────────────────────
const fallbackModels = [
    'gemini-2.5-flash',
    'gemini-3.5-flash',
    'gemini-3-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemma-4-31b',
    'gemma-4-26b'
];
const exhaustedDailyModels = new Set();

// ── System Instruction: Oracle Persona ──────────────────────────────────────
const SYSTEM_INSTRUCTION_ORACLE = `You are "The Oracle" — a warm, intuitive guide who reads a person's soul through their movie and anime tastes.

PERSONALITY:
- Speak like a wise, observant friend — warm, natural, and down-to-earth.
- Use simple, everyday words. Never use dense esoteric jargon or overly flowery prose.
- Be genuinely curious about the person. Let your warmth come through.

TECHNIQUES YOU NATURALLY USE (never mention these by name):
1. Make statements feel deeply personal by connecting specific patterns in their data to universal human experiences.
2. Acknowledge natural contradictions everyone has — e.g., "You crave connection, yet sometimes need complete solitude." This makes people feel truly understood.
3. Frame everything positively. Honor their unique taste, even their dislikes — those reveal just as much about their identity.
4. Ground your mystical observations in their actual data. Reference specific genres, titles, or patterns you see.

RULES:
- Never say "Based on your data" or "Your profile shows" — speak as if you intuit these things naturally.
- Never break character or explain your reasoning process.
- Always complete your thoughts fully. Never end mid-sentence.
- Keep responses focused and complete — quality over quantity.`;

/**
 * Executes a Gemini API operation with fallback routing for Quota (RPD) limits
 * and exponential backoff for Rate Limits (RPM).
 * 
 * @param {function(string): Promise<any>} operationBuilder Function that takes modelName and returns a Promise.
 * @param {number} retries Max number of retries for non-fatal errors (e.g. RPM, 503).
 */
async function executeWithFallback(operationBuilder, retries = 3) {
    for (let i = 0; i < retries; i++) {
        // Find the next available model
        let selectedModel = fallbackModels.find(m => !exhaustedDailyModels.has(m));
        if (!selectedModel) {
            logger.warn('All configured fallback models are marked exhausted! Resetting the daily tracker as a last resort.', 'Gemini API');
            exhaustedDailyModels.clear();
            selectedModel = fallbackModels[0];
        }

        try {
            return await operationBuilder(selectedModel);
        } catch (error) {
            const is503 = error.status === 503 || (error.message && error.message.includes('503'));
            const is429 = error.status === 429 || (error.message && error.message.includes('429'));
            const is404 = error.status === 404 || (error.message && error.message.includes('404'));
            
            if (is404) {
                logger.warn(`404 Not Found for model: ${selectedModel}. Marking as exhausted and switching to fallback.`, 'Gemini API');
                exhaustedDailyModels.add(selectedModel);
                // Do not consume a retry attempt for a 404 hit, just continue immediately
                i--;
                continue;
            } else if (is429) {
                // Determine if this is a Quota Exceeded (RPD) or just Rate Limit (RPM)
                let isQuotaError = false;
                if (error.message && error.message.toLowerCase().includes('quota exceeded')) {
                    isQuotaError = true;
                } else if (error.errorDetails && Array.isArray(error.errorDetails)) {
                    isQuotaError = error.errorDetails.some(detail => 
                        detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure'
                    );
                }

                if (isQuotaError) {
                    logger.warn(`RPD Quota exhausted for model: ${selectedModel}. Marking as exhausted and switching to fallback.`, 'Gemini API');
                    exhaustedDailyModels.add(selectedModel);
                    // Do not consume a retry attempt for a quota hit, just continue immediately
                    i--;
                    continue; 
                } else {
                    // Rate Limit (RPM) hit
                    if (i < retries - 1) {
                        const waitTime = 2000 * Math.pow(2, i);
                        logger.warn(`429 Rate Limit (RPM) encountered for ${selectedModel}. Retrying in ${waitTime}ms... (Attempt ${i + 1} of ${retries})`, 'Gemini API');
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    } else {
                        throw error;
                    }
                }
            } else if (is503 && i < retries - 1) {
                const waitTime = 2000 * Math.pow(2, i);
                logger.warn(`503 High Demand encountered for ${selectedModel}. Retrying in ${waitTime}ms... (Attempt ${i + 1} of ${retries})`, 'Gemini API');
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // Other unexpected errors
                throw error;
            }
        }
    }
}

/**
 * Logs the finish reason and token usage for debugging truncation issues.
 */
function logResponseMeta(response, context, modelName) {
    try {
        const candidate = response.candidates?.[0];
        const finishReason = candidate?.finishReason || 'UNKNOWN';
        const usage = response.usageMetadata;

        if (finishReason === 'MAX_TOKENS') {
            logger.warn(`⚠️  Response TRUNCATED (finishReason: MAX_TOKENS) on ${modelName}.`, `Gemini ${context}`);
        } else if (finishReason !== 'STOP') {
            logger.warn(`⚠️  Unusual finishReason: ${finishReason} on ${modelName}`, `Gemini ${context}`);
        }

        if (usage) {
            logger.info(`Tokens [${modelName}] — prompt: ${usage.promptTokenCount || '?'}, response: ${usage.candidatesTokenCount || '?'}, total: ${usage.totalTokenCount || '?'}`, `Gemini ${context}`);
        }
    } catch (e) {}
}

async function generateTasteProfile(preprocessorSummary, userContext) {
    const prompt = `The seeker approaches. Here is their profile:
Name: ${userContext.name || "Unknown Seeker"}
Vedic Zodiac: ${userContext.vedicZodiac || "Unknown"}
Chinese Zodiac: ${userContext.chineseZodiac || "Unknown"}
Self Description: ${userContext.description || "None provided"}

Here is their Taste Summary extracted from their viewing history:
${preprocessorSummary}

Now, provide a profound reading divided into EXACTLY these three sections. Use markdown H3 headings (###).

### 🎬 The Cinematic Aura
Analyze their movie tastes. Identify the core emotional themes they seek on the silver screen. Reveal what contradictions live in their viewing patterns. Reference specific genres or themes from their data. (100-120 words)

### ⛩️ The Animated Soul
Analyze their anime tastes. Reveal what psychological or archetypal needs are fulfilled by their animated journeys. Connect patterns between their favorite shows. (100-120 words)

### 🌌 The Cosmic Convergence
Synthesize their movie + anime tastes with their astrological signs into a unified "Aesthetic Identity." What kind of soul are they? What do they truly seek through stories? (80-100 words)

IMPORTANT: Complete every section fully. Do not cut off mid-sentence. Keep the total to 280-340 words. Be warm, intuitive, and use simple everyday language.`;

    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION_ORACLE,
            generationConfig: { maxOutputTokens: 8192, temperature: 1.0, thinkingConfig: { thinkingBudget: 0 } },
        });
        const result = await model.generateContent(prompt);
        logResponseMeta(result.response, 'TasteProfile', modelName);
        return result.response.text();
    });
}

async function sendChatMessageStreamWithFallback(preprocessorSummary, userContext, history = [], message) {
    let traitsText = "";
    if (userContext?.traits) {
        const allTraits = [
            ...(userContext.traits.spiritual || []),
            ...(userContext.traits.popular_psychology || []),
            ...(userContext.traits.evidence_based || [])
        ];
        traitsText = allTraits
            .filter(t => t.value)
            .map(t => `- ${t.label || t.key}: ${typeof t.value === 'object' ? JSON.stringify(t.value) : t.value}`)
            .join("\n");
    } else {
        traitsText = `- Vedic Rashi: ${userContext?.vedicZodiac || "Unknown"}\n- Chinese Zodiac: ${userContext?.chineseZodiac || "Unknown"}`;
    }

    const userName = userContext?.user?.name || userContext?.name || "Unknown Seeker";
    const selfDesc = userContext?.self_description || "None provided";

    const chatSystemInstruction = `${SYSTEM_INSTRUCTION_ORACLE}

CONTEXT — THE SEEKER'S PROFILE:
Name: ${userName}
Self Description: ${selfDesc}

SEEKER'S TRAITS:
${traitsText || "None provided"}

CONTEXT — THEIR TASTE SUMMARY:
${preprocessorSummary}

CHAT RULES:
- You are now speaking directly to the seeker in a conversation.
- Answer their questions based on their taste profile and traits above.
- Keep responses concise (2-4 short paragraphs max) but ALWAYS complete your thoughts.
- Never end mid-sentence or mid-paragraph.
- If they ask about aura colors, personality traits, zodiac compatibility, or recommendations, weave your answers through the lens of their taste profile and traits.
- Stay in character as The Oracle at all times.`;

    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: chatSystemInstruction,
            generationConfig: { maxOutputTokens: 4096, temperature: 0.85, thinkingConfig: { thinkingBudget: 0 } },
        });
        const chat = model.startChat({ history });
        return await chat.sendMessageStream(message);
    });
}

async function generateRecommendationQuery(preprocessorSummary, userContext, userPrompt) {
    const schema = {
        type: SchemaType.OBJECT,
        properties: {
            boost_genres: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List of genres to boost/include based on the prompt and user's taste." },
            suppress_genres: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List of genres to strictly exclude or heavily penalize." },
            mood_keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Thematic keywords to match against plot descriptions (e.g., 'dystopia', 'revenge')." },
            target_domain: { type: SchemaType.STRING, description: "Either 'movie', 'anime', or 'both'. Infer from the user prompt." },
            explanation: { type: SchemaType.STRING, description: "A short, mystical 1-sentence explanation of why these filters were chosen." }
        },
        required: ["boost_genres", "suppress_genres", "mood_keywords", "target_domain", "explanation"]
    };

    const prompt = `User Profile:\nVedic: ${userContext.vedicZodiac || "Unknown"}, Chinese: ${userContext.chineseZodiac || "Unknown"}\n\nUser's Base Tastes:\n${preprocessorSummary}\n\nUser's Request: "${userPrompt}"\n\nGenerate the JSON query parameters to find the perfect recommendation for them right now.`;

    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are a mystical oracle translating user desires into precise database query parameters based on their cosmic and cinematic profile. Output only valid JSON matching the schema.",
            generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 2048, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
        });
        const result = await model.generateContent(prompt);
        logResponseMeta(result.response, 'RecommendationQuery', modelName);
        return JSON.parse(result.response.text());
    });
}

async function generateClusterLabel(titles) {
    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are an expert curator. Given a list of media titles, provide a single, poetic 2-to-3 word label that captures their shared vibe or archetype (e.g., 'Grand Mythic Adventures', 'Cozy Slice-of-Life', 'Dark Psychological Thrillers'). Do not use quotes or punctuation. Just the 2-3 words.",
            generationConfig: { maxOutputTokens: 10, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } }
        });
        const result = await model.generateContent(titles);
        return result.response.text().trim();
    });
}

async function generatePlotNarrative(lovedPlots, hatedPlots) {
    const prompt = `BELOVED PLOTS:\n${lovedPlots.map((p, i) => `${i+1}. ${p}`).join('\n')}\n\nDISLIKED PLOTS:\n${hatedPlots.map((p, i) => `${i+1}. ${p}`).join('\n')}\n\nFormat your response EXACTLY as:\nBELOVED: [sentence]\nDISLIKED: [sentence]`;
    
    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are an expert narrative analyst. Synthesize the core thematic DNA of these plot descriptions into two single, flowing sentences. Start each with 'Stories about...'",
            generationConfig: { maxOutputTokens: 256, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        let likedSentence = "Stories that resonate with their specific aesthetic.";
        let dislikedSentence = "Stories that lack their preferred elements.";
        
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('BELOVED:')) likedSentence = line.replace('BELOVED:', '').trim();
            if (line.startsWith('DISLIKED:')) dislikedSentence = line.replace('DISLIKED:', '').trim();
        }
        
        likedSentence = likedSentence.replace(/^"|"$/g, '');
        dislikedSentence = dislikedSentence.replace(/^"|"$/g, '');
        
        return { likedSentence, dislikedSentence };
    });
}

async function generateDailySpiritualBias(vedicSign, chineseSign) {
    const schema = {
        type: SchemaType.OBJECT,
        properties: {
            boost_genres: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List of genres to boost today based on the horoscope." },
            suppress_genres: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List of genres to avoid today based on the horoscope." },
            mood_keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Thematic keywords to match against plot descriptions today." },
            reading: { type: SchemaType.STRING, description: "A mystical 2-3 sentence daily reading integrating their Vedic and Chinese signs for today." }
        },
        required: ["boost_genres", "suppress_genres", "mood_keywords", "reading"]
    };

    const prompt = `The seeker's Vedic Rashi is ${vedicSign || "Unknown"} and their Chinese Zodiac is ${chineseSign || "Unknown"}.
Based on the astrological alignment for today, generate a mystical daily reading and the recommendation bias parameters.`;

    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are an astrological oracle. You provide a daily reading and extract recommendation parameters based on the reading. Output only valid JSON matching the schema.",
            generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 2048, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } }
        });
        const result = await model.generateContent(prompt);
        logResponseMeta(result.response, 'DailySpiritualBias', modelName);
        return JSON.parse(result.response.text());
    });
}

module.exports = {
    generateTasteProfile,
    sendChatMessageStreamWithFallback,
    generateRecommendationQuery,
    generateClusterLabel,
    generatePlotNarrative,
    generateDailySpiritualBias,
    executeWithFallback,
    genAI
};
