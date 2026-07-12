document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('oracle-chat-input');
    const chatMessages = document.getElementById('oracle-chat-history');
    const sessionList = document.getElementById('chat-session-list');
    const newChatBtn = document.getElementById('new-chat-btn');

    const toggleSidebarBtn = document.getElementById('toggle-chat-sidebar');
    const chatSidebar = document.querySelector('.chat-sidebar');
    const chatLayout = document.querySelector('.chat-layout');

    toggleSidebarBtn.addEventListener('click', () => {
        chatSidebar.classList.toggle('collapsed');
        chatLayout.classList.toggle('collapsed-sidebar');
    });

    let currentSessionId = null;

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

    async function loadSessions() {
        try {
            const res = await fetch(apiUrl('chat/sessions'));
            if (!res.ok) throw new Error("Failed to load sessions");
            const sessions = await res.json();
            
            sessionList.innerHTML = '';
            let currentGroup = null;

            sessions.forEach(session => {
                const date = new Date(session.created_at + 'Z'); // ensure UTC parsing if missing Z
                const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });

                if (currentGroup !== monthYear) {
                    currentGroup = monthYear;
                    const header = document.createElement('div');
                    header.className = 'chat-session-group-header';
                    header.textContent = currentGroup;
                    header.style.cssText = 'font-size: 0.75rem; color: var(--text-secondary); padding: 1rem 0.5rem 0.25rem 0.5rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-top: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 0.5rem;';
                    if (sessionList.children.length === 0) header.style.marginTop = '0';
                    sessionList.appendChild(header);
                }

                const item = document.createElement('div');
                item.className = `chat-session-item ${session.id === currentSessionId ? 'active' : ''}`;
                item.innerHTML = `
                    <div class="chat-session-title" title="${session.title}">${session.title}</div>
                    <input type="text" class="chat-session-title-input" value="${session.title}" />
                    <div class="chat-session-actions">
                        <button class="chat-session-action-btn edit-btn" title="Rename">✎</button>
                        <button class="chat-session-action-btn delete-btn" title="Delete">×</button>
                    </div>
                `;
                
                const titleDiv = item.querySelector('.chat-session-title');
                const titleInput = item.querySelector('.chat-session-title-input');
                const editBtn = item.querySelector('.edit-btn');
                const deleteBtn = item.querySelector('.delete-btn');

                item.addEventListener('click', (e) => {
                    if (item.classList.contains('editing') || e.target.closest('.chat-session-actions')) return;
                    loadSessionMessages(session.id);
                });

                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.classList.add('editing');
                    titleInput.focus();
                });

                async function saveTitle() {
                    const newTitle = titleInput.value.trim();
                    item.classList.remove('editing');
                    if (newTitle && newTitle !== session.title) {
                        titleDiv.textContent = newTitle;
                        session.title = newTitle;
                        await fetch(apiUrl(`chat/sessions/${session.id}`), {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: newTitle })
                        });
                    } else {
                        titleInput.value = session.title;
                    }
                }

                titleInput.addEventListener('blur', saveTitle);
                titleInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        titleInput.blur();
                    } else if (e.key === 'Escape') {
                        titleInput.value = session.title;
                        titleInput.blur();
                    }
                });

                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm("Delete this chat?")) {
                        await fetch(apiUrl(`chat/sessions/${session.id}`), { method: 'DELETE' });
                        if (currentSessionId === session.id) {
                            startNewChat();
                        } else {
                            loadSessions();
                        }
                    }
                });

                sessionList.appendChild(item);
            });
        } catch (e) {
            console.error(e);
        }
    }

    async function loadSessionMessages(sessionId) {
        currentSessionId = sessionId;
        chatMessages.innerHTML = '';
        loadSessions(); // Re-render sidebar to update active state

        try {
            const res = await fetch(apiUrl(`chat/sessions/${sessionId}/messages`));
            if (!res.ok) throw new Error("Failed to load messages");
            const messages = await res.json();
            
            if (messages.length === 0) {
                addMessage('model', "Welcome, seeker. I am the Oracle. What mysteries of your taste shall we explore today?");
            } else {
                messages.forEach(msg => {
                    addMessage(msg.role, msg.content);
                });
            }
        } catch (e) {
            console.error(e);
        }
    }

    function startNewChat() {
        currentSessionId = null;
        chatMessages.innerHTML = '';
        loadSessions();
        setTimeout(() => {
            addMessage('model', "Welcome, seeker. I am the Oracle. What mysteries of your taste shall we explore today?");
        }, 100);
    }

    newChatBtn.addEventListener('click', startNewChat);

    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (typeof chatForm.requestSubmit === 'function') {
                chatForm.requestSubmit();
            } else {
                chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        }
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = chatInput.value.trim();
        if (!message) return;

        addMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        chatInput.disabled = true;

        if (!currentSessionId) {
            try {
                const createRes = await fetch(apiUrl('chat/sessions'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New Chat' })
                });
                const newSession = await createRes.json();
                currentSessionId = newSession.id;
            } catch (e) {
                console.error("Failed to create session", e);
                chatInput.disabled = false;
                return;
            }
        }

        const aiBubble = addMessage('model', '<span class="loading-dots">Consulting the ether...</span>');
        
        try {
            const res = await fetch(apiUrl('chat/stream'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, sessionId: currentSessionId })
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

            // Reload sessions to update title if it was first message
            loadSessions();

        } catch (e) {
            aiBubble.textContent = `The connection to the ether was lost... ${e.message}`;
            console.error("Chat Error:", e);
        } finally {
            chatInput.disabled = false;
            chatInput.focus();
        }
    });

    // Initialize
    loadSessions();
    startNewChat();
});
