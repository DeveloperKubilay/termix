(function () {
    const sftpApi = window.electronAPI && window.electronAPI.sftp;
    const hostsApi = window.electronAPI && window.electronAPI.hosts;

    if (!sftpApi || !hostsApi) {
        return;
    }

    const paneKeys = ['left', 'right'];

    const ui = {
        status: document.getElementById('sftp-global-status'),
        panes: {
            left: {
                root: document.getElementById('sftp-pane-left'),
                modeSwitch: document.getElementById('sftp-mode-left'),
                connText: document.getElementById('sftp-conn-left'),
                disconnectBtn: document.getElementById('sftp-disconnect-left'),
                breadcrumbs: document.getElementById('sftp-breadcrumbs-left'),
                pathInput: document.getElementById('sftp-path-left'),
                goBtn: document.getElementById('sftp-go-left'),
                refreshBtn: document.getElementById('sftp-refresh-left'),
                list: document.getElementById('sftp-list-left'),
                hostOverlay: document.getElementById('sftp-overlay-left'),
                hostSearch: document.getElementById('sftp-host-search-left'),
                hostList: document.getElementById('sftp-host-list-left')
            },
            right: {
                root: document.getElementById('sftp-pane-right'),
                modeSwitch: document.getElementById('sftp-mode-right'),
                connText: document.getElementById('sftp-conn-right'),
                disconnectBtn: document.getElementById('sftp-disconnect-right'),
                breadcrumbs: document.getElementById('sftp-breadcrumbs-right'),
                pathInput: document.getElementById('sftp-path-right'),
                goBtn: document.getElementById('sftp-go-right'),
                refreshBtn: document.getElementById('sftp-refresh-right'),
                list: document.getElementById('sftp-list-right'),
                hostOverlay: document.getElementById('sftp-overlay-right'),
                hostSearch: document.getElementById('sftp-host-search-right'),
                hostList: document.getElementById('sftp-host-list-right')
            }
        }
    };

    const state = {
        hosts: [],
        activePaneKey: 'left',
        clipboard: null,
        dragPayload: null,
        dragHoverRow: null,
        panes: {
            left: {
                key: 'left',
                mode: 'local',
                selectedHostId: null,
                connectedHostId: null,
                sessionId: null,
                connectPromise: null,
                path: '',
                parentPath: null,
                entries: [],
                selected: new Set(),
                loading: false,
                requestId: 0
            },
            right: {
                key: 'right',
                mode: 'vds',
                selectedHostId: null,
                connectedHostId: null,
                sessionId: null,
                connectPromise: null,
                path: '',
                parentPath: null,
                entries: [],
                selected: new Set(),
                loading: false,
                requestId: 0
            }
        }
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function encodePathValue(value) {
        return encodeURIComponent(String(value || ''));
    }

    function decodePathValue(value) {
        try {
            return decodeURIComponent(String(value || ''));
        } catch (_) {
            return String(value || '');
        }
    }

    function formatSize(bytes) {
        if (bytes == null || Number.isNaN(Number(bytes))) return '-';

        const num = Number(bytes);
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
        if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
        return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(Number(value));
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    function setStatus(message, type) {
        if (!ui.status) return;
        const nextType = type || 'info';
        ui.status.className = `sftp-status ${nextType}`;
        ui.status.textContent = message;
    }

    function getPaneState(key) {
        return state.panes[key];
    }

    function getPaneUi(key) {
        return ui.panes[key];
    }

    function getPaneSide(pane) {
        return pane.mode === 'local' ? 'local' : 'remote';
    }

    function getHostById(hostId) {
        const target = String(hostId || '');
        return state.hosts.find((host) => String(host.id) === target) || null;
    }

    function activatePane(key, shouldFocus) {
        state.activePaneKey = key;
        paneKeys.forEach((paneKey) => {
            const paneUi = getPaneUi(paneKey);
            if (!paneUi || !paneUi.root) return;
            paneUi.root.classList.toggle('active', paneKey === key);
        });

        if (shouldFocus === false) return;
        const paneUi = getPaneUi(key);
        if (paneUi && paneUi.list) {
            try { paneUi.list.focus({ preventScroll: true }); } catch (_) {}
        }
    }

    function buildLocalBreadcrumbs(pathValue) {
        const value = String(pathValue || '').trim();
        if (!value) return [];

        const normalized = value.replace(/\//g, '\\');
        const driveMatch = normalized.match(/^([a-zA-Z]:)(\\.*)?$/);

        if (driveMatch) {
            const drive = driveMatch[1];
            const rest = (driveMatch[2] || '').split('\\').filter(Boolean);
            const crumbs = [{ label: drive, path: `${drive}\\` }];

            let current = `${drive}\\`;
            for (const part of rest) {
                current = current.endsWith('\\') ? `${current}${part}` : `${current}\\${part}`;
                crumbs.push({ label: part, path: current });
            }
            return crumbs;
        }

        const unixLike = value.replace(/\\/g, '/');
        const parts = unixLike.split('/').filter(Boolean);
        const crumbs = [{ label: '/', path: '/' }];

        let current = '';
        for (const part of parts) {
            current += `/${part}`;
            crumbs.push({ label: part, path: current });
        }

        return crumbs;
    }

    function buildRemoteBreadcrumbs(pathValue) {
        const value = String(pathValue || '/').trim() || '/';
        const normalized = value.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);

        const crumbs = [{ label: '/', path: '/' }];
        let current = '';

        for (const part of parts) {
            current += `/${part}`;
            crumbs.push({ label: part, path: current });
        }

        return crumbs;
    }

    function renderBreadcrumbs(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.breadcrumbs) return;

        const crumbs = pane.mode === 'local'
            ? buildLocalBreadcrumbs(pane.path)
            : buildRemoteBreadcrumbs(pane.path || '/');

        if (!crumbs.length) {
            paneUi.breadcrumbs.innerHTML = '<span class="sftp-file-meta">-</span>';
            return;
        }

        paneUi.breadcrumbs.innerHTML = crumbs.map((crumb) => {
            const encoded = encodePathValue(crumb.path);
            return `
                <button type="button" class="sftp-crumb-btn" data-pane="${key}" data-path="${encoded}">${escapeHtml(crumb.label)}</button>
                <span class="sftp-crumb-sep">&gt;</span>
            `;
        }).join('');
    }

    function renderHostList(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.hostList) return;

        const query = String(paneUi.hostSearch && paneUi.hostSearch.value ? paneUi.hostSearch.value : '')
            .toLowerCase()
            .trim();

        const filteredHosts = state.hosts.filter((host) => {
            if (!query) return true;
            const blob = `${host.name || ''} ${host.address || ''} ${host.username || ''}`.toLowerCase();
            return blob.includes(query);
        });

        if (!filteredHosts.length) {
            paneUi.hostList.innerHTML = '<div class="sftp-empty" style="padding: 10px;">SSH host bulunamadi.</div>';
            return;
        }

        paneUi.hostList.innerHTML = filteredHosts.map((host) => {
            const isSelected = String(pane.selectedHostId) === String(host.id);
            const classes = ['sftp-host-item', isSelected ? 'selected' : ''].filter(Boolean).join(' ');
            const icon = host.icon || 'fa-solid fa-server';
            const color = host.color || '#89b4fa';
            const title = host.name || host.address || 'Unnamed';
            const subtitle = `${host.username || 'root'}@${host.address || ''}`;

            return `
                <div class="${classes}" data-pane="${key}" data-host-id="${escapeHtml(String(host.id))}">
                    <div class="sftp-host-icon" style="background: ${escapeHtml(color)};">
                        <i class="${escapeHtml(icon)}"></i>
                    </div>
                    <div class="sftp-host-meta">
                        <div class="sftp-host-name">${escapeHtml(title)}</div>
                        <div class="sftp-host-sub">${escapeHtml(subtitle)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderPane(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi) return;

        const isRemoteMode = pane.mode === 'vds';
        const isConnected = isRemoteMode && Boolean(pane.sessionId);

        if (paneUi.root) {
            paneUi.root.classList.toggle('connected', isConnected);
        }

        if (paneUi.modeSwitch) {
            const buttons = paneUi.modeSwitch.querySelectorAll('button[data-mode]');
            buttons.forEach((button) => {
                const mode = button.getAttribute('data-mode');
                button.classList.toggle('active', mode === pane.mode);
            });
        }

        if (paneUi.connText) {
            if (pane.mode === 'local') {
                paneUi.connText.textContent = 'Local';
            } else if (pane.sessionId) {
                const host = getHostById(pane.connectedHostId);
                const hostLabel = host ? (host.name || host.address || 'VDS') : 'VDS';
                paneUi.connText.textContent = `Baglandi: ${hostLabel}`;
            } else {
                paneUi.connText.textContent = 'Bagli degil';
            }
        }

        if (paneUi.pathInput) {
            paneUi.pathInput.value = pane.path || '';
            paneUi.pathInput.disabled = isRemoteMode && !isConnected;
        }
        if (paneUi.goBtn) {
            paneUi.goBtn.disabled = isRemoteMode && !isConnected;
        }
        if (paneUi.refreshBtn) {
            paneUi.refreshBtn.disabled = isRemoteMode && !isConnected;
        }

        if (paneUi.hostOverlay) {
            paneUi.hostOverlay.classList.toggle('show', isRemoteMode && !isConnected);
        }

        if (paneUi.list) {
            if (pane.loading) {
                paneUi.list.innerHTML = '<div class="sftp-empty">Yukleniyor...</div>';
            } else if (isRemoteMode && !isConnected) {
                paneUi.list.innerHTML = '<div class="sftp-empty">VDS secimi bekleniyor...</div>';
            } else {
                const rows = [];
                if (pane.parentPath) {
                    rows.push({
                        isParent: true,
                        isDirectory: true,
                        name: '..',
                        path: pane.parentPath,
                        size: null,
                        modifiedAt: null
                    });
                }

                pane.entries.forEach((entry) => rows.push({ ...entry, isParent: false }));

                if (!rows.length) {
                    paneUi.list.innerHTML = '<div class="sftp-empty">Bu klasorde oge yok.</div>';
                } else {
                    paneUi.list.innerHTML = rows.map((item) => {
                        const selected = !item.isParent && pane.selected.has(item.path);
                        const rowClasses = [
                            'sftp-file-row',
                            selected ? 'selected' : '',
                            item.isParent ? 'up' : ''
                        ].filter(Boolean).join(' ');
                        const draggable = item.isParent ? 'false' : 'true';

                        const iconClass = item.isParent
                            ? 'fa-solid fa-arrow-up-from-bracket'
                            : (item.isDirectory ? 'fa-solid fa-folder' : 'fa-regular fa-file-lines');

                        const encodedPath = encodePathValue(item.path);

                        return `
                            <div class="${rowClasses}" data-pane="${key}" data-path="${encodedPath}" data-parent="${item.isParent ? '1' : '0'}" data-directory="${item.isDirectory ? '1' : '0'}" draggable="${draggable}">
                                <div class="sftp-file-name">
                                    <i class="${iconClass}"></i>
                                    <span class="label">${escapeHtml(item.name)}</span>
                                </div>
                                <div class="sftp-file-meta">${item.isDirectory || item.isParent ? '-' : escapeHtml(formatSize(item.size))}</div>
                                <div class="sftp-file-time">${item.isParent ? '-' : escapeHtml(formatDate(item.modifiedAt))}</div>
                            </div>
                        `;
                    }).join('');
                }
            }
        }

        renderBreadcrumbs(key);
        renderHostList(key);
    }

    function renderAllPanes() {
        paneKeys.forEach((paneKey) => renderPane(paneKey));
        activatePane(state.activePaneKey, false);
    }

    async function refreshPane(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return false;

        const paneSide = getPaneSide(pane);
        const requestId = ++pane.requestId;
        pane.loading = true;
        renderPane(key);

        const payload = {
            side: paneSide,
            path: targetPath != null ? targetPath : pane.path
        };

        if (paneSide === 'remote') {
            if (!pane.sessionId) {
                pane.loading = false;
                renderPane(key);
                return false;
            }
            payload.sessionId = pane.sessionId;
        }

        const result = await sftpApi.listDirectory(payload);
        if (requestId !== pane.requestId) return false;

        pane.loading = false;

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Klasor listesi alinamadi.', 'error');
            renderPane(key);
            return false;
        }

        pane.path = result.path || payload.path || pane.path;
        pane.parentPath = result.parentPath || null;
        pane.entries = Array.isArray(result.entries) ? result.entries : [];
        pane.selected.clear();

        renderPane(key);
        return true;
    }

    async function disconnectPane(key, silent) {
        const pane = getPaneState(key);
        if (!pane) return false;

        if (!pane.sessionId) {
            return true;
        }

        const result = await sftpApi.disconnect(pane.sessionId);
        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Baglanti kapatilamadi.', 'error');
            return false;
        }

        pane.sessionId = null;
        pane.connectedHostId = null;
        pane.path = '';
        pane.parentPath = null;
        pane.entries = [];
        pane.selected.clear();
        pane.loading = false;

        renderPane(key);

        if (!silent) {
            setStatus(`${key === 'left' ? 'Sol' : 'Sag'} panel baglantisi kesildi.`, 'info');
        }

        return true;
    }

    async function connectPane(key, options) {
        const opts = options || {};
        const pane = getPaneState(key);
        if (!pane || pane.mode !== 'vds') {
            return false;
        }

        if (!pane.selectedHostId && state.hosts.length) {
            pane.selectedHostId = String(state.hosts[0].id);
        }

        if (!pane.selectedHostId) {
            if (!opts.silent) setStatus('SSH host bulunamadi.', 'error');
            renderPane(key);
            return false;
        }

        const sameHost = pane.sessionId && String(pane.connectedHostId) === String(pane.selectedHostId);
        if (sameHost && !opts.forceReconnect) {
            return true;
        }

        if (pane.connectPromise) {
            return pane.connectPromise;
        }

        const task = (async () => {
            if (pane.sessionId) {
                const disconnected = await disconnectPane(key, true);
                if (!disconnected) return false;
            }

            if (!opts.silent) {
                setStatus(`${key === 'left' ? 'Sol' : 'Sag'} panel baglantisi kuruluyor...`, 'info');
            }

            const result = await sftpApi.connect(pane.selectedHostId);
            if (!result || result.success === false) {
                if (!opts.silent) {
                    setStatus(result && result.message ? result.message : 'Baglanti kurulamadi.', 'error');
                }
                return false;
            }

            pane.sessionId = result.sessionId;
            pane.connectedHostId = pane.selectedHostId;
            pane.path = result.homePath || '/';
            pane.parentPath = null;
            pane.entries = [];
            pane.selected.clear();

            renderPane(key);
            const refreshed = await refreshPane(key, pane.path);
            if (!refreshed) return false;

            if (!opts.silent) {
                const host = getHostById(pane.selectedHostId);
                const hostLabel = host ? (host.name || host.address || 'VDS') : 'VDS';
                setStatus(`${key === 'left' ? 'Sol' : 'Sag'} panel baglandi: ${hostLabel}`, 'success');
            }

            return true;
        })();

        pane.connectPromise = task;
        try {
            return await task;
        } finally {
            if (pane.connectPromise === task) {
                pane.connectPromise = null;
            }
        }
    }

    async function ensurePaneConnected(key) {
        const pane = getPaneState(key);
        if (!pane) return false;

        if (pane.mode !== 'vds') return true;
        if (pane.sessionId) return true;
        return connectPane(key, { silent: false, forceReconnect: false });
    }

    async function switchPaneMode(key, mode) {
        const pane = getPaneState(key);
        if (!pane) return;

        if (pane.mode === mode) return;

        if (mode === 'local') {
            await disconnectPane(key, true);
            pane.mode = 'local';
            pane.path = '';
            pane.parentPath = null;
            pane.entries = [];
            pane.selected.clear();
            renderPane(key);
            await refreshPane(key, '');
            setStatus(`${key === 'left' ? 'Sol' : 'Sag'} panel Local moda gecti.`, 'info');
            return;
        }

        pane.mode = 'vds';
        pane.path = '';
        pane.parentPath = null;
        pane.entries = [];
        pane.selected.clear();
        renderPane(key);
        setStatus(`${key === 'left' ? 'Sol' : 'Sag'} panel icin VDS secin.`, 'info');
    }

    function getSelectedEntries(key) {
        const pane = getPaneState(key);
        if (!pane) return [];
        return pane.entries.filter((entry) => pane.selected.has(entry.path));
    }

    function updateSelectionClasses(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.list) return;

        const rows = paneUi.list.querySelectorAll('.sftp-file-row');
        rows.forEach((row) => {
            const isParent = row.dataset.parent === '1';
            if (isParent) {
                row.classList.remove('selected');
                return;
            }

            const rowPath = decodePathValue(row.dataset.path || '');
            row.classList.toggle('selected', pane.selected.has(rowPath));
        });
    }

    function clearDropIndicators() {
        paneKeys.forEach((paneKey) => {
            const paneUi = getPaneUi(paneKey);
            if (!paneUi || !paneUi.list) return;
            paneUi.list.classList.remove('drag-over');
            const highlightedRows = paneUi.list.querySelectorAll('.sftp-file-row.drop-target');
            highlightedRows.forEach((row) => row.classList.remove('drop-target'));
        });
        state.dragHoverRow = null;
    }

    function buildCopyPayload(sourcePaneKey, entries) {
        const pane = getPaneState(sourcePaneKey);
        if (!pane) return null;

        const sourceSide = getPaneSide(pane);
        const validEntries = Array.isArray(entries) ? entries : [];
        if (!validEntries.length) return null;

        return {
            sourcePaneKey,
            sourceSide,
            sourceSessionId: sourceSide === 'remote' ? pane.sessionId : null,
            items: validEntries.map((entry) => ({
                path: entry.path,
                isDirectory: Boolean(entry.isDirectory)
            }))
        };
    }

    function selectOnly(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return;
        pane.selected.clear();
        pane.selected.add(targetPath);
        updateSelectionClasses(key);
    }

    function toggleSelection(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return;
        if (pane.selected.has(targetPath)) {
            pane.selected.delete(targetPath);
        } else {
            pane.selected.add(targetPath);
        }
        updateSelectionClasses(key);
    }

    function selectAll(key) {
        const pane = getPaneState(key);
        if (!pane) return;
        pane.selected = new Set((pane.entries || []).map((entry) => entry.path).filter(Boolean));
        updateSelectionClasses(key);
    }

    function copySelected(key) {
        const pane = getPaneState(key);
        if (!pane) return;

        const selected = getSelectedEntries(key);
        if (!selected.length) {
            setStatus('Kopyalamak icin secili oge yok.', 'error');
            return;
        }

        const payload = buildCopyPayload(key, selected);
        if (!payload) return;

        state.clipboard = payload;

        setStatus(`${selected.length} oge kopyalandi.`, 'success');
    }

    async function executeCopyToPane(copyPayload, destinationPaneKey, destinationPathOverride, successMessage) {
        const destinationPane = getPaneState(destinationPaneKey);
        if (!destinationPane) return false;

        if (!copyPayload || !Array.isArray(copyPayload.items) || !copyPayload.items.length) {
            setStatus('Yapistirilacak oge yok.', 'error');
            return false;
        }

        const destinationSide = getPaneSide(destinationPane);
        if (destinationSide === 'remote') {
            const connected = await ensurePaneConnected(destinationPaneKey);
            if (!connected) return false;
        }

        const destinationPath = destinationPathOverride || destinationPane.path;
        if (!destinationPath) {
            setStatus('Hedef klasor secili degil.', 'error');
            return false;
        }

        const sourcePane = getPaneState(copyPayload.sourcePaneKey);
        let sourceSessionId = copyPayload.sourceSessionId;
        if (copyPayload.sourceSide === 'remote' && sourcePane && sourcePane.sessionId) {
            sourceSessionId = sourcePane.sessionId;
        }

        const result = await sftpApi.copyItems({
            sourceSide: copyPayload.sourceSide,
            destinationSide,
            sourceSessionId,
            destinationSessionId: destinationSide === 'remote' ? destinationPane.sessionId : null,
            destinationPath,
            items: copyPayload.items
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Kopyalama basarisiz.', 'error');
            return false;
        }

        await refreshPane(destinationPaneKey);
        setStatus(successMessage || `${result.copiedCount || copyPayload.items.length} oge yapistirildi.`, 'success');
        return true;
    }

    async function pasteToPane(key) {
        const destinationPane = getPaneState(key);
        if (!destinationPane) return;

        if (!state.clipboard || !Array.isArray(state.clipboard.items) || !state.clipboard.items.length) {
            setStatus('Yapistirilacak oge yok.', 'error');
            return;
        }

        await executeCopyToPane(state.clipboard, key, null, `${state.clipboard.items.length} oge yapistirildi.`);
    }

    async function deleteSelected(key) {
        const pane = getPaneState(key);
        if (!pane) return;

        const selected = getSelectedEntries(key);
        if (!selected.length) {
            setStatus('Silinecek oge secilmedi.', 'error');
            return;
        }

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const sure = window.confirm(`${selected.length} oge silinsin mi?`);
        if (!sure) return;

        const result = await sftpApi.deleteItems({
            side,
            sessionId: side === 'remote' ? pane.sessionId : null,
            items: selected.map((entry) => ({ path: entry.path }))
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Silme basarisiz.', 'error');
            return;
        }

        await refreshPane(key);
        setStatus(`${selected.length} oge silindi.`, 'success');
    }

    async function loadHosts() {
        const allHosts = await hostsApi.getData();
        state.hosts = (Array.isArray(allHosts) ? allHosts : [])
            .filter((host) => String(host.protocol || 'SSH').toUpperCase() === 'SSH');

        paneKeys.forEach((key) => {
            const pane = getPaneState(key);
            if (!pane) return;
            if (!pane.selectedHostId && state.hosts.length) {
                pane.selectedHostId = String(state.hosts[0].id);
            }
        });

        renderAllPanes();
    }

    function bindPaneEvents(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi) return;

        if (paneUi.root) {
            paneUi.root.addEventListener('mousedown', () => activatePane(key, false));
        }

        if (paneUi.modeSwitch) {
            paneUi.modeSwitch.addEventListener('click', async (event) => {
                const button = event.target.closest('button[data-mode]');
                if (!button) return;
                const mode = button.dataset.mode;
                if (!mode) return;
                activatePane(key, false);
                await switchPaneMode(key, mode);
            });
        }

        if (paneUi.disconnectBtn) {
            paneUi.disconnectBtn.addEventListener('click', async () => {
                activatePane(key, false);
                await disconnectPane(key, false);
            });
        }

        if (paneUi.goBtn) {
            paneUi.goBtn.addEventListener('click', async () => {
                activatePane(key, false);
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key, paneUi.pathInput ? paneUi.pathInput.value : '');
            });
        }

        if (paneUi.refreshBtn) {
            paneUi.refreshBtn.addEventListener('click', async () => {
                activatePane(key, false);
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key);
            });
        }

        if (paneUi.pathInput) {
            paneUi.pathInput.addEventListener('keydown', async (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                activatePane(key, false);
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key, paneUi.pathInput.value);
            });
        }

        if (paneUi.list) {
            paneUi.list.addEventListener('focus', () => activatePane(key, false));

            paneUi.list.addEventListener('click', async (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) return;

                activatePane(key, false);

                const targetPath = decodePathValue(row.dataset.path || '');
                if (!targetPath) return;

                const isParentRow = row.dataset.parent === '1';
                const withToggle = event.ctrlKey || event.metaKey;

                if (isParentRow) {
                    await refreshPane(key, targetPath);
                    return;
                }

                if (withToggle) {
                    toggleSelection(key, targetPath);
                } else {
                    selectOnly(key, targetPath);
                }
            });

            paneUi.list.addEventListener('dblclick', async (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) return;

                const targetPath = decodePathValue(row.dataset.path || '');
                if (!targetPath) return;

                const isParentRow = row.dataset.parent === '1';
                const isDirectory = row.dataset.directory === '1';

                if (isParentRow || isDirectory) {
                    await refreshPane(key, targetPath);
                }
            });

            paneUi.list.addEventListener('dragstart', (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) {
                    event.preventDefault();
                    return;
                }

                const isParentRow = row.dataset.parent === '1';
                if (isParentRow) {
                    event.preventDefault();
                    return;
                }

                const sourcePath = decodePathValue(row.dataset.path || '');
                if (!sourcePath) {
                    event.preventDefault();
                    return;
                }

                activatePane(key, false);

                if (!pane.selected.has(sourcePath)) {
                    selectOnly(key, sourcePath);
                }

                const selectedEntries = getSelectedEntries(key);
                const payload = buildCopyPayload(key, selectedEntries);
                if (!payload) {
                    event.preventDefault();
                    return;
                }

                state.dragPayload = payload;

                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('text/plain', 'termix-sftp-drag');
                }
            });

            paneUi.list.addEventListener('dragover', (event) => {
                if (!state.dragPayload) return;
                event.preventDefault();
                paneUi.list.classList.add('drag-over');

                const candidateRow = event.target.closest('.sftp-file-row');
                const isDirectoryDropTarget = candidateRow
                    && candidateRow.dataset.parent !== '1'
                    && candidateRow.dataset.directory === '1';

                if (state.dragHoverRow && state.dragHoverRow !== candidateRow) {
                    state.dragHoverRow.classList.remove('drop-target');
                    state.dragHoverRow = null;
                }

                if (isDirectoryDropTarget) {
                    candidateRow.classList.add('drop-target');
                    state.dragHoverRow = candidateRow;
                } else if (state.dragHoverRow) {
                    state.dragHoverRow.classList.remove('drop-target');
                    state.dragHoverRow = null;
                }

                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy';
                }
            });

            paneUi.list.addEventListener('dragleave', (event) => {
                if (!paneUi.list.contains(event.relatedTarget)) {
                    paneUi.list.classList.remove('drag-over');
                    if (state.dragHoverRow) {
                        state.dragHoverRow.classList.remove('drop-target');
                        state.dragHoverRow = null;
                    }
                }
            });

            paneUi.list.addEventListener('drop', async (event) => {
                if (!state.dragPayload) return;
                event.preventDefault();
                activatePane(key, false);

                const payload = state.dragPayload;
                const targetRow = event.target.closest('.sftp-file-row');
                const canDropIntoRow = targetRow
                    && targetRow.dataset.parent !== '1'
                    && targetRow.dataset.directory === '1';

                let destinationPath = null;
                if (canDropIntoRow) {
                    destinationPath = decodePathValue(targetRow.dataset.path || '');
                }

                clearDropIndicators();
                state.dragPayload = null;

                await executeCopyToPane(payload, key, destinationPath, 'Kopyalama tamamlandi.');
            });

            paneUi.list.addEventListener('dragend', () => {
                clearDropIndicators();
                state.dragPayload = null;
            });
        }

        if (paneUi.breadcrumbs) {
            paneUi.breadcrumbs.addEventListener('click', async (event) => {
                const button = event.target.closest('.sftp-crumb-btn');
                if (!button) return;

                const targetPath = decodePathValue(button.dataset.path || '');
                if (!targetPath) return;

                activatePane(key, false);
                await refreshPane(key, targetPath);
            });
        }

        if (paneUi.hostSearch) {
            paneUi.hostSearch.addEventListener('input', () => {
                renderHostList(key);
            });
        }

        if (paneUi.hostList) {
            paneUi.hostList.addEventListener('click', async (event) => {
                const hostItem = event.target.closest('.sftp-host-item');
                if (!hostItem) return;

                const hostId = hostItem.dataset.hostId;
                if (!hostId) return;

                pane.selectedHostId = hostId;
                renderPane(key);
                await connectPane(key, { silent: false, forceReconnect: false });
            });
        }
    }

    function bindGlobalShortcuts() {
        if (window.__sftpGlobalKeydownHandler) {
            document.removeEventListener('keydown', window.__sftpGlobalKeydownHandler);
        }

        const handle = async (event) => {
            if (!document.getElementById('sftp-pane-left')) {
                document.removeEventListener('keydown', handle);
                return;
            }

            const activeTag = document.activeElement && document.activeElement.tagName
                ? document.activeElement.tagName.toLowerCase()
                : '';

            if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
                return;
            }

            const key = state.activePaneKey || 'left';

            if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
                event.preventDefault();
                selectAll(key);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
                event.preventDefault();
                copySelected(key);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
                event.preventDefault();
                await pasteToPane(key);
                return;
            }

            if (event.key === 'Delete') {
                event.preventDefault();
                await deleteSelected(key);
            }
        };

        window.__sftpGlobalKeydownHandler = handle;
        document.addEventListener('keydown', handle);
    }

    async function init() {
        paneKeys.forEach((key) => bindPaneEvents(key));
        bindGlobalShortcuts();

        activatePane('left', false);
        renderAllPanes();

        await loadHosts();
        await refreshPane('left', '');

        setStatus('Hazir', 'info');
    }

    init().catch((err) => {
        setStatus(`SFTP baslatma hatasi: ${err.message || err}`, 'error');
    });
})();
