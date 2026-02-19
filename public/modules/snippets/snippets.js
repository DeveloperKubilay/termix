(function() {
    const listEl = document.getElementById('snippets-list');
    const btnNewSnippet = document.getElementById('btn-new-snippet');
    const btnRefreshSnippets = document.getElementById('btn-refresh-snippets');
    const drawerTemplate = document.getElementById('snippet-drawer-template');
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
