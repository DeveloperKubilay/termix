const AiManager = {
    initialized: false,
    isSending: false,
    chatHistory: [],
    selectionContext: null,
    selectionContextListener: null,
    streamSubscription: null,
    activeStreamRequestId: '',
    activeStreamMessage: null,
    activeStreamText: '',
    hasStreamActivity: false,

    init() {
        if (this.initialized) return;

        this.aiView = document.getElementById('sidebar-ai');
        this.navView = document.getElementById('sidebar-nav');
        this.sidebar = document.querySelector('.sidebar');
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
        this.adjustInputHeight();
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
            this.aiInput.addEventListener('input', () => {
                this.adjustInputHeight();
            });

            this.aiInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        if (!this.selectionContextListener) {
            this.selectionContextListener = (event) => this.handleSelectionContextEvent(event);
            window.addEventListener('termix:ai-context-selection', this.selectionContextListener);
        }

        if (!this.streamSubscription && window.electronAPI && typeof window.electronAPI.on === 'function') {
            this.streamSubscription = window.electronAPI.on('ai:stream', (event, payload) => {
                this.handleAiStreamEvent(payload);
            });
        }
    },

    openAiView() {
        if (this.sidebar) this.sidebar.classList.add('ai-mode');
        if (this.navView) this.navView.style.display = 'none';
        if (this.aiView) this.aiView.style.display = 'flex';
        if (this.aiInput) this.aiInput.focus();
    },

    closeAiView() {
        if (this.sidebar) this.sidebar.classList.remove('ai-mode');
        if (this.aiView) this.aiView.style.display = 'none';
        if (this.navView) this.navView.style.display = 'flex';
    },

    adjustInputHeight() {
        if (!this.aiInput) return;

        this.aiInput.style.height = 'auto';
        const nextHeight = Math.max(44, Math.min(this.aiInput.scrollHeight, 180));
        this.aiInput.style.height = `${nextHeight}px`;
        this.aiInput.style.overflowY = this.aiInput.scrollHeight > 180 ? 'auto' : 'hidden';
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
        if (role === 'ai' && state === 'normal') {
            this.renderAssistantMessage({ bubble }, text);
        } else {
            bubble.textContent = text;
        }

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

    setMessageState(messageRef, state = 'normal') {
        if (!messageRef || !messageRef.row) return;
        messageRef.row.classList.remove('status', 'error');
        if (state === 'status') {
            messageRef.row.classList.add('status');
        } else if (state === 'error') {
            messageRef.row.classList.add('error');
        }
    },

    normalizeCommandForRun(command) {
        const value = String(command || '');
        if (!value) return '\r';
        if (value.endsWith('\r') || value.endsWith('\n')) {
            return value;
        }
        return `${value}\r`;
    },

    getActiveTerminalSession() {
        if (!window.TabManager || !Array.isArray(window.TabManager.tabs)) {
            return null;
        }

        const activeTab = window.TabManager.tabs.find((item) => item.id === window.TabManager.activeTabId);
        if (!activeTab || !activeTab.sessionObj || !activeTab.sessionObj.sessionId) {
            return null;
        }

        return activeTab.sessionObj;
    },

    async copyCodeBlock(code) {
        const value = String(code || '');
        if (!value) return;

        try {
            if (window.clipboard && typeof window.clipboard.writeText === 'function') {
                await window.clipboard.writeText(value);
            } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
            } else {
                throw new Error('Clipboard API is unavailable.');
            }
        } catch (err) {
            console.warn('Failed to copy AI message content.', err);
        }
    },

    sendCodeToTerminal(code) {
        const session = this.getActiveTerminalSession();
        if (!session || !window.electronAPI || typeof window.electronAPI.send !== 'function') {
            if (window.TabManager && typeof window.TabManager.activateTab === 'function') {
                window.TabManager.activateTab('dashboard');
            }
            return;
        }

        window.electronAPI.send('term-input', {
            sessionId: session.sessionId,
            data: this.normalizeCommandForRun(code)
        });
    },

    isShellCodeLanguage(language) {
        const normalized = String(language || '').trim().toLowerCase();
        return ['bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat'].includes(normalized);
    },

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getMarkdownRenderer() {
        if (this.markdownRenderer) {
            return this.markdownRenderer;
        }

        if (typeof window.markdownit !== 'function') {
            return null;
        }

        const renderer = window.markdownit({
            html: false,
            linkify: true,
            breaks: true
        });

        const defaultLinkOpen = renderer.renderer.rules.link_open
            || function linkOpen(tokens, idx, options, env, self) {
                return self.renderToken(tokens, idx, options);
            };

        renderer.renderer.rules.link_open = function linkOpen(tokens, idx, options, env, self) {
            tokens[idx].attrSet('target', '_blank');
            tokens[idx].attrSet('rel', 'noreferrer');
            return defaultLinkOpen(tokens, idx, options, env, self);
        };

        this.markdownRenderer = renderer;
        return renderer;
    },

    renderMarkdownHtml(value) {
        const source = String(value == null ? '' : value);
        if (!source.trim()) {
            return '';
        }

        const renderer = this.getMarkdownRenderer();
        if (!renderer) {
            return `<p>${this.escapeHtml(source)}</p>`;
        }

        return renderer.render(source);
    },

    normalizeCodeBlockValue(value, language) {
        const lines = String(value == null ? '' : value)
            .replace(/\r\n/g, '\n')
            .split('\n');

        while (lines.length && !lines[0].trim()) {
            lines.shift();
        }

        while (lines.length && !lines[lines.length - 1].trim()) {
            lines.pop();
        }

        if (!lines.length) {
            return '';
        }

        const nonEmptyIndentLengths = lines
            .filter((line) => line.trim())
            .map((line) => {
                const indent = line.match(/^[ \t]*/);
                return indent ? indent[0].length : 0;
            });

        const minIndent = nonEmptyIndentLengths.length
            ? Math.min(...nonEmptyIndentLengths)
            : 0;

        const normalizedLines = minIndent > 0
            ? lines.map((line) => (line.trim() ? line.slice(minIndent) : ''))
            : lines;

        if (!this.isShellCodeLanguage(language)) {
            return normalizedLines.join('\n');
        }

        return normalizedLines
            .map((line) => line.replace(/[ \t]+$/g, ''))
            .join('\n');
    },

    parseAssistantSegments(text) {
        const value = String(text == null ? '' : text);
        const segments = [];
        const pattern = /```([a-zA-Z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(value)) !== null) {
            if (match.index > lastIndex) {
                segments.push({
                    type: 'text',
                    value: value.slice(lastIndex, match.index)
                });
            }

            segments.push({
                type: 'code',
                language: String(match[1] || '').trim().toLowerCase(),
                value: String(match[2] || '').replace(/\r?\n$/, '')
            });
            lastIndex = pattern.lastIndex;
        }

        if (lastIndex < value.length) {
            segments.push({
                type: 'text',
                value: value.slice(lastIndex)
            });
        }

        return segments.length ? segments : [{ type: 'text', value }];
    },

    createCodeActionButton(iconClass, label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-code-action-btn';
        button.innerHTML = `<i class="${iconClass}"></i> ${label}`;
        button.addEventListener('click', onClick);
        return button;
    },

    createMessageCopyButton(text) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-msg-copy-btn';
        button.title = 'Mesaji kopyala';
        button.setAttribute('aria-label', 'Mesaji kopyala');
        button.innerHTML = '<i class="fa-solid fa-copy"></i> Kopyala';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.copyCodeBlock(text);
        });
        return button;
    },

    renderAssistantMessage(messageRef, text) {
        if (!messageRef || !messageRef.bubble) return;

        const bubble = messageRef.bubble;
        bubble.textContent = '';
        bubble.classList.add('has-ai-toolbar');

        const toolbar = document.createElement('div');
        toolbar.className = 'ai-msg-toolbar';
        toolbar.appendChild(this.createMessageCopyButton(text));
        bubble.appendChild(toolbar);

        const content = document.createElement('div');
        content.className = 'ai-msg-content';
        bubble.appendChild(content);

        const segments = this.parseAssistantSegments(text);

        segments.forEach((segment) => {
            if (segment.type === 'text') {
                if (!segment.value) return;
                const renderedHtml = this.renderMarkdownHtml(segment.value);
                if (!renderedHtml.trim()) return;
                const textBlock = document.createElement('div');
                textBlock.className = 'ai-rich-text';
                textBlock.innerHTML = renderedHtml;
                content.appendChild(textBlock);
                return;
            }

            const codeWrap = document.createElement('div');
            codeWrap.className = 'ai-code-block';
            const normalizedCode = this.normalizeCodeBlockValue(segment.value, segment.language);

            const header = document.createElement('div');
            header.className = 'ai-code-header';

            const label = document.createElement('span');
            label.className = 'ai-code-language';
            label.textContent = segment.language || 'code';

            const actions = document.createElement('div');
            actions.className = 'ai-code-actions';

            actions.appendChild(this.createCodeActionButton(
                'fa-solid fa-copy',
                'Kopyala',
                () => { this.copyCodeBlock(normalizedCode); }
            ));

            if (this.isShellCodeLanguage(segment.language)) {
                actions.appendChild(this.createCodeActionButton(
                    'fa-solid fa-terminal',
                    'Terminale Yapistir',
                    () => { this.sendCodeToTerminal(normalizedCode); }
                ));
            }

            header.appendChild(label);
            header.appendChild(actions);

            const pre = document.createElement('pre');
            pre.className = 'ai-code-pre';

            const code = document.createElement('code');
            code.className = 'ai-code-text';
            code.textContent = normalizedCode;

            pre.appendChild(code);
            codeWrap.appendChild(header);
            codeWrap.appendChild(pre);
            content.appendChild(codeWrap);
        });

        if (!content.childNodes.length) {
            const textBlock = document.createElement('div');
            textBlock.className = 'ai-rich-text';
            textBlock.textContent = String(text || '');
            content.appendChild(textBlock);
        }
    },

    generateRequestId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    },

    trackPendingStream(requestId, messageRef) {
        this.activeStreamRequestId = String(requestId || '');
        this.activeStreamMessage = messageRef || null;
        this.activeStreamText = '';
        this.hasStreamActivity = false;
    },

    clearPendingStream() {
        this.activeStreamRequestId = '';
        this.activeStreamMessage = null;
        this.activeStreamText = '';
        this.hasStreamActivity = false;
    },

    handleAiStreamEvent(payload) {
        if (!payload || String(payload.requestId || '') !== this.activeStreamRequestId) {
            return;
        }

        const messageRef = this.activeStreamMessage;
        if (!messageRef || !messageRef.bubble) {
            return;
        }

        const phase = String(payload.phase || '').trim().toLowerCase();
        const nextText = typeof payload.text === 'string' ? payload.text : '';
        const errorText = payload && payload.error ? String(payload.error) : 'AI request failed.';

        if (phase === 'start') {
            this.setMessageState(messageRef, 'status');
            if (!messageRef.bubble.textContent) {
                messageRef.bubble.textContent = 'Thinking...';
            }
            return;
        }

        if (phase === 'delta') {
            this.hasStreamActivity = true;
            this.activeStreamText = nextText;
            this.setMessageState(messageRef, 'normal');
            if (nextText) {
                this.renderAssistantMessage(messageRef, nextText);
            }
            this.scrollToBottom();
            return;
        }

        if (phase === 'complete') {
            this.hasStreamActivity = true;
            this.activeStreamText = nextText;
            this.setMessageState(messageRef, 'normal');
            if (nextText) {
                this.renderAssistantMessage(messageRef, nextText);
            }
            this.scrollToBottom();
            return;
        }

        if (phase === 'error') {
            this.setMessageState(messageRef, 'error');
            messageRef.bubble.textContent = `Error: ${errorText}`;
            this.scrollToBottom();
        }
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
        this.clearPendingStream();
        this.renderEmptyState();
        this.renderSelectionContextChip();
        if (this.aiInput) {
            this.aiInput.value = '';
            this.adjustInputHeight();
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
        this.adjustInputHeight();
        this.setBusyState(true);

        const requestId = this.generateRequestId();
        const pending = this.addMessage('Thinking...', 'ai', 'status');
        this.trackPendingStream(requestId, pending);

        try {
            if (!window.electronAPI || !window.electronAPI.ai || typeof window.electronAPI.ai.ask !== 'function') {
                this.setMessageState(pending, 'error');
                pending.bubble.textContent = 'Error: AI IPC channel is unavailable. Restart the app.';
                return;
            }

            const result = await window.electronAPI.ai.ask({
                requestId,
                prompt: aiPrompt,
                messages: this.chatHistory
            });

            if (!result || result.success !== true) {
                const message = result && result.message
                    ? result.message
                    : 'AI request failed.';

                this.setMessageState(pending, 'error');
                pending.bubble.textContent = `Error: ${message}`;
                return;
            }

            const assistantReply = result.reply || this.activeStreamText || '(Empty response)';
            this.setMessageState(pending, 'normal');
            this.renderAssistantMessage(pending, assistantReply);
            this.chatHistory.push({ role: 'assistant', content: assistantReply });
        } catch (err) {
            this.setMessageState(pending, 'error');
            pending.bubble.textContent = `Error: ${err && err.message ? err.message : String(err)}`;
        } finally {
            this.clearPendingStream();
            this.setBusyState(false);
            this.scrollToBottom();
        }
    }
};

window.AiManager = AiManager;
