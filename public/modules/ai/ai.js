const AiManager = {
    initialized: false,
    isSending: false,
    chatHistory: [],
    selectionContext: null,
    selectionContextListener: null,

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
        this.aiContextBar = document.getElementById('ai-context-bar');

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

        if (!this.selectionContextListener) {
            this.selectionContextListener = (event) => this.handleSelectionContextEvent(event);
            window.addEventListener('termix:ai-context-selection', this.selectionContextListener);
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

    normalizeInlineText(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    },

    truncateText(value, maxLength) {
        const text = String(value == null ? '' : value);
        if (!Number.isInteger(maxLength) || maxLength <= 3 || text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength - 1)}...`;
    },

    buildContextChipLabel(context) {
        if (!context) return '';

        const preview = this.normalizeInlineText(context.text || '');
        const compactPreview = this.truncateText(preview, 26);
        if (!compactPreview) return 'Terminal Log';
        return `Terminal Log: ${compactPreview}`;
    },

    renderSelectionContextChip() {
        if (!this.aiContextBar) return;

        this.aiContextBar.innerHTML = '';
        if (!this.selectionContext) {
            this.aiContextBar.hidden = true;
            return;
        }

        const chip = document.createElement('div');
        chip.className = 'ai-context-chip';

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-link';

        const label = document.createElement('span');
        label.className = 'ai-context-chip-label';
        label.textContent = this.buildContextChipLabel(this.selectionContext);
        label.title = `${this.selectionContext.sourceLabel}\n${this.selectionContext.text}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'ai-context-chip-remove';
        removeBtn.title = 'Remove context';
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.addEventListener('click', () => {
            this.clearSelectionContext();
        });

        chip.appendChild(icon);
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        this.aiContextBar.appendChild(chip);
        this.aiContextBar.hidden = false;
    },

    clearSelectionContext() {
        this.selectionContext = null;
        this.renderSelectionContextChip();
    },

    handleSelectionContextEvent(event) {
        const detail = event && event.detail ? event.detail : {};
        const sourceId = String(detail.sourceId || '').trim() || 'terminal:unknown';
        const sourceLabel = String(detail.sourceLabel || '').trim() || 'terminal';
        const text = String(detail.text || '').trim();

        if (!text) {
            if (this.selectionContext && this.selectionContext.sourceId === sourceId) {
                this.clearSelectionContext();
            }
            return;
        }

        this.selectionContext = {
            sourceId,
            sourceLabel,
            text
        };
        this.renderSelectionContextChip();
    },

    buildPromptWithSelectionContext(userText) {
        if (!this.selectionContext || !this.selectionContext.text) {
            return userText;
        }

        const MAX_CONTEXT_CHARS = 4000;
        const rawContext = String(this.selectionContext.text || '');
        const truncatedContext = rawContext.length > MAX_CONTEXT_CHARS
            ? `${rawContext.slice(0, MAX_CONTEXT_CHARS)}\n[Truncated: selection is longer than 4000 chars]`
            : rawContext;

        return [
            '[Selected terminal context]',
            `Source: ${this.selectionContext.sourceLabel}`,
            'Selection:',
            truncatedContext,
            '',
            `User request: ${userText}`
        ].join('\n');
    },

    resetChat() {
        this.chatHistory = [];
        this.renderEmptyState();
        this.renderSelectionContextChip();
        if (this.aiInput) {
            this.aiInput.value = '';
            this.aiInput.focus();
        }
    },

    async sendMessage() {
        if (this.isSending) return;
        const userText = this.aiInput.value.trim();
        if (!userText) return;

        const aiPrompt = this.buildPromptWithSelectionContext(userText);
        const userMessage = { role: 'user', content: aiPrompt };
        this.chatHistory.push(userMessage);
        this.addMessage(userText, 'user');

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
                prompt: aiPrompt,
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
