const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getProfile } = require('../services/profileService');
const { generateTasteSummary } = require('../services/preprocessor');
const { sendChatMessageStreamWithFallback } = require('../services/gemini');
const { getCachedTasteSummary } = require('../engine/cache');
const chatDb = require('../db/chatDb');

// Get all sessions
router.get('/sessions', (req, res) => {
    try {
        const sessions = chatDb.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all();
        res.json(sessions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create a new session
router.post('/sessions', (req, res) => {
    try {
        const { title } = req.body;
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        chatDb.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(id, title || 'New Chat');
        const session = chatDb.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
        res.json(session);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get messages for a session
router.get('/sessions/:id/messages', (req, res) => {
    try {
        const messages = chatDb.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(req.params.id);
        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete a session
router.delete('/sessions/:id', (req, res) => {
    try {
        chatDb.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Stream message
router.post('/stream', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        if (!message || !sessionId) {
            return res.status(400).json({ error: 'Message and sessionId are required.' });
        }

        // Save user message to DB
        chatDb.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, 'user', message);

        // Update session title if it's the first message
        const messageCount = chatDb.prepare('SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?').get(sessionId).count;
        if (messageCount === 1) {
            const title = message.split(' ').slice(0, 5).join(' ') + (message.split(' ').length > 5 ? '...' : '');
            chatDb.prepare('UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, sessionId);
        } else {
            chatDb.prepare('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
        }

        // Fetch history for LLM
        const dbMessages = chatDb.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);
        const history = dbMessages.slice(0, -1).map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        const profile = getProfile();
        let summaryText = getCachedTasteSummary();
        if (!summaryText) {
            const result = await generateTasteSummary(3, 3);
            summaryText = result.summary;
        }
        
        const stream = await sendChatMessageStreamWithFallback(
            summaryText, 
            profile, 
            history || [], 
            message
        );

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        let fullAiText = '';

        for await (const chunk of stream.stream) {
            const chunkText = chunk.text();
            fullAiText += chunkText;
            res.write(chunkText);
        }
        res.end();

        // Save AI response to DB
        chatDb.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, 'model', fullAiText);
        chatDb.prepare('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);

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
