const express = require('express');
const router = express.Router();
const { getProfile } = require('../services/profileService');
const { generateTasteSummary } = require('../services/preprocessor');
const { sendChatMessageStreamWithFallback } = require('../services/gemini');

router.post('/stream', async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const profile = getProfile();
        // Fallback to defaults if missing eps
        const summary = await generateTasteSummary(0.32, 0.25);
        
        // Pass the entire profile to the oracle chat
        const stream = await sendChatMessageStreamWithFallback(
            summary, 
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
