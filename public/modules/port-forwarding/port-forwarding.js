(function() {
    const PORT_MIN = 1;
    const PORT_MAX = 65535;

    const tableBody = document.getElementById('forwards-table-body');
    const btnNewForward = document.getElementById('btn-new-forward');
    const btnRefreshForwards = document.getElementById('btn-refresh-forwards');
    const drawerTemplate = document.getElementById('forward-drawer-template');

    const api = window.electronAPI && window.electronAPI['port-forwarding'];

    let forwardRows = [];
    let hosts = [];

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function statusLabel(status) {
        const map = {
            active: 'Active',
            starting: 'Starting',
            error: 'Error',
            stopped: 'Stopped'
        };
        return map[status] || 'Stopped';
    }

    function normalizeDirection(value) {
        return String(value || '').trim().toLowerCase() === 'remote_to_local'
            ? 'remote_to_local'
            : 'local_to_remote';
    }

    function directionLabel(direction) {
        return direction === 'remote_to_local'
            ? 'My PC => VDS'
            : 'My PC <= VDS';
    }

    function getHostMeta(forward) {
        if (forward && forward.host) {
            return forward.host;
        }

        const fallback = hosts.find((item) => String(item.id) === String(forward.hostId));
        if (!fallback) return null;

        return {
            id: fallback.id,
            name: fallback.name || fallback.address || 'Unnamed',
            address: fallback.address || '',
            username: fallback.username || 'root',
            icon: fallback.icon || 'fa-solid fa-server',
            color: fallback.color || '#89b4fa'
        };
    }

    function endpoint(host, port) {
        return `${host || '127.0.0.1'}:${port || '-'}`;
    }

    function parsePortValue(value) {
        const text = String(value == null ? '' : value).trim();
        if (!text) return null;

        const parsed = Number(text);
        if (!Number.isInteger(parsed)) return null;
        if (parsed < PORT_MIN || parsed > PORT_MAX) return null;
        return parsed;
    }

    function bindPortInputValidation(inputEl) {
        if (!inputEl) return;

        const sanitize = (strict = false) => {
            const raw = String(inputEl.value || '');
            const digitsOnly = raw.replace(/[^\d]/g, '');
            inputEl.value = digitsOnly;

            if (!digitsOnly) {
                inputEl.setCustomValidity('');
                return;
            }

            const parsed = Number(digitsOnly);
            if (!Number.isInteger(parsed)) {
                inputEl.setCustomValidity(`Port must be ${PORT_MIN}-${PORT_MAX}.`);
                return;
            }

            if (strict) {
                const clamped = Math.min(PORT_MAX, Math.max(PORT_MIN, parsed));
                inputEl.value = String(clamped);
            }

            const current = Number(inputEl.value);
            if (!Number.isInteger(current) || current < PORT_MIN || current > PORT_MAX) {
                inputEl.setCustomValidity(`Port must be ${PORT_MIN}-${PORT_MAX}.`);
            } else {
                inputEl.setCustomValidity('');
            }
        };

        inputEl.addEventListener('input', () => sanitize(false));
        inputEl.addEventListener('blur', () => sanitize(true));
    }

    function renderTable() {
        if (!tableBody) return;

        if (!forwardRows.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="pf-empty-cell">
                        No port forwards yet. Use NEW FORWARD to create one.
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = forwardRows.map((forward) => {
            const host = getHostMeta(forward);
            const runtime = forward.runtime || { status: 'stopped', message: 'Stopped' };
            const status = runtime.status || 'stopped';
            const statusClass = ['active', 'starting', 'error'].includes(status) ? status : 'stopped';
            const showStart = status !== 'active';
            const tooltip = runtime.message ? escapeHtml(runtime.message) : '';
            const direction = normalizeDirection(forward.direction);

            const icon = host ? host.icon : 'fa-solid fa-server';
            const color = host ? host.color : '#45475a';
            const hostName = host ? host.name : 'Missing VDS';
            const hostSub = host ? `${host.username}@${host.address}` : 'Select a valid host';

            return `
                <tr title="${tooltip}">
                    <td>
                        <div class="pf-vds">
                            <div class="pf-vds-icon" style="background: ${escapeHtml(color)};">
                                <i class="${escapeHtml(icon)}"></i>
                            </div>
                            <div class="pf-vds-meta">
                                <div class="pf-vds-name">${escapeHtml(hostName)}</div>
                                <div class="pf-vds-sub">${escapeHtml(hostSub)}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="pf-endpoint">${escapeHtml(endpoint(forward.remoteHost, forward.remotePort))}</span></td>
                    <td><span class="pf-endpoint">${escapeHtml(endpoint(forward.localHost, forward.localPort))}</span></td>
                    <td>
                        <span class="pf-direction-tag ${direction}">
                            ${escapeHtml(directionLabel(direction))}
                        </span>
                    </td>
                    <td>
                        <span class="pf-status ${statusClass}">
                            <i class="fa-solid fa-circle" style="font-size: 8px;"></i>
                            ${statusLabel(status)}
                        </span>
                    </td>
                    <td style="text-align: right;">
                        <div class="pf-row-actions">
                            ${showStart ? `
                                <button class="pf-action-btn" data-action="start" data-id="${forward.id}">
                                    <i class="fa-solid fa-play"></i> Start
                                </button>
                            ` : ''}
                            <button class="pf-action-btn delete" data-action="delete" data-id="${forward.id}">
                                <i class="fa-solid fa-trash"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function loadData() {
        if (!api) {
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="pf-empty-cell" style="color: #f38ba8;">
                            Port forwarding API was not loaded.
                        </td>
                    </tr>
                `;
            }
            return;
        }

        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="pf-empty-cell">Loading...</td>
                </tr>
            `;
        }

        try {
            const [forwardsResult, hostsResult] = await Promise.all([
                api.getForwards(),
                window.electronAPI.hosts.getData()
            ]);

            forwardRows = Array.isArray(forwardsResult) ? forwardsResult : [];
            hosts = Array.isArray(hostsResult) ? hostsResult : [];

            renderTable();
        } catch (err) {
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="pf-empty-cell" style="color: #f38ba8;">
                            Failed to load forwards: ${escapeHtml(err.message)}
                        </td>
                    </tr>
                `;
            }
        }
    }

    function getVdsHosts() {
        return hosts.filter((host) => String(host.protocol || 'ssh').toUpperCase() === 'SSH');
    }

    function openCreateDrawer() {
        if (!drawerTemplate || !window.Drawer) return;

        Drawer.open('New Forward', drawerTemplate.innerHTML);

        setTimeout(() => {
            const vdsHosts = getVdsHosts();

            const hostTrigger = document.getElementById('pf-host-trigger');
            const hostTriggerText = document.getElementById('pf-host-trigger-text');
            const hostTriggerIcon = document.getElementById('pf-host-trigger-icon');
            const hostDropdown = document.getElementById('pf-host-dropdown');
            const hostList = document.getElementById('pf-host-list');
            const hostSearch = document.getElementById('pf-host-search');

            const remoteHostInput = document.getElementById('pf-remote-host');
            const remotePortInput = document.getElementById('pf-remote-port');
            const localHostInput = document.getElementById('pf-local-host');
            const localPortInput = document.getElementById('pf-local-port');
            const remoteSection = document.getElementById('pf-remote-section');
            const remoteSectionTitle = document.getElementById('pf-remote-section-title');
            const localSection = document.getElementById('pf-local-section');
            const localSectionTitle = document.getElementById('pf-local-section-title');
            const routeToggle = document.getElementById('pf-route-toggle');
            const routeLeftIcon = document.getElementById('pf-route-left-icon');
            const routeLeftTitle = document.getElementById('pf-route-left-title');
            const routeLeftSub = document.getElementById('pf-route-left-sub');
            const routeRightIcon = document.getElementById('pf-route-right-icon');
            const routeRightTitle = document.getElementById('pf-route-right-title');
            const routeRightSub = document.getElementById('pf-route-right-sub');
            const routeArrowIcon = document.getElementById('pf-route-arrow-icon');
            const addBtn = document.getElementById('pf-add-forward-btn');
            const errorEl = document.getElementById('pf-drawer-error');

            let selectedHost = null;
            let currentDirection = 'remote_to_local';

            function showError(message) {
                if (!errorEl) return;
                errorEl.textContent = message || '';
            }

            function buildVdsRouteMeta() {
                if (!selectedHost) {
                    return {
                        type: 'vds',
                        icon: 'fa-solid fa-server',
                        title: 'VDS',
                        sub: 'Remote machine',
                        color: null
                    };
                }

                return {
                    type: 'vds',
                    icon: selectedHost.icon || 'fa-solid fa-server',
                    title: selectedHost.name || selectedHost.address || 'VDS',
                    sub: `${selectedHost.username || 'root'}@${selectedHost.address || ''}`,
                    color: selectedHost.color || '#89b4fa'
                };
            }

            function setRouteEndpoint(iconEl, titleEl, subEl, meta) {
                if (!iconEl || !titleEl || !subEl || !meta) return;

                iconEl.classList.remove('pc', 'vds');
                iconEl.classList.add(meta.type === 'pc' ? 'pc' : 'vds');
                iconEl.innerHTML = `<i class="${escapeHtml(meta.icon)}"></i>`;
                iconEl.style.background = meta.type === 'vds' && meta.color ? meta.color : '';

                titleEl.textContent = meta.title;
                subEl.textContent = meta.sub;
            }

            function renderRouteUi() {
                const pcMeta = {
                    type: 'pc',
                    icon: 'fa-solid fa-laptop',
                    title: 'My PC',
                    sub: 'Local machine',
                    color: null
                };
                const vdsMeta = buildVdsRouteMeta();

                setRouteEndpoint(routeLeftIcon, routeLeftTitle, routeLeftSub, pcMeta);
                setRouteEndpoint(routeRightIcon, routeRightTitle, routeRightSub, vdsMeta);

                if (currentDirection === 'remote_to_local') {
                    if (routeArrowIcon) routeArrowIcon.className = 'fa-solid fa-arrow-right-long';

                    if (localSection) localSection.style.order = '1';
                    if (remoteSection) remoteSection.style.order = '2';
                    if (localSectionTitle) localSectionTitle.textContent = '1. My PC';
                    if (remoteSectionTitle) remoteSectionTitle.textContent = '2. VDS';
                } else {
                    if (routeArrowIcon) routeArrowIcon.className = 'fa-solid fa-arrow-left-long';

                    if (remoteSection) remoteSection.style.order = '1';
                    if (localSection) localSection.style.order = '2';
                    if (remoteSectionTitle) remoteSectionTitle.textContent = '1. VDS';
                    if (localSectionTitle) localSectionTitle.textContent = '2. My PC';
                }
            }

            function setDirection(nextDirection) {
                currentDirection = normalizeDirection(nextDirection);
                renderRouteUi();
            }

            function updateSelectedHostUi() {
                if (!hostTriggerText || !hostTriggerIcon) return;

                if (!selectedHost) {
                    hostTriggerText.textContent = 'Select a VDS';
                    hostTriggerIcon.innerHTML = '<i class="fa-solid fa-server"></i>';
                    hostTriggerIcon.style.background = '#45475a';
                    renderRouteUi();
                    return;
                }

                hostTriggerText.textContent = `${selectedHost.name || selectedHost.address} (${selectedHost.username || 'root'}@${selectedHost.address || ''})`;
                hostTriggerIcon.style.background = selectedHost.color || '#89b4fa';
                hostTriggerIcon.innerHTML = `<i class="${escapeHtml(selectedHost.icon || 'fa-solid fa-server')}"></i>`;
                renderRouteUi();
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
                        <div class="pf-empty-cell" style="padding: 10px;">
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
                        <div class="pf-host-item" data-host-id="${host.id}">
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

            function closeHostDropdown() {
                if (hostDropdown) hostDropdown.classList.remove('show');
            }

            renderHostList('');
            updateSelectedHostUi();
            setDirection('remote_to_local');
            bindPortInputValidation(remotePortInput);
            bindPortInputValidation(localPortInput);

            if (routeToggle) {
                routeToggle.addEventListener('click', () => {
                    setDirection(currentDirection === 'remote_to_local' ? 'local_to_remote' : 'remote_to_local');
                });
            }

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
                    showError('');
                });
            }

            if (window.__pfDrawerOutsideClick) {
                document.removeEventListener('click', window.__pfDrawerOutsideClick);
            }
            window.__pfDrawerOutsideClick = (event) => {
                if (!hostDropdown || !hostTrigger) return;
                if (hostDropdown.contains(event.target) || hostTrigger.contains(event.target)) return;
                closeHostDropdown();
            };
            document.addEventListener('click', window.__pfDrawerOutsideClick);

            if (addBtn) {
                addBtn.addEventListener('click', async () => {
                    showError('');

                    const payload = {
                        hostId: selectedHost ? selectedHost.id : null,
                        direction: currentDirection,
                        remoteHost: remoteHostInput ? remoteHostInput.value : '0.0.0.0',
                        remotePort: remotePortInput ? remotePortInput.value : '',
                        localHost: localHostInput ? localHostInput.value : '127.0.0.1',
                        localPort: localPortInput ? localPortInput.value : ''
                    };

                    if (!payload.hostId) {
                        showError('Please select a VDS first.');
                        return;
                    }

                    if (!payload.remotePort || !payload.localPort) {
                        showError('Please fill both remote and local ports.');
                        return;
                    }

                    const remotePort = parsePortValue(payload.remotePort);
                    const localPort = parsePortValue(payload.localPort);

                    if (!remotePort || !localPort) {
                        showError(`Ports must be between ${PORT_MIN} and ${PORT_MAX}.`);
                        return;
                    }

                    addBtn.disabled = true;

                    try {
                        const saveResult = await api.saveForward(payload);
                        if (!saveResult || saveResult.success === false) {
                            showError(saveResult && saveResult.message ? saveResult.message : 'Failed to save forward.');
                            return;
                        }

                        const startResult = await api.startForward(saveResult.forward.id);
                        if (!startResult || startResult.success === false) {
                            showError(`Saved but not started: ${startResult && startResult.message ? startResult.message : 'Unknown error'}`);
                            return;
                        }

                        Drawer.close();
                        await loadData();
                    } catch (err) {
                        showError(err && err.message ? err.message : String(err));
                    } finally {
                        addBtn.disabled = false;
                    }
                });
            }
        }, 50);
    }

    if (btnNewForward) {
        btnNewForward.addEventListener('click', () => {
            openCreateDrawer();
        });
    }

    if (btnRefreshForwards) {
        btnRefreshForwards.addEventListener('click', () => {
            loadData();
        });
    }

    if (tableBody) {
        tableBody.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('button[data-action]');
            if (!actionButton) return;

            const action = actionButton.dataset.action;
            const id = actionButton.dataset.id;
            if (!action || !id) return;

            actionButton.disabled = true;

            try {
                let result = null;

                if (action === 'start') {
                    result = await api.startForward(id);
                } else if (action === 'delete') {
                    result = await api.deleteForward(id);
                }

                if (result && result.success === false) {
                    window.notifyUser(result.message || 'Action failed.', 'error');
                }

                await loadData();
            } catch (err) {
                window.notifyUser(err && err.message ? err.message : String(err), 'error');
            } finally {
                actionButton.disabled = false;
            }
        });
    }

    loadData();
})();
