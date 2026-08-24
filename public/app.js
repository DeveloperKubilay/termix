const Drawer = {
    element: null,
    overlay: null,
    titleElement: null,
    contentElement: null,
    closeButton: null,

    init() {
        this.element = document.getElementById('right-drawer');
        this.overlay = document.getElementById('drawer-overlay');
        this.titleElement = document.getElementById('drawer-title');
        this.contentElement = document.getElementById('drawer-content');
        this.closeButton = document.getElementById('close-drawer');

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.close());
        }

        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.close());
        }

        const drawerCheck = document.getElementById('drawer-check');
        if (drawerCheck) {
            drawerCheck.addEventListener('click', () => {
                // Find the primary action button inside the drawer content
                const primaryBtn = this.contentElement.querySelector('.btn-drawer-primary');
                if (primaryBtn) {
                    primaryBtn.click();
                }
            });
        }
    },

    open(title, contentHtml) {
        if (title) this.titleElement.textContent = title;
        if (contentHtml) this.contentElement.innerHTML = contentHtml;
        this.element.classList.add('open');
        if (this.overlay) this.overlay.classList.add('open');
    },

    close() {
        this.element.classList.remove('open');
        if (this.overlay) this.overlay.classList.remove('open');
    },
    
    setContent(html) {
        this.contentElement.innerHTML = html;
    }
};

window.Drawer = Drawer;

const ThemeManager = {
    themes: ['classic', 'modern'],
    defaultTheme: 'modern',
    storageKey: 'termix-ui-theme',
    currentTheme: 'modern',
    legacyThemeMap: {
        ocean: 'modern',
        graphite: 'modern',
        emerald: 'modern',
        sunset: 'modern'
    },

    normalizeTheme(theme) {
        let normalized = String(theme || '').trim().toLowerCase();
        if (this.legacyThemeMap[normalized]) {
            normalized = this.legacyThemeMap[normalized];
        }
        return this.themes.includes(normalized) ? normalized : this.defaultTheme;
    },

    apply(theme, options = {}) {
        const nextTheme = this.normalizeTheme(theme);
        this.currentTheme = nextTheme;
        document.documentElement.setAttribute('data-theme', nextTheme);

        if (options.persist !== false) {
            try {
                localStorage.setItem(this.storageKey, nextTheme);
            } catch (_) {}
        }

        return nextTheme;
    },

    async init() {
        if (window.electronAPI && window.electronAPI.settings && window.electronAPI.settings.getSettings) {
            try {
                const payload = await window.electronAPI.settings.getSettings();
                this.apply(payload && payload.uiTheme, { persist: true });
                return this.currentTheme;
            } catch (err) {
                console.warn('Failed to load UI theme from profile settings:', err);
            }
        }

        let cachedTheme = null;
        try {
            cachedTheme = localStorage.getItem(this.storageKey);
        } catch (_) {}

        this.apply(cachedTheme, { persist: false });
        return this.currentTheme;
    },

    getCurrentTheme() {
        return this.currentTheme;
    }
};
window.ThemeManager = ThemeManager;

const AppNotify = {
    container: null,
    maxItems: 5,

    init() {
        this.container = document.getElementById('app-notifications');
    },

    getDuration(type) {
        if (type === 'error') return 6000;
        if (type === 'warning') return 4500;
        if (type === 'success') return 2200;
        return 2800;
    },

    remove(item, immediate = false) {
        if (!item) return;
        if (item.dataset && item.dataset.timerId) {
            clearTimeout(Number(item.dataset.timerId));
        }
        if (immediate) {
            item.remove();
            return;
        }
        item.classList.remove('show');
        setTimeout(() => item.remove(), 180);
    },

    show(message, type = 'info', options = {}) {
        if (!message || options.silent) return;
        if (!this.container) this.init();
        if (!this.container) return;

        const normalizedType = ['error', 'warning', 'success', 'info'].includes(type) ? type : 'info';
        const iconMap = {
            error: 'fa-circle-exclamation',
            warning: 'fa-triangle-exclamation',
            success: 'fa-check-circle',
            info: 'fa-circle-info'
        };

        const item = document.createElement('div');
        item.className = `app-notify ${normalizedType}`;
        item.innerHTML = `
            <i class="app-notify-icon fa-solid ${iconMap[normalizedType]}"></i>
            <div class="app-notify-message"></div>
            <button type="button" class="app-notify-close" aria-label="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        const messageEl = item.querySelector('.app-notify-message');
        if (messageEl) {
            messageEl.textContent = String(message);
        }

        const closeBtn = item.querySelector('.app-notify-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.remove(item));
        }

        this.container.appendChild(item);
        requestAnimationFrame(() => item.classList.add('show'));

        while (this.container.children.length > this.maxItems) {
            this.remove(this.container.firstElementChild, true);
        }

        if (!options.sticky) {
            const timerId = setTimeout(
                () => this.remove(item),
                typeof options.duration === 'number' ? options.duration : this.getDuration(normalizedType)
            );
            item.dataset.timerId = String(timerId);
        }
    }
};

window.AppNotify = AppNotify;
window.notifyUser = (message, type = 'info', options = {}) => {
    if (window.AppNotify && typeof window.AppNotify.show === 'function') {
        window.AppNotify.show(message, type, options);
        return;
    }
    if (type === 'error') {
        console.error(message);
        return;
    }
    console.log(message);
};

const AppConfirm = {
    overlay: null,
    titleEl: null,
    messageEl: null,
    okBtn: null,
    cancelBtn: null,
    iconEl: null,
    optionWrap: null,
    optionInput: null,
    optionTextEl: null,
    resolver: null,
    keyHandler: null,
    returnDetails: false,

    init() {
        this.overlay = document.getElementById('app-confirm-overlay');
        this.titleEl = document.getElementById('app-confirm-title');
        this.messageEl = document.getElementById('app-confirm-message');
        this.okBtn = document.getElementById('app-confirm-ok');
        this.cancelBtn = document.getElementById('app-confirm-cancel');
        this.iconEl = document.getElementById('app-confirm-icon');
        this.optionWrap = document.getElementById('app-confirm-option-wrap');
        this.optionInput = document.getElementById('app-confirm-option-input');
        this.optionTextEl = document.getElementById('app-confirm-option-text');

        if (!this.overlay || !this.okBtn || !this.cancelBtn) return;

        this.okBtn.addEventListener('click', () => this.close(true));
        this.cancelBtn.addEventListener('click', () => this.close(false));

        this.overlay.addEventListener('click', (event) => {
            if (event.target === this.overlay) {
                this.close(false);
            }
        });
    },

    resetOption() {
        if (this.optionWrap) {
            this.optionWrap.hidden = true;
        }
        if (this.optionInput) {
            this.optionInput.checked = false;
        }
        if (this.optionTextEl) {
            this.optionTextEl.textContent = '';
        }
    },

    close(value) {
        if (!this.overlay) return;
        this.overlay.classList.remove('show');

        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }

        const pending = this.resolver;
        const response = this.returnDetails
            ? {
                confirmed: Boolean(value),
                checked: Boolean(this.optionInput && this.optionInput.checked)
            }
            : Boolean(value);

        this.resolver = null;
        this.returnDetails = false;
        this.resetOption();
        if (pending) pending(response);
    },

    confirm(message, options = {}) {
        const text = String(message || '').trim();
        if (!text) return Promise.resolve(false);

        if (!this.overlay) this.init();
        if (!this.overlay || !this.okBtn || !this.cancelBtn || !this.titleEl || !this.messageEl) {
            console.warn('AppConfirm UI is unavailable.');
            return Promise.resolve(false);
        }

        if (this.resolver) {
            this.close(false);
        }

        const title = options.title || 'Confirm';
        const okText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const tone = options.tone === 'danger' ? 'danger' : 'info';
        const checkboxLabel = typeof options.checkboxLabel === 'string'
            ? options.checkboxLabel.trim()
            : '';

        this.titleEl.textContent = title;
        this.messageEl.textContent = text;
        this.okBtn.textContent = okText;
        this.cancelBtn.textContent = cancelText;
        this.returnDetails = Boolean(options.returnDetails || checkboxLabel);

        if (this.optionWrap && this.optionInput && this.optionTextEl) {
            const showCheckbox = Boolean(checkboxLabel);
            this.optionWrap.hidden = !showCheckbox;
            this.optionInput.checked = showCheckbox ? Boolean(options.checkboxChecked) : false;
            this.optionTextEl.textContent = checkboxLabel;
        }

        this.okBtn.classList.remove('danger');
        if (tone === 'danger') {
            this.okBtn.classList.add('danger');
            if (this.iconEl) {
                this.iconEl.className = 'fa-solid fa-triangle-exclamation';
                this.iconEl.style.color = '#f38ba8';
            }
        } else if (this.iconEl) {
            this.iconEl.className = 'fa-solid fa-circle-question';
            this.iconEl.style.color = '#89b4fa';
        }

        this.overlay.classList.add('show');

        return new Promise((resolve) => {
            this.resolver = resolve;
            this.keyHandler = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.close(false);
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    this.close(true);
                }
            };
            document.addEventListener('keydown', this.keyHandler);
            setTimeout(() => this.okBtn.focus(), 0);
        });
    }
};

window.AppConfirm = AppConfirm;
window.confirmAction = (message, options = {}) => {
    if (window.AppConfirm && typeof window.AppConfirm.confirm === 'function') {
        return window.AppConfirm.confirm(message, options);
    }
    return Promise.resolve(false);
};
window.confirmActionWithOption = (message, options = {}) => {
    if (window.AppConfirm && typeof window.AppConfirm.confirm === 'function') {
        return window.AppConfirm.confirm(message, {
            ...options,
            returnDetails: true
        });
    }
    return Promise.resolve({ confirmed: false, checked: false });
};

const TermixFontLoader = {
    family: '"JetBrains Mono"',
    weights: ['400', '500', '600'],
    readyPromise: null,

    waitForAnimationFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    },

    withTimeout(promise, timeoutMs = 2500) {
        return Promise.race([
            promise,
            new Promise((resolve) => setTimeout(resolve, timeoutMs))
        ]);
    },

    async ensureLoaded(fontSize = 14) {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            return;
        }

        if (!this.readyPromise) {
            this.readyPromise = (async () => {
                const probe = document.createElement('span');
                probe.textContent = 'Termix Font Probe 0123456789';
                probe.setAttribute('aria-hidden', 'true');
                probe.style.cssText = [
                    'position: fixed',
                    'left: -9999px',
                    'top: -9999px',
                    'visibility: hidden',
                    `font-family: ${this.family}, monospace`,
                    `font-size: ${fontSize}px`,
                    'font-weight: 500',
                    'white-space: nowrap',
                    'pointer-events: none'
                ].join(';');

                document.body.appendChild(probe);

                try {
                    await this.withTimeout(document.fonts.ready);
                    await Promise.all(this.weights.map((weight) => (
                        this.withTimeout(document.fonts.load(`${weight} ${fontSize}px ${this.family}`))
                    )));
                    await this.waitForAnimationFrame();
                    await this.waitForAnimationFrame();
                } finally {
                    probe.remove();
                }
            })().catch((err) => {
                console.warn('Failed to preload terminal font:', err);
            });
        }

        await this.readyPromise;
    }
};

window.TermixFontLoader = TermixFontLoader;

const ProfileManager = {
    profiles: [],
    activeProfileId: null,

    init() {
        this.profileBtn = document.getElementById('profile-btn');
        this.profileMenu = document.getElementById('profile-menu');
        this.profileList = document.getElementById('profile-list');
        this.chevron = document.getElementById('profile-chevron');
        this.profileName = document.querySelector('.profile-name');
        this.createUserBtn = document.getElementById('create-user-btn');

        if (this.profileBtn) {
            this.profileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }

        document.addEventListener('click', (e) => {
            if (this.profileMenu && this.profileMenu.classList.contains('open')) {
                if (!this.profileBtn.contains(e.target) && !this.profileMenu.contains(e.target)) {
                    this.closeMenu();
                }
            }
        });

        if (this.createUserBtn) {
            this.createUserBtn.addEventListener('click', () => {
                this.closeMenu();
                this.openCreateUserTab();
            });
        }

        this.refreshProfiles();
    },

    async refreshProfiles() {
        if (!window.electronAPI || !window.electronAPI.profiles || !window.electronAPI.profiles.getProfiles) {
            return;
        }

        try {
            const payload = await window.electronAPI.profiles.getProfiles();
            this.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
            this.activeProfileId = payload.activeProfileId || null;
            this.renderProfiles();
        } catch (err) {
            console.error('Failed to load profiles:', err);
        }
    },

    renderProfiles() {
        if (!this.profileList) return;
        this.profileList.innerHTML = '';

        if (!this.profiles.length) {
            this.profileList.innerHTML = '<div class="profile-menu-empty">No profiles found</div>';
            if (this.profileName) this.profileName.textContent = 'User';
            return;
        }

        const activeProfile = this.profiles.find(profile => profile.id === this.activeProfileId) || this.profiles[0];
        if (this.profileName) this.profileName.textContent = activeProfile.name || 'User';

        this.profiles.forEach(profile => {
            const isActive = profile.id === activeProfile.id;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `profile-menu-item profile-switch-item${isActive ? ' active' : ''}`;
            row.dataset.profileId = profile.id;

            const profileType = String(profile.type || 'local').toLowerCase();
            const storageMeta = profileType === 'firebase'
                ? { icon: 'fa-cloud', label: 'Firebase' }
                : profileType === 'qmm'
                    ? { icon: 'fa-shield-halved', label: 'QMM' }
                    : { icon: 'fa-database', label: 'Local' };
            const icon = storageMeta.icon;
            const storageLabel = storageMeta.label;
            const iconEl = document.createElement('i');
            iconEl.className = `fa-solid ${icon}`;

            const metaEl = document.createElement('div');
            metaEl.className = 'profile-switch-meta';

            const nameEl = document.createElement('span');
            nameEl.className = 'profile-switch-name';
            nameEl.textContent = profile.name || 'Unnamed';

            const typeEl = document.createElement('span');
            typeEl.className = 'profile-switch-type';
            typeEl.textContent = storageLabel;

            metaEl.appendChild(nameEl);
            metaEl.appendChild(typeEl);

            row.appendChild(iconEl);
            row.appendChild(metaEl);

            if (isActive) {
                const checkEl = document.createElement('i');
                checkEl.className = 'fa-solid fa-check profile-switch-check';
                row.appendChild(checkEl);
            }

            row.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (isActive) {
                    this.closeMenu();
                    return;
                }
                await this.switchProfile(profile.id);
            });

            this.profileList.appendChild(row);
        });
    },

    async switchProfile(profileId) {
        try {
            this.closeMenu();
            const result = await window.electronAPI.profiles.switchProfile(profileId);
            if (result && result.success) {
                if (result.cloudSync && result.cloudSync.success === false) {
                    const provider = result.cloudSync.providerName || 'Cloud';
                    window.notifyUser(`Profile switched, but ${provider} pull failed: ${result.cloudSync.message}`, 'warning');
                } else if (result.firebaseSync && result.firebaseSync.success === false) {
                    window.notifyUser('Profile switched, but Firebase pull failed: ' + result.firebaseSync.message, 'warning');
                }
                window.location.reload();
                return;
            }
            window.notifyUser(result && result.message ? result.message : 'Profile switch failed.', 'error');
        } catch (err) {
            window.notifyUser('Profile switch failed: ' + err.message, 'error');
        }
    },

    async openCreateUserTab() {
        // window.ModuleLoader might not be exposed, but we can check if container exists
        const container = document.getElementById('module-container');
        if (!container) return;
        
        // Deselect sidebar items
        const menuItems = document.querySelectorAll('.sidebar-menu li');
        menuItems.forEach(i => i.classList.remove('active'));

        try {
            const response = await fetch('public/modules/profiles/create-user.html');
            const html = await response.text();
            container.innerHTML = html;

            // Load Script manually
            const script = document.createElement('script');
            script.src = 'public/modules/profiles/create-user.js?v=' + Date.now(); // Cache busting
            
            // Remove old script if exists
            // Note: src matching is stricter with query params, so we might not find old ones easily
            // simplified cleanup
            const oldScripts = document.querySelectorAll('script[src*="create-user.js"]');
            oldScripts.forEach(s => s.remove());
            
            document.body.appendChild(script);
            
            // Switch to Dashboard tab if not active
            if (window.TabManager) {
                window.TabManager.activateTab('dashboard');
            }

            // Update ModuleLoader state if possible
            if (window.ModuleLoader) {
                window.ModuleLoader.currentModule = 'create-user';
            }

        } catch (err) {
            console.error('Failed to load Create User module', err);
            container.innerHTML = `<div style="padding: 20px; color: #f38ba8;">Error loading module</div>`;
        }
    },

    toggleMenu() {
        if (!this.profileMenu) return;
        this.profileMenu.classList.toggle('open');
        if (this.chevron) this.chevron.classList.toggle('open');
    },

    closeMenu() {
        if (!this.profileMenu) return;
        this.profileMenu.classList.remove('open');
        if (this.chevron) this.chevron.classList.remove('open');
    }
};
window.ProfileManager = ProfileManager;

const TabManager = {
    tabs: [],
    panes: new Map(),
    layout: null,
    focusedPaneId: null,
    paneRoot: null,
    contentArea: null,
    sidebar: null,
    sidebarToggle: null,
    dashboardRevealTimer: null,
    sidebarTransitionMs: 300,
    draggingTabId: null,
    paneSeq: 0,
    minPanePx: 200,

    get activeTabId() {
        const pane = this.panes.get(this.focusedPaneId);
        return pane ? pane.activeTabId : null;
    },

    set activeTabId(id) {
        if (id) this.activateTab(id);
    },

    init() {
        this.contentArea = document.getElementById('content-area');
        this.sidebar = document.querySelector('.sidebar');
        this.sidebarToggle = document.getElementById('sidebar-toggle');
        this.paneRoot = document.getElementById('pane-root');

        if (!this.paneRoot) {
            this.paneRoot = document.createElement('div');
            this.paneRoot.id = 'pane-root';
            this.paneRoot.className = 'pane-root';
            this.contentArea.appendChild(this.paneRoot);
        }

        const firstPane = this.createPane();
        this.layout = { type: 'leaf', paneId: firstPane.id };
        this.focusedPaneId = firstPane.id;
        this.renderLayout();

        if (this.sidebarToggle) {
            this.sidebarToggle.addEventListener('click', () => {
                if (!this.sidebar) return;
                this.sidebar.style.transition = '';
                this.sidebar.classList.toggle('collapsed');
            });
        }

        const sidebarResizer = document.getElementById('sidebar-resizer');
        if (sidebarResizer && this.sidebar) {
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                if (!isResizing) return;
                const dx = e.clientX - startX;
                const minW = this.sidebar.classList.contains('ai-mode') ? 300 : 180;
                const activePanesCount = this.panes ? Math.max(1, this.panes.size) : 1;
                const requiredContentWidth = Math.max(360, activePanesCount * this.minPanePx);
                const maxW = Math.max(minW, window.innerWidth - requiredContentWidth);
                const newWidth = Math.max(minW, Math.min(maxW, startWidth + dx));
                this.sidebar.style.width = `${newWidth}px`;
            };

            const onMouseUp = () => {
                if (!isResizing) return;
                isResizing = false;
                document.body.classList.remove('sidebar-resizing');
                this.sidebar.style.transition = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            sidebarResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isResizing = true;
                startX = e.clientX;
                startWidth = this.sidebar.getBoundingClientRect().width;
                this.sidebar.style.transition = 'none';
                document.body.classList.add('sidebar-resizing');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        // Create default Dashboard tab
        this.addTab({
            id: 'dashboard',
            title: 'Dashboard',
            icon: 'fa-solid fa-house',
            contentId: 'module-container',
            closable: false
        });

        document.addEventListener('dragend', () => this.endTabDrag());

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl + Shift + W to close active tab
            if (e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
                e.preventDefault();
                e.stopPropagation();
                const activeId = this.activeTabId;
                if (activeId) {
                    const tab = this.tabs.find(t => t.id === activeId);
                    if (tab && tab.closable) {
                        this.closeTab(activeId);
                    }
                }
                return;
            }

            // Prevent Ctrl+W from closing the app (Electron default) when in terminal
            if (e.ctrlKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
                e.preventDefault();
                return;
            }

            // Ctrl + \ splits side by side, Ctrl + Shift + \ splits top/bottom
            if (e.ctrlKey && (e.key === '\\' || e.code === 'Backslash')) {
                e.preventDefault();
                this.splitActiveTab(e.shiftKey ? 'bottom' : 'right');
                return;
            }

            // Ctrl + Alt + Arrow moves focus between panes
            if (e.ctrlKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                this.cyclePaneFocus(e.key === 'ArrowRight' ? 1 : -1);
                return;
            }

            // Ctrl + 1-9 to switch tabs
            if (e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < this.tabs.length) {
                    this.activateTab(this.tabs[index].id);
                }
            }
        });
    },

    /* ---------------------------------------------------------------- panes */

    createPane() {
        const id = 'pane-' + (++this.paneSeq);

        const el = document.createElement('div');
        el.className = 'pane';
        el.dataset.paneId = id;

        const tabbarEl = document.createElement('div');
        tabbarEl.className = 'tab-bar pane-tabbar';

        const bodyEl = document.createElement('div');
        bodyEl.className = 'pane-body';

        const dropLayer = document.createElement('div');
        dropLayer.className = 'pane-drop-layer';
        const dropIndicator = document.createElement('div');
        dropIndicator.className = 'pane-drop-indicator';
        dropLayer.appendChild(dropIndicator);
        bodyEl.appendChild(dropLayer);

        el.appendChild(tabbarEl);
        el.appendChild(bodyEl);

        const pane = {
            id,
            el,
            tabbarEl,
            bodyEl,
            dropLayer,
            dropIndicator,
            tabIds: [],
            activeTabId: null
        };

        this.panes.set(id, pane);

        el.addEventListener('mousedown', () => this.focusPane(id), true);
        el.addEventListener('focusin', () => this.focusPane(id));

        // Allow horizontal scrolling with mouse wheel
        tabbarEl.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                tabbarEl.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        });

        this.bindPaneDropTargets(pane);
        return pane;
    },

    getPaneOfTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return null;
        return this.panes.get(tab.paneId) || null;
    },

    focusPane(paneId) {
        if (!this.panes.has(paneId) || this.focusedPaneId === paneId) return;
        this.focusedPaneId = paneId;
        this.updatePaneFocusClasses();
        this.updateSidebarState();
    },

    updatePaneFocusClasses() {
        this.panes.forEach((pane) => {
            pane.el.classList.toggle('focused', pane.id === this.focusedPaneId);
        });
    },

    listPanesInOrder() {
        const result = [];
        const walk = (node) => {
            if (!node) return;
            if (node.type === 'leaf') {
                const pane = this.panes.get(node.paneId);
                if (pane) result.push(pane);
                return;
            }
            node.children.forEach(walk);
        };
        walk(this.layout);
        return result;
    },

    cyclePaneFocus(direction) {
        const ordered = this.listPanesInOrder();
        if (ordered.length < 2) return;
        const currentIndex = ordered.findIndex(p => p.id === this.focusedPaneId);
        const nextIndex = (currentIndex + direction + ordered.length) % ordered.length;
        const nextPane = ordered[nextIndex];
        this.focusPane(nextPane.id);
        if (nextPane.activeTabId) this.activateTab(nextPane.activeTabId);
    },

    /* --------------------------------------------------------- layout tree */

    findLeaf(node, paneId, parent = null, index = -1) {
        if (!node) return null;
        if (node.type === 'leaf') {
            return node.paneId === paneId ? { node, parent, index } : null;
        }
        for (let i = 0; i < node.children.length; i++) {
            const found = this.findLeaf(node.children[i], paneId, node, i);
            if (found) return found;
        }
        return null;
    },

    firstLeafPane(node = this.layout) {
        if (!node) return null;
        if (node.type === 'leaf') return this.panes.get(node.paneId) || null;
        for (const child of node.children) {
            const pane = this.firstLeafPane(child);
            if (pane) return pane;
        }
        return null;
    },

    // Distributes the available space evenly across every child of a split.
    balanceSizes(node) {
        const share = 100 / node.children.length;
        node.sizes = node.children.map(() => share);
    },

    insertPaneRelative(targetPaneId, newPaneId, dir, before) {
        const found = this.findLeaf(this.layout, targetPaneId);
        const newLeaf = { type: 'leaf', paneId: newPaneId };

        if (!found) {
            this.layout = { type: 'split', dir, children: [this.layout, newLeaf], sizes: [50, 50] };
            return;
        }

        const { node, parent, index } = found;

        // Same direction as the parent split: join it instead of nesting, so a
        // third (or fourth) pane lines up with the existing ones.
        if (parent && parent.dir === dir) {
            parent.children.splice(before ? index : index + 1, 0, newLeaf);
            this.balanceSizes(parent);
            return;
        }

        const children = before ? [newLeaf, node] : [node, newLeaf];
        const splitNode = { type: 'split', dir, children, sizes: [50, 50] };

        if (!parent) {
            this.layout = splitNode;
        } else {
            parent.children[index] = splitNode;
        }
    },

    removeLeafFromLayout(paneId) {
        const found = this.findLeaf(this.layout, paneId);
        if (!found || !found.parent) return;

        const { parent, index } = found;
        parent.children.splice(index, 1);
        parent.sizes.splice(index, 1);

        if (parent.children.length === 1) {
            const survivor = parent.children[0];
            const grand = this.findParentOf(this.layout, parent);
            if (!grand) {
                this.layout = survivor;
            } else {
                const parentIndex = grand.node.children.indexOf(parent);
                if (parentIndex !== -1) {
                    // A split with a single child collapses into that child. If the
                    // child is a split of the same direction it is flattened too.
                    if (survivor.type === 'split' && survivor.dir === grand.node.dir) {
                        const sizeShare = grand.node.sizes[parentIndex];
                        const total = survivor.sizes.reduce((sum, value) => sum + value, 0) || 1;
                        const scaled = survivor.sizes.map(value => (value / total) * sizeShare);
                        grand.node.children.splice(parentIndex, 1, ...survivor.children);
                        grand.node.sizes.splice(parentIndex, 1, ...scaled);
                    } else {
                        grand.node.children[parentIndex] = survivor;
                    }
                }
            }
        } else {
            const total = parent.sizes.reduce((sum, value) => sum + value, 0) || 1;
            parent.sizes = parent.sizes.map(value => (value / total) * 100);
        }
    },

    findParentOf(node, target) {
        if (!node || node.type === 'leaf') return null;
        if (node.children.includes(target)) return { node };
        for (const child of node.children) {
            const found = this.findParentOf(child, target);
            if (found) return found;
        }
        return null;
    },

    renderLayout() {
        const rootEl = this.buildNodeElement(this.layout);
        rootEl.style.flex = '1 1 0px';
        this.paneRoot.replaceChildren(rootEl);
        this.placeSidebarToggle();
        this.updatePaneFocusClasses();
        this.updateSidebarState();
        requestAnimationFrame(() => this.refreshVisibleSessions());
    },

    // Panes are re-parented when the layout changes, so every visible terminal
    // gets a chance to refit and repaint itself afterwards.
    refreshVisibleSessions() {
        this.tabs.forEach((tab) => {
            const session = tab.sessionObj;
            if (!session || !this.isTabVisible(tab.id)) return;
            try {
                if (session.fitAddon) session.fitAddon.fit();
                if (session.term) session.term.refresh(0, session.term.rows - 1);
            } catch (_) {}
        });
    },

    buildNodeElement(node) {
        if (node.type === 'leaf') {
            const pane = this.panes.get(node.paneId);
            return pane.el;
        }

        const el = document.createElement('div');
        el.className = 'pane-split ' + (node.dir === 'row' ? 'dir-row' : 'dir-col');

        node.children.forEach((child, i) => {
            if (i > 0) {
                el.appendChild(this.createSplitter(node, i - 1, el));
            }
            const childEl = this.buildNodeElement(child);
            childEl.style.flex = `${node.sizes[i]} 1 0px`;
            el.appendChild(childEl);
        });

        return el;
    },

    createSplitter(node, index, containerEl) {
        const splitter = document.createElement('div');
        splitter.className = 'pane-splitter';
        splitter.addEventListener('mousedown', (e) => this.startSplitterDrag(e, node, index, containerEl));
        splitter.addEventListener('dblclick', () => {
            this.balanceSizes(node);
            this.applySizes(node, containerEl);
        });
        return splitter;
    },

    childElements(containerEl) {
        return Array.from(containerEl.children).filter(el => !el.classList.contains('pane-splitter'));
    },

    applySizes(node, containerEl) {
        const kids = this.childElements(containerEl);
        kids.forEach((kid, i) => {
            kid.style.flex = `${node.sizes[i]} 1 0px`;
        });
    },

    startSplitterDrag(event, node, index, containerEl) {
        event.preventDefault();

        const kids = this.childElements(containerEl);
        const first = kids[index];
        const second = kids[index + 1];
        if (!first || !second) return;

        const horizontal = node.dir === 'row';
        const startPos = horizontal ? event.clientX : event.clientY;
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        const firstSize = horizontal ? firstRect.width : firstRect.height;
        const secondSize = horizontal ? secondRect.width : secondRect.height;
        const totalSize = firstSize + secondSize;
        const totalWeight = node.sizes[index] + node.sizes[index + 1];

        if (totalSize <= this.minPanePx * 2) return;

        document.body.classList.add('pane-resizing', horizontal ? 'pane-resizing-x' : 'pane-resizing-y');

        const onMove = (e) => {
            const delta = (horizontal ? e.clientX : e.clientY) - startPos;
            const nextFirst = Math.max(this.minPanePx, Math.min(firstSize + delta, totalSize - this.minPanePx));
            const ratio = nextFirst / totalSize;

            node.sizes[index] = totalWeight * ratio;
            node.sizes[index + 1] = totalWeight * (1 - ratio);
            first.style.flex = `${node.sizes[index]} 1 0px`;
            second.style.flex = `${node.sizes[index + 1]} 1 0px`;
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.body.classList.remove('pane-resizing', 'pane-resizing-x', 'pane-resizing-y');
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp, { once: true });
    },

    placeSidebarToggle() {
        if (!this.sidebarToggle) return;
        const pane = this.firstLeafPane();
        if (!pane) return;
        pane.tabbarEl.insertBefore(this.sidebarToggle, pane.tabbarEl.firstChild);
    },

    /* ------------------------------------------------------- drag and drop */

    beginTabDrag(tabId) {
        this.draggingTabId = tabId;
        document.body.classList.add('tab-dragging');
    },

    endTabDrag() {
        this.draggingTabId = null;
        document.body.classList.remove('tab-dragging');
        this.panes.forEach(pane => this.hideDropIndicator(pane));
        this.tabs.forEach(tab => {
            if (tab.el) tab.el.classList.remove('dragging');
        });
    },

    getDropZone(pane, event) {
        const rect = pane.bodyEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return 'center';

        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const distances = [
            { zone: 'left', value: x },
            { zone: 'right', value: 1 - x },
            { zone: 'top', value: y },
            { zone: 'bottom', value: 1 - y }
        ];

        const closest = distances.reduce((min, item) => (item.value < min.value ? item : min));
        return closest.value > 0.28 ? 'center' : closest.zone;
    },

    showDropIndicator(pane, zone) {
        pane.dropLayer.classList.add('visible');
        pane.dropIndicator.className = 'pane-drop-indicator visible zone-' + zone;
    },

    hideDropIndicator(pane) {
        pane.dropLayer.classList.remove('visible');
        pane.dropIndicator.className = 'pane-drop-indicator';
    },

    bindPaneDropTargets(pane) {
        pane.dropLayer.addEventListener('dragover', (e) => {
            if (!this.draggingTabId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.showDropIndicator(pane, this.getDropZone(pane, e));
        });

        pane.dropLayer.addEventListener('dragleave', (e) => {
            if (e.target === pane.dropLayer) this.hideDropIndicator(pane);
        });

        pane.dropLayer.addEventListener('drop', (e) => {
            if (!this.draggingTabId) return;
            e.preventDefault();
            const zone = this.getDropZone(pane, e);
            const tabId = this.draggingTabId;
            this.hideDropIndicator(pane);
            this.endTabDrag();

            if (zone === 'center') {
                this.moveTabToPane(tabId, pane.id);
            } else {
                this.splitPaneWithTab(tabId, pane.id, zone);
            }
        });

        pane.tabbarEl.addEventListener('dragover', (e) => {
            if (!this.draggingTabId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        pane.tabbarEl.addEventListener('drop', (e) => {
            if (!this.draggingTabId) return;
            e.preventDefault();
            const tabId = this.draggingTabId;
            const index = this.getTabDropIndex(pane, e.clientX);
            this.endTabDrag();
            this.moveTabToPane(tabId, pane.id, index);
        });
    },

    getTabDropIndex(pane, clientX) {
        const tabElements = Array.from(pane.tabbarEl.querySelectorAll('.tab'));
        for (let i = 0; i < tabElements.length; i++) {
            const rect = tabElements[i].getBoundingClientRect();
            if (clientX < rect.left + rect.width / 2) return i;
        }
        return tabElements.length;
    },

    splitActiveTab(zone) {
        const activeId = this.activeTabId;
        if (!activeId) return;
        this.splitPaneWithTab(activeId, this.focusedPaneId, zone);
    },

    splitPaneWithTab(tabId, targetPaneId, zone) {
        const tab = this.tabs.find(t => t.id === tabId);
        const targetPane = this.panes.get(targetPaneId);
        if (!tab || !targetPane) return;

        const sourcePane = this.panes.get(tab.paneId);

        // Splitting a pane off from itself only makes sense when something is
        // left behind in the original pane.
        if (sourcePane && sourcePane.id === targetPaneId && sourcePane.tabIds.length <= 1) return;

        const dir = (zone === 'left' || zone === 'right') ? 'row' : 'col';
        const before = (zone === 'left' || zone === 'top');

        const newPane = this.createPane();
        this.insertPaneRelative(targetPaneId, newPane.id, dir, before);
        this.attachTabToPane(tabId, newPane.id);
        this.renderLayout();
        this.activateTab(tabId);
    },

    moveTabToPane(tabId, targetPaneId, index) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || !this.panes.has(targetPaneId)) return;
        if (tab.paneId === targetPaneId) {
            if (typeof index === 'number') this.reorderTabWithinPane(tabId, index);
            this.activateTab(tabId);
            return;
        }

        this.attachTabToPane(tabId, targetPaneId, index);
        this.renderLayout();
        this.activateTab(tabId);
    },

    reorderTabWithinPane(tabId, index) {
        const pane = this.getPaneOfTab(tabId);
        if (!pane) return;

        const from = pane.tabIds.indexOf(tabId);
        if (from === -1) return;

        let to = typeof index === 'number' ? index : pane.tabIds.length;
        pane.tabIds.splice(from, 1);
        if (to > from) to -= 1;
        to = Math.max(0, Math.min(to, pane.tabIds.length));
        pane.tabIds.splice(to, 0, tabId);

        this.renderPaneTabs(pane);
        this.syncTabsOrder();
    },

    // Moves a tab (and its content element) into another pane, cleaning up the
    // pane it came from when that leaves it empty.
    attachTabToPane(tabId, targetPaneId, index) {
        const tab = this.tabs.find(t => t.id === tabId);
        const targetPane = this.panes.get(targetPaneId);
        if (!tab || !targetPane) return;

        const previousPane = this.panes.get(tab.paneId);
        if (previousPane) {
            previousPane.tabIds = previousPane.tabIds.filter(id => id !== tabId);
            if (previousPane.activeTabId === tabId) {
                previousPane.activeTabId = previousPane.tabIds[previousPane.tabIds.length - 1] || null;
            }
        }

        tab.paneId = targetPaneId;
        const at = typeof index === 'number'
            ? Math.max(0, Math.min(index, targetPane.tabIds.length))
            : targetPane.tabIds.length;
        targetPane.tabIds.splice(at, 0, tabId);
        targetPane.activeTabId = tabId;

        const contentEl = document.getElementById(tab.contentId);
        if (contentEl) targetPane.bodyEl.appendChild(contentEl);

        this.renderPaneTabs(targetPane);

        if (previousPane && previousPane !== targetPane) {
            if (previousPane.tabIds.length === 0) {
                this.destroyPane(previousPane.id);
            } else {
                this.renderPaneTabs(previousPane);
                this.applyPaneActiveState(previousPane);
            }
        }

        this.syncTabsOrder();
    },

    destroyPane(paneId) {
        const pane = this.panes.get(paneId);
        if (!pane || this.panes.size <= 1) return;

        this.removeLeafFromLayout(paneId);
        this.panes.delete(paneId);
        pane.el.remove();

        if (this.focusedPaneId === paneId) {
            const fallback = this.firstLeafPane();
            this.focusedPaneId = fallback ? fallback.id : null;
        }
    },

    /* ----------------------------------------------------------------- tabs */

    syncTabsOrder() {
        const ordered = [];
        this.listPanesInOrder().forEach((pane) => {
            pane.tabIds.forEach((id) => {
                const tab = this.tabs.find(t => t.id === id);
                if (tab) ordered.push(tab);
            });
        });
        if (ordered.length === this.tabs.length) this.tabs = ordered;
    },

    renderPaneTabs(pane) {
        const elements = pane.tabIds
            .map(id => this.tabs.find(t => t.id === id))
            .filter(tab => tab && tab.el)
            .map(tab => tab.el);

        pane.tabbarEl.replaceChildren(...elements);
        if (pane === this.firstLeafPane()) this.placeSidebarToggle();
    },

    createTabElement(tab) {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.id = tab.id;
        tabEl.draggable = true;
        tabEl.title = tab.title;

        const iconEl = document.createElement('i');
        iconEl.classList.add('tab-icon');
        tab.icon.split(/\s+/).forEach((className) => {
            if (/^[a-z0-9_-]+$/i.test(className)) {
                iconEl.classList.add(className);
            }
        });
        if (iconEl.classList.length === 1) {
            iconEl.classList.add('fa-solid', 'fa-terminal');
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;

        tabEl.appendChild(iconEl);
        tabEl.appendChild(titleEl);

        if (tab.closable) {
            const closeEl = document.createElement('i');
            closeEl.className = 'tab-close fa-solid fa-xmark';
            tabEl.appendChild(closeEl);
        }

        tabEl.addEventListener('dragstart', (e) => {
            tabEl.classList.add('dragging');
            this.beginTabDrag(tab.id);
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', tab.id); } catch (_) {}
            }
        });

        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('dragging');
            this.endTabDrag();
        });

        // Reordering inside the pane the tab is being dragged over.
        tabEl.addEventListener('dragover', (e) => {
            const draggingId = this.draggingTabId;
            if (!draggingId || draggingId === tab.id) return;
            e.preventDefault();

            const draggingTab = this.tabs.find(t => t.id === draggingId);
            if (!draggingTab || draggingTab.paneId !== tab.paneId) return;

            const pane = this.panes.get(tab.paneId);
            if (!pane) return;

            const bounding = tabEl.getBoundingClientRect();
            const after = e.clientX > bounding.x + bounding.width / 2;
            const targetIndex = pane.tabIds.indexOf(tab.id) + (after ? 1 : 0);
            this.reorderTabWithinPane(draggingId, targetIndex);
        });

        tabEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                e.stopPropagation();
                this.closeTab(tab.id);
            } else {
                this.activateTab(tab.id);
            }
        });

        tabEl.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        tabEl.addEventListener('auxclick', (e) => {
            if (e.button === 1 && tab.closable) {
                e.preventDefault();
                e.stopPropagation();
                this.closeTab(tab.id);
            }
        });

        return tabEl;
    },

    addTab(options) {
        // options: { id, title, icon, contentId, contentHtml, closable, paneId }
        const id = options.id || 'tab-' + Date.now();

        const existingTab = this.tabs.find(t => t.id === id);
        if (existingTab) {
            this.activateTab(id);
            return;
        }

        const targetPane = this.panes.get(options.paneId || this.focusedPaneId) || this.firstLeafPane();
        if (!targetPane) return;

        const tab = {
            id: id,
            title: String(options.title || 'New Tab'),
            icon: String(options.icon || 'fa-solid fa-terminal'),
            contentId: options.contentId,
            closable: options.closable !== false,
            paneId: targetPane.id
        };

        tab.el = this.createTabElement(tab);
        this.tabs.push(tab);
        targetPane.tabIds.push(id);

        // Create Content Element if not provided via ID
        if (!options.contentId) {
            const contentEl = document.createElement('div');
            contentEl.id = 'content-' + id;
            contentEl.className = 'tab-content';
            contentEl.innerHTML = options.contentHtml || '';
            targetPane.bodyEl.appendChild(contentEl);
            tab.contentId = contentEl.id;
        } else {
            const contentEl = document.getElementById(options.contentId);
            if (contentEl) targetPane.bodyEl.appendChild(contentEl);
        }

        this.renderPaneTabs(targetPane);
        this.syncTabsOrder();
        this.activateTab(id);
    },

    updateSidebarState() {
        if (!this.sidebar) return;

        // If split screen is active (more than 1 pane), do not auto-toggle sidebar
        if (this.panes && this.panes.size > 1) {
            if (this.sidebarToggle) this.sidebarToggle.style.display = 'flex';
            return;
        }

        const activeId = this.activeTabId;
        if (!activeId) return;

        const dashboardContent = document.getElementById('module-container');

        if (this.dashboardRevealTimer) {
            clearTimeout(this.dashboardRevealTimer);
            this.dashboardRevealTimer = null;
        }
        if (dashboardContent) {
            dashboardContent.classList.remove('dashboard-transition-hidden');
        }

        // The sidebar stays open only while the focused pane shows the dashboard.
        const shouldCollapse = activeId !== 'dashboard';
        const isCurrentlyCollapsed = this.sidebar.classList.contains('collapsed');

        // Delay dashboard reveal until sidebar transition finishes
        if (!shouldCollapse && isCurrentlyCollapsed && dashboardContent) {
            dashboardContent.classList.add('dashboard-transition-hidden');
            this.dashboardRevealTimer = setTimeout(() => {
                dashboardContent.classList.remove('dashboard-transition-hidden');
                this.dashboardRevealTimer = null;
            }, this.sidebarTransitionMs);
        }

        if (shouldCollapse !== isCurrentlyCollapsed) {
            if (shouldCollapse) {
                // Instant collapse when switching to terminal for zero-delay fullscreen feel
                this.sidebar.style.transition = 'none';
                this.sidebar.classList.add('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'flex';
                void this.sidebar.offsetWidth; // Force reflow
                requestAnimationFrame(() => {
                    this.sidebar.style.transition = '';
                });
            } else {
                this.sidebar.style.transition = '';
                this.sidebar.classList.remove('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'none';
            }
        } else if (this.sidebarToggle) {
            this.sidebarToggle.style.display = shouldCollapse ? 'flex' : 'none';
        }
    },

    applyPaneActiveState(pane) {
        pane.tabIds.forEach((id) => {
            const tab = this.tabs.find(t => t.id === id);
            if (!tab) return;

            const isActive = id === pane.activeTabId;
            if (tab.el) tab.el.classList.toggle('active', isActive);

            const contentEl = document.getElementById(tab.contentId);
            if (contentEl) contentEl.classList.toggle('active', isActive);
        });
    },

    activateTab(id) {
        const tabData = this.tabs.find(t => t.id === id);
        if (!tabData) return;

        const pane = this.panes.get(tabData.paneId);
        if (!pane) return;

        pane.activeTabId = id;
        this.focusedPaneId = pane.id;

        this.applyPaneActiveState(pane);
        this.updatePaneFocusClasses();
        this.updateSidebarState();

        if (tabData.sessionObj && typeof tabData.sessionObj.focus === 'function') {
            requestAnimationFrame(() => {
                const activeTab = this.tabs.find(t => t.id === id);
                if (!activeTab || activeTab.sessionObj !== tabData.sessionObj) return;
                try {
                    activeTab.sessionObj.focus();
                } catch (err) {
                    console.warn('Error focusing terminal tab:', err);
                }
            });
        }
    },

    // True only for the tab that owns the keyboard right now: the active tab of
    // the focused pane. Other split panes stay visible but do not take input.
    isTabFocused(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return false;
        const pane = this.panes.get(tab.paneId);
        if (!pane) return false;
        return pane.id === this.focusedPaneId && pane.activeTabId === tabId;
    },

    isTabVisible(tabId) {
        const pane = this.getPaneOfTab(tabId);
        return !!pane && pane.activeTabId === tabId;
    },

    closeTab(id) {
        // Dashboard should never be closed via this method normally, but as a safeguard
        if (id === 'dashboard') return;

        const tabIndex = this.tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;

        const tab = this.tabs[tabIndex];
        const pane = this.panes.get(tab.paneId);

        // --- Cleanup hook: if the tab has an object, run cleanup ---
        if (tab.sessionObj && typeof tab.sessionObj.dispose === 'function') {
             try {
                 tab.sessionObj.dispose();
             } catch (err) {
                 console.error('Error disposing tab session:', err);
             }
        }
        // -----------------------------------------------------------

        if (tab.el) tab.el.remove();

        const contentEl = document.getElementById(tab.contentId);
        if (contentEl && tab.contentId !== 'module-container') {
            contentEl.remove();
        }

        this.tabs.splice(tabIndex, 1);

        if (!pane) return;

        const paneTabIndex = pane.tabIds.indexOf(id);
        if (paneTabIndex === -1) return;
        pane.tabIds.splice(paneTabIndex, 1);

        if (pane.tabIds.length === 0) {
            this.destroyPane(pane.id);
            this.renderLayout();
            const fallbackPane = this.panes.get(this.focusedPaneId) || this.firstLeafPane();
            if (fallbackPane && fallbackPane.activeTabId) {
                this.activateTab(fallbackPane.activeTabId);
            }
            return;
        }

        this.renderPaneTabs(pane);

        if (pane.activeTabId === id) {
            const nextIndex = Math.min(paneTabIndex, pane.tabIds.length - 1);
            pane.activeTabId = pane.tabIds[nextIndex];
            this.activateTab(pane.activeTabId);
        } else {
            this.applyPaneActiveState(pane);
        }
    }
};

window.TabManager = TabManager;

// Opens terminal tabs on request from outside the UI (currently the MCP
// server, when an assistant asks for a visible terminal on a host).
const TerminalLauncher = {
    async ensureConnectionModule() {
        if (window.ConnectionModule) return;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'public/modules/connection/connection.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    async openForHost(hostInfo) {
        if (!hostInfo || !window.TabManager) return null;
        await this.ensureConnectionModule();

        const tabId = 'mcp-' + Date.now();
        const title = hostInfo.name || hostInfo.address || 'Terminal';

        window.TabManager.addTab({
            id: tabId,
            title,
            icon: 'fa-solid fa-terminal',
            contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
        });

        const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, hostInfo);
        const tab = window.TabManager.tabs.find(t => t.id === tabId);
        if (tab) tab.sessionObj = sessionObj;
        return sessionObj;
    },

    // The MCP side only knows the public host record, so the full one (with
    // credentials) is looked up here before connecting.
    async openFromMcp(payload) {
        try {
            if (!payload) return;
            let hostInfo = payload;

            if (payload.id != null && window.electronAPI && window.electronAPI.hosts) {
                const hosts = await window.electronAPI.hosts.getData();
                const match = (Array.isArray(hosts) ? hosts : []).find(h => String(h.id) === String(payload.id));
                if (match) hostInfo = match;
            }

            await this.openForHost(hostInfo);

            if (window.AppNotify && typeof window.AppNotify.show === 'function') {
                window.AppNotify.show(`AI opened a terminal on ${hostInfo.name || hostInfo.address}.`, 'info');
            }
        } catch (err) {
            console.error('Failed to open terminal requested over MCP:', err);
        }
    },

    init() {
        if (!window.electronAPI || typeof window.electronAPI.on !== 'function') return;
        window.electronAPI.on('mcp:open-terminal', (_event, payload) => this.openFromMcp(payload));
    }
};

window.TerminalLauncher = TerminalLauncher;

const ModuleLoader = {
    currentModule: null,
    container: null,
    allowedModules: new Set([
        'hosts',
        'keychain',
        'port-forwarding',
        'snippets',
        'known-hosts',
        'sftp',
        'settings'
    ]),
    specialModules: new Set(['ai']),
    
    init() {
        this.container = document.getElementById('module-container');
        this.setupSidebarNavigation();
        this.loadModule('hosts');
    },

    normalizeModuleName(moduleName) {
        return String(moduleName || '').trim().toLowerCase();
    },

    isAllowedModule(moduleName) {
        return this.allowedModules.has(moduleName);
    },

    isSpecialModule(moduleName) {
        return this.specialModules.has(moduleName);
    },

    showModuleError(message) {
        if (!this.container) return;

        this.container.textContent = '';

        const errorNode = document.createElement('div');
        errorNode.style.padding = '20px';
        errorNode.style.color = '#f38ba8';
        errorNode.textContent = String(message || 'Module not found.');

        this.container.appendChild(errorNode);
    },
    
    setupSidebarNavigation() {
        const menuItems = document.querySelectorAll('.sidebar-menu li');
        
        // Initialize AI Manager if available
        if (window.AiManager) {
            window.AiManager.init();
        }

        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                const moduleName = this.normalizeModuleName(item.getAttribute('data-module'));
                
                // If it is AI, do nothing here (handled by AiManager)
                if (this.isSpecialModule(moduleName)) return;

                if (!this.isAllowedModule(moduleName)) {
                    console.error('Blocked invalid module request from sidebar.', { moduleName });
                    this.showModuleError('Module not found.');
                    return;
                }
                
                menuItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                this.loadModule(moduleName);
                
                // Switch to Dashboard tab when a menu item is clicked
                if (window.TabManager) {
                    window.TabManager.activateTab('dashboard');
                }
            });
        });
    },
    
    async loadModule(moduleName) {
        const safeModuleName = this.normalizeModuleName(moduleName);
        if (!this.isAllowedModule(safeModuleName)) {
            console.error('Blocked invalid module load request.', { moduleName });
            this.showModuleError('Module not found.');
            return;
        }

        if (this.currentModule === safeModuleName) return;
        
        try {
            const response = await fetch(`public/modules/${safeModuleName}/${safeModuleName}.html`);
            if (!response.ok) {
                throw new Error(`Module HTML request failed with status ${response.status}`);
            }

            const html = await response.text();
            this.container.innerHTML = html;
            
            if (this.moduleScript) {
                this.moduleScript.remove();
            }
            
            this.moduleScript = document.createElement('script');
            this.moduleScript.src = `public/modules/${safeModuleName}/${safeModuleName}.js`;
            document.body.appendChild(this.moduleScript);
            
            this.currentModule = safeModuleName;
        } catch (error) {
            console.error(`Error loading module ${safeModuleName}:`, error);
            this.showModuleError('Module not found.');
        }
    }
};
window.ModuleLoader = ModuleLoader;

document.addEventListener('DOMContentLoaded', () => {
    if (window.ThemeManager) window.ThemeManager.init();
    Drawer.init();
    AppNotify.init();
    AppConfirm.init();
    if (window.TermixFontLoader) {
        window.TermixFontLoader.ensureLoaded().catch(() => {});
    }
    TabManager.init();
    ModuleLoader.init();
    if (window.AiManager) window.AiManager.init();
    if (window.ProfileManager) window.ProfileManager.init();
    TerminalLauncher.init();

    window.addEventListener('beforeunload', () => {
        if (window.TabManager && Array.isArray(window.TabManager.tabs)) {
            window.TabManager.tabs.forEach(tab => {
                if (tab && tab.sessionObj && typeof tab.sessionObj.dispose === 'function') {
                    try {
                        tab.sessionObj.dispose();
                    } catch (_) {}
                }
            });
        }
    });
});
