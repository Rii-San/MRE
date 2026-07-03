const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { generateTasteSummary } = require('../services/preprocessor');
const { generateTasteProfile, sendChatMessageStreamWithFallback, generateRecommendationQuery } = require('../services/gemini');
const { getEmbedding } = require('../llm');

const profileService = require('../services/profileService');

function getUserProfile() {
    return profileService.getProfile();
}

function saveUserProfile(profile) {
    profileService.setProfile(profile);
}

router.post('/generate', async (req, res) => {
    try {
        const profile = getUserProfile();
        const summary = await generateTasteSummary();
        
        if (!summary || summary.includes('Not enough data')) {
            return res.status(400).json({ error: 'Not enough watched items to generate insights. Log some movies or anime first!' });
        }

        const reading = await generateTasteProfile(summary, profile);
        
        if (!reading || reading.trim().length < 50) {
            console.warn('[Deep Insights] Reading appears too short or empty, possible API issue.');
            return res.status(500).json({ error: 'The Oracle received an incomplete vision. Please try again.' });
        }
        
        // Generate and cache the recommendation bias
        let bias = null;
        try {
            bias = await generateRecommendationQuery(summary, profile, "Give me a general recommendation bias vector for this user.");
        } catch (biasErr) {
            console.warn('[Deep Insights] Bias generation failed (non-fatal):', biasErr.message);
            // Non-fatal — we can still return the reading without a bias vector
        }

        // Generate narrative embedding for scoring
        let narrative_embedding = null;
        try {
            const embedArr = await getEmbedding(summary);
            if (embedArr) narrative_embedding = embedArr;
        } catch (e) {
            console.warn('[Deep Insights] Narrative embedding generation failed:', e.message);
        }
        
        profile.insightsReading = reading;
        profile.tasteSummary = summary;
        if (bias) profile.bias = bias;
        if (narrative_embedding) profile.narrative_embedding = narrative_embedding;
        saveUserProfile(profile);
        
        res.json({ reading, bias });
    } catch (e) {
        console.error("Generate error:", e);
        res.status(500).json({ error: 'The Oracle could not complete the reading: ' + e.message });
    }
});

router.post('/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const profile = getUserProfile();
        const summary = profile.tasteSummary;
        
        if (!summary) {
            return res.status(400).json({ error: 'You need to consult the oracle before you start chatting' });
        }
        
        // Truncate history to last 5 exchanges (10 messages) to save tokens
        let truncatedHistory = history || [];
        if (truncatedHistory.length > 10) {
            truncatedHistory = truncatedHistory.slice(truncatedHistory.length - 10);
        }

        // Get daily reading for chat context if available
        const horoscopeService = require('../services/horoscopeService');
        const dailyReading = horoscopeService.getDailyReading();
        let chatContext = summary;
        if (dailyReading && dailyReading.reading) {
            chatContext += `\n\nTODAY'S DAILY HOROSCOPE VIBE:\n${dailyReading.reading}`;
        }

        const result = await sendChatMessageStreamWithFallback(chatContext, profile, truncatedHistory, message);
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        let totalText = '';
        
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                totalText += chunkText;
                res.write(chunkText);
            }
        }
        
        // After stream completes, check the aggregated response for issues
        const aggregated = await result.response;
        const finishReason = aggregated?.candidates?.[0]?.finishReason;
        
        if (finishReason === 'MAX_TOKENS') {
            console.warn('[Oracle Chat] ⚠️  Response was TRUNCATED (MAX_TOKENS). Consider increasing maxOutputTokens.');
        }
        
        if (totalText.trim().length === 0) {
            // Edge case: stream produced no content
            res.write("The Oracle's vision was momentarily clouded. Please ask again.");
        }
        
        res.end();
    } catch (e) {
        console.error("Chat error:", e);
        if (res.headersSent) {
            res.write(`\n\n[The Oracle's connection was interrupted: ${e.message}]`);
            res.end();
        } else {
            res.status(500).json({ error: 'Failed to consult the Oracle: ' + e.message });
        }
    }
});

module.exports = router;
