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
    ModuleLoader.init();
});
