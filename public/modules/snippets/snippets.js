(function() {
    const listEl = document.getElementById('snippets-list');
    const btnNewSnippet = document.getElementById('btn-new-snippet');
    const btnRefreshSnippets = document.getElementById('btn-refresh-snippets');
    const drawerTemplate = document.getElementById('snippet-drawer-template');
    const useDrawerTemplate = document.getElementById('snippet-use-drawer-template');
    const api = window.electronAPI && window.electronAPI.snippets;

    let snippets = [];

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showListMessage(message, isError = false) {
        if (!listEl) return;
        const color = isError ? '#f38ba8' : 'var(--text-muted)';
        listEl.innerHTML = `<div class="sn-empty-state" style="color: ${color};">${escapeHtml(message)}</div>`;
    }

    function renderList() {
        if (!listEl) return;

        if (!snippets.length) {
            showListMessage('No snippets yet. Add one from NEW SNIPPET.');
            return;
        }

        listEl.innerHTML = snippets.map((snippet) => {
            const source = snippet.source === 'url'
                ? '<i class="fa-solid fa-link"></i> URL'
                : '<i class="fa-solid fa-keyboard"></i> Manual';

            return `
                <div class="sn-item">
                    <div class="sn-item-top">
                        <div class="sn-item-title-wrap">
                            <div class="sn-item-title">${escapeHtml(snippet.name)}</div>
                            <div class="sn-source-badge">${source}</div>
                        </div>
                        <div class="sn-actions">
                            <button class="sn-action-btn" data-action="use" data-id="${escapeHtml(snippet.id)}">
                                <i class="fa-solid fa-play"></i> Use
                            </button>
                            <button class="sn-action-btn" data-action="copy" data-id="${escapeHtml(snippet.id)}">
                                <i class="fa-solid fa-copy"></i> Copy
                            </button>
                            <button class="sn-action-btn delete" data-action="delete" data-id="${escapeHtml(snippet.id)}">
                                <i class="fa-solid fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                    <pre class="sn-command">${escapeHtml(snippet.command)}</pre>
                    ${snippet.source === 'url' && snippet.url ? `<div class="sn-url">${escapeHtml(snippet.url)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    async function loadSnippets() {
        if (!api || !api.getSnippets) {
            showListMessage('Snippets API is not loaded.', true);
            return;
        }

        showListMessage('Loading snippets...');

        try {
            const result = await api.getSnippets();
            snippets = Array.isArray(result) ? result : [];
            renderList();
        } catch (err) {
            showListMessage(err && err.message ? err.message : 'Failed to load snippets.', true);
        }
    }

    async function ensureConnectionModule() {
        if (window.ConnectionModule) {
            return true;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'public/modules/connection/connection.js';
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
    }

    function normalizeCommandForRun(command) {
        const value = String(command || '');
        if (!value) return '\r';

        if (value.endsWith('\r') || value.endsWith('\n')) {
            return value;
        }

        return `${value}\r`;
    }

    async function getVdsHosts() {
        if (!window.electronAPI || !window.electronAPI.hosts || !window.electronAPI.hosts.getData) {
            return [];
        }

        const hosts = await window.electronAPI.hosts.getData();
        const rows = Array.isArray(hosts) ? hosts : [];

        return rows.filter((host) => String(host && host.protocol ? host.protocol : 'ssh').toUpperCase() === 'SSH');
    }

    async function runSnippetOnHost(snippet, host) {
        const hasModule = await ensureConnectionModule();
        if (!hasModule || !window.ConnectionModule || !window.TabManager) {
            throw new Error('Connection module is not available.');
        }

        const tabId = `snippet-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const hostTitle = host && (host.name || host.address) ? (host.name || host.address) : 'VDS';
        const snippetTitle = snippet && snippet.name ? snippet.name : 'Snippet';

        window.TabManager.addTab({
            id: tabId,
            title: `${hostTitle} | ${snippetTitle}`,
            icon: host && host.icon ? host.icon : 'fa-solid fa-terminal',
            contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
        });

        const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, host);
        if (!sessionObj || !sessionObj.sessionId) {
            throw new Error('Session could not be created.');
        }

        const tab = window.TabManager.tabs.find((item) => item.id === tabId);
        if (tab) tab.sessionObj = sessionObj;

        const payload = normalizeCommandForRun(snippet.command);
        window.electronAPI.send('term-input', {
            sessionId: sessionObj.sessionId,
            data: payload
        });
    }

    function openUseDrawer(snippet) {
        if (!window.Drawer || !useDrawerTemplate) return;

        Drawer.open('Run Snippet', useDrawerTemplate.innerHTML);

        setTimeout(async () => {
            const commandPreview = document.getElementById('sn-run-command-preview');
            const hostTrigger = document.getElementById('sn-run-host-trigger');
            const hostTriggerText = document.getElementById('sn-run-host-trigger-text');
            const hostTriggerIcon = document.getElementById('sn-run-host-trigger-icon');
            const hostDropdown = document.getElementById('sn-run-host-dropdown');
            const hostList = document.getElementById('sn-run-host-list');
            const hostSearch = document.getElementById('sn-run-host-search');
            const runBtn = document.getElementById('sn-run-btn');
            const errorEl = document.getElementById('sn-run-error');

            let vdsHosts = [];
            let selectedHost = null;

            if (commandPreview) {
                commandPreview.textContent = String(snippet && snippet.command ? snippet.command : '');
            }

            function showError(message) {
                if (!errorEl) return;
                errorEl.textContent = message || '';
            }

            function updateSelectedHostUi() {
                if (!hostTriggerText || !hostTriggerIcon) return;

                if (!selectedHost) {
                    hostTriggerText.textContent = 'Bir VDS secin';
                    hostTriggerIcon.innerHTML = '<i class="fa-solid fa-server"></i>';
                    hostTriggerIcon.style.background = '#45475a';
                    return;
                }

                hostTriggerText.textContent = `${selectedHost.name || selectedHost.address} (${selectedHost.username || 'root'}@${selectedHost.address || ''})`;
                hostTriggerIcon.style.background = selectedHost.color || '#89b4fa';
                hostTriggerIcon.innerHTML = `<i class="${escapeHtml(selectedHost.icon || 'fa-solid fa-server')}"></i>`;
            }

            function closeHostDropdown() {
                if (hostDropdown) hostDropdown.classList.remove('show');
            }

            function renderHostList(filterText = '') {
                if (!hostList) return;

                const normalizedFilter = String(filterText || '').toLowerCase().trim();
                const filtered = vdsHosts.filter((host) => {
                    const blob = `${host.name || ''} ${host.address || ''} ${host.username || ''}`.toLowerCase();
                    return blob.includes(normalizedFilter);
                });

                if (!filtered.length) {
                    hostList.innerHTML = `
                        <div class="sn-empty-state" style="padding: 10px;">
                            ${vdsHosts.length ? 'No host found.' : 'Add an SSH host from Hosts module first.'}
                        </div>
                    `;
                    return;
                }

                hostList.innerHTML = filtered.map((host) => {
                    const icon = host.icon || 'fa-solid fa-server';
                    const color = host.color || '#89b4fa';
                    const title = host.name || host.address || 'Unnamed';
                    const subtitle = `${host.username || 'root'}@${host.address || ''}`;

                    return `
                        <div class="pf-host-item" data-host-id="${escapeHtml(host.id)}">
                            <div class="pf-vds-icon" style="background: ${escapeHtml(color)};">
                                <i class="${escapeHtml(icon)}"></i>
                            </div>
                            <div class="pf-host-item-meta">
                                <div class="pf-host-item-name">${escapeHtml(title)}</div>
                                <div class="pf-host-item-sub">${escapeHtml(subtitle)}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            try {
                vdsHosts = await getVdsHosts();
            } catch (err) {
                showError(err && err.message ? err.message : 'Hosts could not be loaded.');
                vdsHosts = [];
            }

            renderHostList('');
            updateSelectedHostUi();

            if (hostTrigger) {
                hostTrigger.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (hostDropdown) hostDropdown.classList.toggle('show');
                    if (hostSearch) hostSearch.focus();
                });
            }

            if (hostSearch) {
                hostSearch.addEventListener('input', (event) => {
                    renderHostList(event.target.value);
                });
            }

            if (hostList) {
                hostList.addEventListener('click', (event) => {
                    const item = event.target.closest('.pf-host-item');
                    if (!item) return;

                    const found = vdsHosts.find((host) => String(host.id) === String(item.dataset.hostId));
                    if (!found) return;

                    selectedHost = found;
                    updateSelectedHostUi();
                    closeHostDropdown();
                    if (hostTrigger) hostTrigger.style.borderColor = 'var(--border)';
                    showError('');
                });
            }

            if (window.__snippetsUseHostOutsideClick) {
                document.removeEventListener('click', window.__snippetsUseHostOutsideClick);
            }
            window.__snippetsUseHostOutsideClick = (event) => {
                if (!hostDropdown || !hostTrigger) return;
                if (hostDropdown.contains(event.target) || hostTrigger.contains(event.target)) return;
                closeHostDropdown();
            };
            document.addEventListener('click', window.__snippetsUseHostOutsideClick);

            if (runBtn) {
                runBtn.addEventListener('click', async () => {
                    showError('');
                    if (hostTrigger) hostTrigger.style.borderColor = 'var(--border)';

                    if (!selectedHost) {
                        if (hostTrigger) hostTrigger.style.borderColor = '#f38ba8';
                        showError('Please select a VDS first.');
                        return;
                    }

                    runBtn.disabled = true;
                    const originalText = runBtn.textContent;
                    runBtn.textContent = 'Starting...';

                    try {
                        await runSnippetOnHost(snippet, selectedHost);
                        Drawer.close();
                    } catch (err) {
                        showError(err && err.message ? err.message : 'Snippet could not run.');
                    } finally {
                        runBtn.disabled = false;
                        runBtn.textContent = originalText;
                    }
                });
            }
        }, 50);
    }

    function openCreateDrawer() {
        if (!window.Drawer || !drawerTemplate) return;

        Drawer.open('Snippet Ekle', drawerTemplate.innerHTML);

        setTimeout(() => {
            const urlCard = document.getElementById('sn-mode-url-card');
            const manualCard = document.getElementById('sn-mode-manual-card');
            const urlSection = document.getElementById('snippet-url-section');
            const manualSection = document.getElementById('snippet-manual-section');

            const urlInput = document.getElementById('snippet-url-input');
            const nameInput = document.getElementById('snippet-name-input');
            const commandInput = document.getElementById('snippet-command-input');

            const saveBtn = document.getElementById('snippet-save-btn');
            const statusEl = document.getElementById('snippet-drawer-status');

            let mode = 'url';

            function showStatus(message, isError = true) {
                if (!statusEl) return;
                statusEl.style.color = isError ? '#f38ba8' : '#a6e3a1';
                statusEl.textContent = message || '';
            }

            function resetBorders() {
                if (urlInput) urlInput.style.borderColor = 'var(--border)';
                if (nameInput) nameInput.style.borderColor = 'var(--border)';
                if (commandInput) commandInput.style.borderColor = 'var(--border)';
            }

            function setMode(nextMode) {
                mode = nextMode === 'manual' ? 'manual' : 'url';

                if (mode === 'url') {
                    if (urlCard) urlCard.classList.add('active');
                    if (manualCard) manualCard.classList.remove('active');
                    if (urlSection) urlSection.style.display = 'block';
                    if (manualSection) manualSection.style.display = 'none';
                    if (saveBtn) saveBtn.textContent = 'URL ile Ekle';
                } else {
                    if (manualCard) manualCard.classList.add('active');
                    if (urlCard) urlCard.classList.remove('active');
                    if (manualSection) manualSection.style.display = 'block';
                    if (urlSection) urlSection.style.display = 'none';
                    if (saveBtn) saveBtn.textContent = 'Manuel Kaydet';
                }

                showStatus('');
                resetBorders();
            }

            if (urlCard) {
                urlCard.addEventListener('click', () => setMode('url'));
            }

            if (manualCard) {
                manualCard.addEventListener('click', () => setMode('manual'));
            }

            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    if (!api) return;

                    showStatus('');
                    resetBorders();

                    saveBtn.disabled = true;
                    const originalLabel = saveBtn.textContent;
                    saveBtn.textContent = 'Kaydediliyor...';

                    try {
                        if (mode === 'url') {
                            const url = urlInput ? urlInput.value.trim() : '';
                            if (!url) {
                                if (urlInput) urlInput.style.borderColor = '#f38ba8';
                                showStatus('URL zorunlu.');
                                return;
                            }

                            let parsed;
                            try {
                                parsed = new URL(url);
                                if (!['http:', 'https:'].includes(parsed.protocol)) {
                                    throw new Error('invalid protocol');
                                }
                            } catch (_) {
                                if (urlInput) urlInput.style.borderColor = '#f38ba8';
                                showStatus('Gecerli bir URL girin.');
                                return;
                            }

                            const result = await api.importFromUrl({ url: parsed.toString() });
                            if (!result || result.success === false) {
                                showStatus(result && result.message ? result.message : 'URL import failed.');
                                return;
                            }

                            Drawer.close();
                            await loadSnippets();
                            return;
                        }

                        const name = nameInput ? nameInput.value.trim() : '';
                        const command = commandInput ? commandInput.value.trim() : '';

                        if (!name) {
                            if (nameInput) nameInput.style.borderColor = '#f38ba8';
                            showStatus('Komut ismi zorunlu.');
                            return;
                        }

                        if (!command) {
                            if (commandInput) commandInput.style.borderColor = '#f38ba8';
                            showStatus('Komut alani zorunlu.');
                            return;
                        }

                        const result = await api.saveSnippet({ name, command });
                        if (!result || result.success === false) {
                            showStatus(result && result.message ? result.message : 'Snippet save failed.');
                            return;
                        }

                        Drawer.close();
                        await loadSnippets();
                    } catch (err) {
                        showStatus(err && err.message ? err.message : 'Unexpected error.');
                    } finally {
                        saveBtn.disabled = false;
                        saveBtn.textContent = originalLabel;
                    }
                });
            }

            setMode('url');
        }, 50);
    }

    if (btnNewSnippet) {
        btnNewSnippet.addEventListener('click', () => {
            openCreateDrawer();
        });
    }

    if (btnRefreshSnippets) {
        btnRefreshSnippets.addEventListener('click', () => {
            loadSnippets();
        });
    }

    if (listEl) {
        listEl.addEventListener('click', async (event) => {
            const actionBtn = event.target.closest('button[data-action]');
            if (!actionBtn || !api) return;

            const action = actionBtn.dataset.action;
            const snippetId = actionBtn.dataset.id;
            if (!action || !snippetId) return;

            const snippet = snippets.find((item) => String(item.id) === String(snippetId));
            if (!snippet) return;

            if (action === 'use') {
                openUseDrawer(snippet);
                return;
            }

            if (action === 'copy') {
                try {
                    if (window.clipboard && window.clipboard.writeText) {
                        window.clipboard.writeText(snippet.command);
                    }

                    const original = actionBtn.innerHTML;
                    actionBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                    setTimeout(() => {
                        actionBtn.innerHTML = original;
                    }, 900);
                } catch (_) {}
                return;
            }

            if (action === 'delete') {
                actionBtn.disabled = true;
                try {
                    const result = await api.deleteSnippet(snippetId);
                    if (!result || result.success === false) {
                        actionBtn.disabled = false;
                        return;
                    }
                    await loadSnippets();
                } catch (_) {
                    actionBtn.disabled = false;
                }
            }
        });
    }

    loadSnippets();
})();
