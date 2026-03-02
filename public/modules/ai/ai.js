const AiManager = {
    initialized: false,
    isSending: false,
    chatHistory: [],

    init() {
        if (this.initialized) return;

        this.aiView = document.getElementById('sidebar-ai');
        this.navView = document.getElementById('sidebar-nav');
        this.aiMenuItem = document.getElementById('ai-menu-item');
        this.aiBackBtn = document.getElementById('ai-back-btn');
        this.aiNewChatBtn = document.getElementById('ai-new-chat-btn');
        this.aiSendBtn = document.getElementById('ai-send-btn');
        this.aiInput = document.getElementById('ai-input');
        this.aiMessages = document.getElementById('ai-chat-messages');

        if (!this.aiView || !this.aiMessages || !this.aiInput) {
            return;
        }

        this.setupEventListeners();
        this.resetChat();
        this.initialized = true;
    },

    setupEventListeners() {
        if (this.aiMenuItem) {
            this.aiMenuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openAiView();
            });
        }

        if (this.aiBackBtn) {
            this.aiBackBtn.addEventListener('click', () => {
                this.closeAiView();
            });
        }

        if (this.aiNewChatBtn) {
            this.aiNewChatBtn.addEventListener('click', () => {
                if (this.isSending) return;
                this.resetChat();
            });
        }

        if (this.aiSendBtn) {
            this.aiSendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (this.aiInput) {
            this.aiInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
    },

    openAiView() {
        if (this.navView) this.navView.style.display = 'none';
        if (this.aiView) this.aiView.style.display = 'flex';
        if (this.aiInput) this.aiInput.focus();
    },

    closeAiView() {
        if (this.aiView) this.aiView.style.display = 'none';
        if (this.navView) this.navView.style.display = 'flex';
    },

    scrollToBottom() {
        if (!this.aiMessages) return;
        this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
    },

    renderEmptyState() {
        if (!this.aiMessages) return;

        this.aiMessages.innerHTML = '';
        const emptyCard = document.createElement('div');
        emptyCard.className = 'ai-empty-card';
        emptyCard.innerHTML = `
            <div class="ai-empty-title">New Chat</div>
            <div class="ai-empty-text">Send a message to start. Press + anytime to clear this thread.</div>
        `;
        this.aiMessages.appendChild(emptyCard);
    },

    removeEmptyState() {
        if (!this.aiMessages) return;
        const emptyState = this.aiMessages.querySelector('.ai-empty-card');
        if (emptyState) emptyState.remove();
    },

    addMessage(text, role, state = 'normal') {
        this.removeEmptyState();

        const row = document.createElement('div');
        row.className = `ai-msg-row ${role}`;
        if (state === 'status') row.classList.add('status');
        if (state === 'error') row.classList.add('error');

        const bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';
        bubble.textContent = text;

        row.appendChild(bubble);
        this.aiMessages.appendChild(row);
        this.scrollToBottom();

        return { row, bubble };
    },

    setBusyState(isBusy) {
        this.isSending = Boolean(isBusy);
        if (!this.aiSendBtn) return;
        this.aiSendBtn.disabled = this.isSending;
    },

    resetChat() {
        this.chatHistory = [];
        this.renderEmptyState();
        if (this.aiInput) {
            this.aiInput.value = '';
            this.aiInput.focus();
        }
    },

    async sendMessage() {
        if (this.isSending) return;
        const text = this.aiInput.value.trim();
        if (!text) return;

        const userMessage = { role: 'user', content: text };
        this.chatHistory.push(userMessage);
        this.addMessage(text, 'user');

        this.aiInput.value = '';
        this.setBusyState(true);

        const pending = this.addMessage('Thinking...', 'ai', 'status');

        try {
            if (!window.electronAPI || !window.electronAPI.ai || typeof window.electronAPI.ai.ask !== 'function') {
                pending.row.classList.remove('status');
                pending.row.classList.add('error');
                pending.bubble.textContent = 'Error: AI IPC channel is unavailable. Restart the app.';
                return;
            }

            const result = await window.electronAPI.ai.ask({
                prompt: text,
                messages: this.chatHistory
            });

            if (!result || result.success !== true) {
                const message = result && result.message
                    ? result.message
                    : 'AI request failed.';

                pending.row.classList.remove('status');
                pending.row.classList.add('error');
                pending.bubble.textContent = `Error: ${message}`;
                return;
            }

            const assistantReply = result.reply || '(Empty response)';
            pending.row.classList.remove('status');
            pending.bubble.textContent = assistantReply;
            this.chatHistory.push({ role: 'assistant', content: assistantReply });
        } catch (err) {
            pending.row.classList.remove('status');
            pending.row.classList.add('error');
            pending.bubble.textContent = `Error: ${err && err.message ? err.message : String(err)}`;
        } finally {
            this.setBusyState(false);
            this.scrollToBottom();
        }
    }
};

window.AiManager = AiManager;
