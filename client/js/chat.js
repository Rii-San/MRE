document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('oracle-chat-input');
    const chatMessages = document.getElementById('oracle-chat-history');

    let chatHistory = [];

    function addMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = role === 'user' ? 'chat-msg chat-user slide-up' : 'chat-msg chat-oracle';
        
        if (role === 'user') {
            msgDiv.textContent = text;
        } else {
            if (window.marked) {
                msgDiv.innerHTML = marked.parse(text);
            } else {
                msgDiv.textContent = text;
            }
        }

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return msgDiv;
    }

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = chatInput.value.trim();
        if (!message) return;

        addMessage('user', message);
        chatInput.value = '';
        chatInput.disabled = true;

        const aiBubble = addMessage('model', '<span class="loading-dots">Consulting the ether...</span>');
        
        try {
            const res = await fetch(apiUrl('chat/stream'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, history: chatHistory })
            });

            if (!res.ok) {
                throw new Error("API Error");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let aiFullText = "";
            aiBubble.innerHTML = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                aiFullText += chunk;
                if (window.marked) {
                    aiBubble.innerHTML = marked.parse(aiFullText);
                } else {
                    aiBubble.textContent = aiFullText;
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            const remaining = decoder.decode();
            if (remaining) {
                aiFullText += remaining;
                if (window.marked) {
                    aiBubble.innerHTML = marked.parse(aiFullText);
                } else {
                    aiBubble.textContent = aiFullText;
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            chatHistory.push({ role: 'user', parts: [{ text: message }] });
            chatHistory.push({ role: 'model', parts: [{ text: aiFullText }] });

        } catch (e) {
            aiBubble.textContent = `The connection to the ether was lost... ${e.message}`;
            console.error("Chat Error:", e);
        } finally {
            chatInput.disabled = false;
            chatInput.focus();
        }
    });

    // Initial greeting
    setTimeout(() => {
        addMessage('model', "Welcome, seeker. I am the Oracle. What mysteries of your taste shall we explore today?");
    }, 500);
});
