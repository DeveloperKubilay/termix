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

const TabManager = {
    tabs: [],
    activeTabId: null,
    tabBar: null,
    contentArea: null,
    sidebar: null,
    sidebarToggle: null,

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
            title: options.title || 'New Tab',
            icon: options.icon || 'fa-solid fa-terminal',
            contentId: options.contentId,
            closable: options.closable !== false
        };

            // Create Tab Element (Daha önceki tab'da sessionObj'yi nasıl set ettik?)
        
        // Modules'un başlattığımız yerde session objesini tab'a bağlamamız lazım
        // Bu yüzden moduleContainer.init fonksiyonunun ne döndürdüğüne bakacağız.
        // Ama init asenkron olabilir.
        
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.id = id;
        tabEl.draggable = true;
        tabEl.innerHTML = `
            <i class="tab-icon ${tab.icon}"></i>
            <span class="tab-title">${tab.title}</span>
            ${tab.closable ? '<i class="tab-close fa-solid fa-xmark"></i>' : ''}
        `;

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

    activateTab(id) {
        if (this.activeTabId === id) return;

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

        // Auto-collapse sidebar logic
        if (this.sidebar) {
            if (id === 'dashboard') {
                this.sidebar.classList.remove('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'none';
            } else {
                this.sidebar.classList.add('collapsed');
                if (this.sidebarToggle) this.sidebarToggle.style.display = 'flex';
            }
        }
    },

    closeTab(id) {
        // Dashboard should never be closed via this method normally, but as a safeguard
        if (id === 'dashboard') return;

        const tabIndex = this.tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;

        const tab = this.tabs[tabIndex];
        
        // --- Cleanup Hook: Eğer tab bir objeye sahipse cleanup yap ---
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
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                menuItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const moduleName = item.getAttribute('data-module');
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

document.addEventListener('DOMContentLoaded', () => {
    Drawer.init();
    TabManager.init();
    ModuleLoader.init();
});
