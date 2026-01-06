const AiManager = {
    init() {
        this.aiView = document.getElementById('sidebar-ai');
        this.navView = document.getElementById('sidebar-nav');
        this.aiMenuItem = document.getElementById('ai-menu-item');
        this.aiBackBtn = document.getElementById('ai-back-btn');
        this.aiSendBtn = document.getElementById('ai-send-btn');
        this.aiInput = document.getElementById('ai-input');
        this.aiMessages = document.getElementById('ai-chat-messages');

        this.setupEventListeners();
    },

    setupEventListeners() {
        if (this.aiMenuItem) {
            this.aiMenuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navView.style.display = 'none';
                this.aiView.style.display = 'flex';
            });
        }

        if (this.aiBackBtn) {
            this.aiBackBtn.addEventListener('click', () => {
                this.aiView.style.display = 'none';
                this.navView.style.display = 'flex';
            });
        }

        if (this.aiSendBtn) {
            this.aiSendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (this.aiInput) {
            this.aiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendMessage();
            });
        }
    },

    sendMessage() {
        const text = this.aiInput.value.trim();
        if (!text) return;

        // User Msg
        const userMsg = document.createElement('div');
        userMsg.textContent = text;
        userMsg.style.cssText = "align-self: flex-end; background: var(--accent); color: var(--bg-dark); padding: 8px; border-radius: 6px; max-width: 90%; font-size: 0.9em;";
        this.aiMessages.appendChild(userMsg);
        this.aiInput.value = '';

        // AI Response (Simulated)
        setTimeout(() => {
            const aiMsg = document.createElement('div');
            aiMsg.textContent = "This feature is not connected to backend yet.";
            aiMsg.style.cssText = "align-self: flex-start; background: var(--bg-card); color: var(--text-main); padding: 8px; border-radius: 6px; max-width: 90%; font-size: 0.9em;";
            this.aiMessages.appendChild(aiMsg);
            this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
        }, 500);

        this.aiMessages.scrollTop = this.aiMessages.scrollHeight;
    }
};

window.AiManager = AiManager;