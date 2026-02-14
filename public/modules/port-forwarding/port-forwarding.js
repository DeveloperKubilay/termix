(function() {
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

    function renderTable() {
        if (!tableBody) return;

        if (!forwardRows.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="pf-empty-cell">
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
                        <td colspan="5" class="pf-empty-cell" style="color: #f38ba8;">
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
                    <td colspan="5" class="pf-empty-cell">Loading...</td>
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
                        <td colspan="5" class="pf-empty-cell" style="color: #f38ba8;">
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
            const addBtn = document.getElementById('pf-add-forward-btn');
            const errorEl = document.getElementById('pf-drawer-error');

            let selectedHost = null;

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
                        remoteHost: remoteHostInput ? remoteHostInput.value : '127.0.0.1',
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
                    alert(result.message || 'Action failed.');
                }

                await loadData();
            } catch (err) {
                alert(err && err.message ? err.message : String(err));
            } finally {
                actionButton.disabled = false;
            }
        });
    }

    loadData();
})();
