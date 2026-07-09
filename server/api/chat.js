const express = require('express');
const router = express.Router();
const { getProfile } = require('../services/profileService');
const { generateTasteSummary } = require('../services/preprocessor');
const { sendChatMessageStreamWithFallback } = require('../services/gemini');
const { getCachedTasteSummary } = require('../engine/cache');

router.post('/stream', async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const profile = getProfile();
        // Use cached summary to save time, fallback to generation if missing
        let summaryText = getCachedTasteSummary();
        if (!summaryText) {
            const result = await generateTasteSummary(3, 3);
            summaryText = result.summary;
        }
        
        // Pass the entire profile to the oracle chat
        const stream = await sendChatMessageStreamWithFallback(
            summaryText, 
            profile, 
            history || [], 
            message
        );

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of stream.stream) {
            const chunkText = chunk.text();
            res.write(chunkText);
        }
        res.end();
    } catch (e) {
        console.error("Chat API error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.end(`\n\n[Error: ${e.message}]`);
        }
    }
});

module.exports = router;
