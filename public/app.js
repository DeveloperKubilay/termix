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
    defaultTheme: 'classic',
    storageKey: 'termix-ui-theme',
    currentTheme: 'classic',
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
    activeTabId: null,
    tabBar: null,
    contentArea: null,
    sidebar: null,
    sidebarToggle: null,
    dashboardRevealTimer: null,
    sidebarTransitionMs: 300,

    init() {
        this.tabBar = document.getElementById('tab-bar');
        this.contentArea = document.getElementById('content-area');
        this.sidebar = document.querySelector('.sidebar');
        this.sidebarToggle = document.getElementById('sidebar-toggle');

        // Allow horizontal scrolling with mouse wheel
        if (this.tabBar) {
            this.tabBar.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    this.tabBar.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            });
        }

        if (this.sidebarToggle) {
            this.sidebarToggle.addEventListener('click', () => {
                if (!this.sidebar) return;
                this.sidebar.style.transition = '';
                this.sidebar.classList.toggle('collapsed');
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

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl + Shift + W to close active tab
            if (e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
                e.preventDefault();
                e.stopPropagation();
                if (this.activeTabId) {
                    const tab = this.tabs.find(t => t.id === this.activeTabId);
                    if (tab && tab.closable) {
                        this.closeTab(this.activeTabId);
                    }
                }
                return;
            }

            // Prevent Ctrl+W from closing the app (Electron default) when in terminal
            if (e.ctrlKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
                e.preventDefault();
                return;
            }

            // Ctrl + 1-9 to switch tabs
            if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < this.tabs.length) {
                    this.activateTab(this.tabs[index].id);
                }
            }
        });
    },

    syncTabsOrder() {
        const newOrder = [];
        const tabElements = this.tabBar.querySelectorAll('.tab');
        tabElements.forEach(el => {
            const id = el.dataset.id;
            const tab = this.tabs.find(t => t.id === id);
            if (tab) newOrder.push(tab);
        });
        this.tabs = newOrder;
    },

    addTab(options) {
        // options: { id, title, icon, contentId, contentHtml, closable }
        const id = options.id || 'tab-' + Date.now();
        
        // Check if tab already exists
        const existingTab = this.tabs.find(t => t.id === id);
        if (existingTab) {
            this.activateTab(id);
            return;
        }

        const tab = {
            id: id,
            title: String(options.title || 'New Tab'),
            icon: String(options.icon || 'fa-solid fa-terminal'),
            contentId: options.contentId,
            closable: options.closable !== false
        };

            // Create tab element (how did we attach sessionObj on previous tabs?)
        
        // We need to attach the session object to the tab where modules are initialized.
        // So we need to inspect what moduleContainer.init returns.
        // But init might be asynchronous.
        
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.id = id;
        tabEl.draggable = true;

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

        // Drag and Drop Events
        tabEl.addEventListener('dragstart', (e) => {
            tabEl.classList.add('dragging');
        });

        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('dragging');
            this.syncTabsOrder();
        });

        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingTab = this.tabBar.querySelector('.tab.dragging');
            if (draggingTab && draggingTab !== tabEl) {
                const bounding = tabEl.getBoundingClientRect();
                const offset = bounding.x + bounding.width / 2;
                if (e.clientX - offset > 0) {
                    tabEl.after(draggingTab);
                } else {
                    tabEl.before(draggingTab);
                }
            }
        });

        tabEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                e.stopPropagation();
                this.closeTab(id);
            } else {
                this.activateTab(id);
            }
        });

        this.tabBar.appendChild(tabEl);
        this.tabs.push(tab);

        // Create Content Element if not provided via ID
        if (!options.contentId) {
            const contentEl = document.createElement('div');
            contentEl.id = 'content-' + id;
            contentEl.className = 'tab-content';
            contentEl.innerHTML = options.contentHtml || '';
            this.contentArea.appendChild(contentEl);
            tab.contentId = contentEl.id;
        }

        this.activateTab(id);
    },

    applySidebarStateForTab(id) {
        if (!this.sidebar) return;

        const shouldCollapse = id !== 'dashboard';
        const isCurrentlyCollapsed = this.sidebar.classList.contains('collapsed');

        if (shouldCollapse !== isCurrentlyCollapsed) {
            if (shouldCollapse) {
                // Disable transition when collapsing to prevent xterm resize flicker
                this.sidebar.style.transition = 'none';
                this.sidebar.classList.add('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'flex';

                // Force reflow
                void this.sidebar.offsetWidth;

                // Re-enable transition for manual toggles
                requestAnimationFrame(() => {
                    this.sidebar.style.transition = '';
                });
            } else {
                // Allow CSS transition when expanding back to Dashboard
                this.sidebar.style.transition = '';
                this.sidebar.classList.remove('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'none';
            }
        } else {
            if (shouldCollapse) {
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'flex';
            } else {
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'none';
            }
        }
    },

    activateTab(id) {
        if (this.activeTabId === id) return;

        const dashboardContent = document.getElementById('module-container');
        if (this.dashboardRevealTimer) {
            clearTimeout(this.dashboardRevealTimer);
            this.dashboardRevealTimer = null;
        }
        if (dashboardContent) {
            dashboardContent.classList.remove('dashboard-transition-hidden');
        }

        // Delay dashboard reveal until sidebar transition finishes
        const shouldDelayDashboardPaint = id === 'dashboard'
            && this.sidebar
            && this.sidebar.classList.contains('collapsed');
            
        if (shouldDelayDashboardPaint && dashboardContent) {
            dashboardContent.classList.add('dashboard-transition-hidden');
            this.dashboardRevealTimer = setTimeout(() => {
                dashboardContent.classList.remove('dashboard-transition-hidden');
                this.dashboardRevealTimer = null;
            }, this.sidebarTransitionMs);
        }

        // Apply sidebar state first.
        this.applySidebarStateForTab(id);

        // Deactivate current
        const currentTab = this.tabBar.querySelector('.tab.active');
        if (currentTab) currentTab.classList.remove('active');
        
        const currentContent = this.contentArea.querySelector('.tab-content.active');
        if (currentContent) currentContent.classList.remove('active');

        // Activate new
        const newTab = this.tabBar.querySelector(`.tab[data-id="${id}"]`);
        if (newTab) newTab.classList.add('active');

        const tabData = this.tabs.find(t => t.id === id);
        if (tabData) {
            const newContent = document.getElementById(tabData.contentId);
            if (newContent) newContent.classList.add('active');
        }

        this.activeTabId = id;
    },

    closeTab(id) {
        // Dashboard should never be closed via this method normally, but as a safeguard
        if (id === 'dashboard') return;

        const tabIndex = this.tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;

        const tab = this.tabs[tabIndex];
        
        // --- Cleanup hook: if the tab has an object, run cleanup ---
        if (tab.sessionObj && typeof tab.sessionObj.dispose === 'function') {
             try {
                 tab.sessionObj.dispose();
             } catch (err) {
                 console.error('Error disposing tab session:', err);
             }
        }
        // -----------------------------------------------------------

        // Remove elements
        const tabEl = this.tabBar.querySelector(`.tab[data-id="${id}"]`);
        if (tabEl) tabEl.remove();

        const contentEl = document.getElementById(tab.contentId);
        if (contentEl && tab.contentId !== 'module-container') {
            contentEl.remove();
        }

        this.tabs.splice(tabIndex, 1);

        // Activate another tab if this was active
        if (this.activeTabId === id) {
            const newIndex = Math.max(0, tabIndex - 1);
            if (this.tabs.length > 0) {
                this.activateTab(this.tabs[newIndex].id);
            }
        }
    }
};

window.TabManager = TabManager;

const ModuleLoader = {
    currentModule: null,
    container: null,
    
    init() {
        this.container = document.getElementById('module-container');
        this.setupSidebarNavigation();
        this.loadModule('hosts');
    },
    
    setupSidebarNavigation() {
        const menuItems = document.querySelectorAll('.sidebar-menu li');
        
        // Initialize AI Manager if available
        if (window.AiManager) {
            window.AiManager.init();
        }

        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                const moduleName = item.getAttribute('data-module');
                
                // If it is AI, do nothing here (handled by AiManager)
                if (moduleName === 'ai') return;
                
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
        if (this.currentModule === moduleName) return;
        
        try {
            const response = await fetch(`public/modules/${moduleName}/${moduleName}.html`);
            const html = await response.text();
            this.container.innerHTML = html;
            
            if (this.moduleScript) {
                this.moduleScript.remove();
            }
            
            this.moduleScript = document.createElement('script');
            this.moduleScript.src = `public/modules/${moduleName}/${moduleName}.js`;
            document.body.appendChild(this.moduleScript);
            
            this.currentModule = moduleName;
        } catch (error) {
            console.error(`Error loading module ${moduleName}:`, error);
            this.container.innerHTML = `<div style="padding: 20px; color: #f38ba8;">Module not found: ${moduleName}</div>`;
        }
    }
};
window.ModuleLoader = ModuleLoader;

document.addEventListener('DOMContentLoaded', () => {
    if (window.ThemeManager) window.ThemeManager.init();
    Drawer.init();
    AppNotify.init();
    AppConfirm.init();
    TabManager.init();
    ModuleLoader.init();
    if (window.AiManager) window.AiManager.init();
    if (window.ProfileManager) window.ProfileManager.init();
});
