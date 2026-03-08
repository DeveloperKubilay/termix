(function() {
    const hostsGrid = document.getElementById('hosts-grid');
    const btnNewHost = document.getElementById('btn-new-host');
    const btnTags = document.getElementById('btn-tags');
    const tagsPopup = document.getElementById('tags-popup');
    const searchInput = document.querySelector('.search-bar input');
    const btnTopConnect = document.querySelector('.top-bar .btn-connect');

    // Select buttons by icon
    const terminalIcon = document.querySelector('button i.fa-terminal');
    const serialIcon = document.querySelector('button i.fa-microchip');
    const btnTerminal = terminalIcon ? terminalIcon.closest('button') : null;
    const btnSerial = serialIcon ? serialIcon.closest('button') : null;

    if (!hostsGrid || !btnNewHost || !btnTags || !tagsPopup) {
        console.error('Hosts module failed to initialize due to missing DOM nodes.');
        return;
    }
    
    // Create Serial Popup
    const serialPopup = document.createElement('div');
    serialPopup.className = 'tags-popup'; // Reuse tags popup style
    serialPopup.id = 'serial-popup';
    serialPopup.innerHTML = `
        <div class="search-tags">
            <i class="fa-solid fa-sync"></i> <!-- Refresh icon -->
            <input type="text" placeholder="Scanning ports..." disabled>
        </div>
        <div class="tags-list" style="max-height: 200px; overflow-y: auto;">
        </div>
    `;
    // Append to the parent container of buttons to position it correctly relative to btnSerial
    if(btnSerial && btnSerial.parentElement) {
        btnSerial.parentElement.style.position = 'relative'; // Ensure parent is relative
        btnSerial.parentElement.appendChild(serialPopup);
        
        // Adjust position logic in CSS or here
        // Usually tags-popup is absolute. Let's position it under the Serial button manually via JS on click or assume CSS handles generic .tags-popup
        serialPopup.style.left = 'auto'; // Reset
        // We will calculate position on click
    }

    const tagsListContainer = tagsPopup.querySelector('.tags-list');
    const tagsFooter = tagsPopup.querySelector('.tags-footer');
    
    // Tag Search Logic
    const tagsSearchInput = tagsPopup.querySelector('.search-tags input');
    if (tagsSearchInput) {
        tagsSearchInput.addEventListener('input', (e) => {
            const filter = e.target.value.toLowerCase();
            const tagItems = tagsListContainer.querySelectorAll('.tag-item');
            tagItems.forEach(item => {
                const text = item.textContent.trim().toLowerCase();
                if (text.includes(filter)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    let allHosts = [];
    let selectedTags = new Set();
    const SSH_PORT_MIN = 1;
    const SSH_PORT_MAX = 65535;
    const DEFAULT_SSH_PORT = 22;

    function parseSshPort(value) {
        const text = String(value == null ? '' : value).trim();
        if (!text) return null;

        const parsed = Number(text);
        if (!Number.isInteger(parsed)) return null;
        if (parsed < SSH_PORT_MIN || parsed > SSH_PORT_MAX) return null;
        return parsed;
    }

    function bindSshPortInputValidation(inputEl) {
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
                inputEl.setCustomValidity(`Port must be ${SSH_PORT_MIN}-${SSH_PORT_MAX}.`);
                return;
            }

            if (strict) {
                const clamped = Math.min(SSH_PORT_MAX, Math.max(SSH_PORT_MIN, parsed));
                inputEl.value = String(clamped);
            }

            const current = Number(inputEl.value);
            if (!Number.isInteger(current) || current < SSH_PORT_MIN || current > SSH_PORT_MAX) {
                inputEl.setCustomValidity(`Port must be ${SSH_PORT_MIN}-${SSH_PORT_MAX}.`);
                return;
            }

            inputEl.setCustomValidity('');
        };

        inputEl.addEventListener('input', () => sanitize(false));
        inputEl.addEventListener('blur', () => sanitize(true));
    }

    function parseSSHCommand(cmd) {
        const trimmed = cmd.trim();
        if (!trimmed.startsWith('ssh ')) return null;
        
        // Remove 'ssh' and parse args
        let args = trimmed.slice(4).trim();
        let port = DEFAULT_SSH_PORT;
        
        // Find port (-p 1234 or -p1234)
        const portMatch = args.match(/(?:^|\s)-p\s*(\S+)/);
        if (portMatch) {
            const parsedPort = parseSshPort(portMatch[1]);
            if (!parsedPort) return null;
            port = parsedPort;
            // Remove port flag from string to isolate user@host
            args = args.replace(portMatch[0], ' ').trim();
        }

        // Get the destination part (should be what's left, taking first token)
        // Handles cases where there might be other flags ignored or trailing spaces
        const parts = args.split(/\s+/);
        const destination = parts.find(p => p && !p.startsWith('-'));
        
        if (!destination) return null;

        let username = 'root';
        let hostname = destination;

        if (destination.includes('@')) {
            const destParts = destination.split('@');
            username = destParts[0];
            hostname = destParts[1];
        }

        return {
            port: String(port),
            username: username,
            hostname: hostname
        };
    }

    function openSSHPasswordDrawer(sshInfo) {
        const template = document.getElementById('ssh-password-template');
        if (!template) return;

        Drawer.open('SSH Connection', template.innerHTML);

        setTimeout(() => {
            const infoDiv = document.getElementById('ssh-connection-info');
            const passwordInput = document.getElementById('ssh-password-input');
            const togglePasswordBtn = document.querySelector('.toggle-password');
            const btnSaveExit = document.getElementById('btn-save-exit');
            const btnConnect = document.getElementById('btn-connect-now');

            if (infoDiv) {
                infoDiv.textContent = `ssh -p ${sshInfo.port} ${sshInfo.username}@${sshInfo.hostname}`;
            }

            if (togglePasswordBtn && passwordInput) {
                togglePasswordBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                    passwordInput.setAttribute('type', type);
                    togglePasswordBtn.classList.toggle('fa-eye');
                    togglePasswordBtn.classList.toggle('fa-eye-slash');
                });
            }

            if (passwordInput) {
                passwordInput.focus();
                passwordInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && btnConnect) {
                        btnConnect.click();
                    }
                });
            }

            async function connectToHost(shouldConnect = true) {
                const password = passwordInput ? passwordInput.value : '';
                
                if (!password) {
                    if (passwordInput) passwordInput.style.border = '1px solid #f38ba8';
                    return;
                }

                const hostData = {
                    id: Date.now(),
                    name: `${sshInfo.username}@${sshInfo.hostname}`,
                    icon: 'fa-brands fa-linux',
                    color: '#89b4fa',
                    protocol: 'ssh',
                    username: sshInfo.username,
                    password: password,
                    address: sshInfo.hostname,
                    port: sshInfo.port,
                    tags: [],
                    certPath: ''
                };

                // Always save
                try {
                    const currentHosts = await window.electronAPI.hosts.getData() || [];
                    currentHosts.push(hostData);
                    await window.electronAPI.hosts.setData(currentHosts);
                    allHosts = currentHosts;
                    filterHosts();
                } catch (error) {
                    console.error('Error saving host:', error);
                }

                if (Drawer && Drawer.close) Drawer.close();

                if (shouldConnect) {
                    if (!window.ConnectionModule) {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = 'public/modules/connection/connection.js';
                            script.onload = resolve;
                            script.onerror = reject;
                            document.head.appendChild(script);
                        });
                    }

                    const tabId = 'connection-' + Date.now();
                    window.TabManager.addTab({
                        id: tabId,
                        title: hostData.name,
                        icon: hostData.icon,
                        contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
                    });

                    setTimeout(async () => {
                        if (window.ConnectionModule) {
                            const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, hostData);
                            const tab = window.TabManager.tabs.find(t => t.id === tabId);
                            if(tab) tab.sessionObj = sessionObj;
                        }
                    }, 50);
                }

                if (searchInput) searchInput.value = '';
            }

            if (btnSaveExit) {
                btnSaveExit.addEventListener('click', () => connectToHost(false));
            }

            if (btnConnect) {
                btnConnect.addEventListener('click', () => connectToHost(true));
            }
        }, 100);
    }

    if (btnTopConnect && searchInput) {
        btnTopConnect.addEventListener('click', () => {
            const cmd = searchInput.value.trim();
            const sshInfo = parseSSHCommand(cmd);
            if (sshInfo) {
                openSSHPasswordDrawer(sshInfo);
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const cmd = searchInput.value.trim();
                const sshInfo = parseSSHCommand(cmd);
                if (sshInfo) {
                    openSSHPasswordDrawer(sshInfo);
                }
            }
        });
    }

    if (tagsFooter) {
        tagsFooter.addEventListener('click', () => {
            selectedTags.clear();
            const checkboxes = tagsListContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            filterHosts();
        });
    }

    Promise.all([
        window.electronAPI.hosts.getData(),
        window.electronAPI.hosts.getTags()
    ]).then(([hostsData, tagsData]) => {
        allHosts = hostsData || [];
        renderHosts(allHosts);
        renderTagsFilter(tagsData || []);
    }).catch(error => console.error('Error loading data:', error));

    function renderTagsFilter(tags) {
        if (!tagsListContainer) return;
        tagsListContainer.innerHTML = '';
        tags.forEach(tag => {
            const label = document.createElement('label');
            label.className = 'tag-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = tag;

            const span = document.createElement('span');
            span.textContent = tag;

            label.appendChild(checkbox);
            label.appendChild(span);

            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedTags.add(tag);
                } else {
                    selectedTags.delete(tag);
                }
                filterHosts();
            });

            tagsListContainer.appendChild(label);
        });
    }

    function filterHosts() {
        if (selectedTags.size === 0) {
            renderHosts(allHosts);
            return;
        }

        const filteredHosts = allHosts.filter(host => {
            if (!host.tags || !Array.isArray(host.tags)) return false;
            // AND logic: Host must have ALL selected tags
            for (const tag of selectedTags) {
                if (!host.tags.includes(tag)) return false;
            }
            return true;
        });
        renderHosts(filteredHosts);
    }

    function renderHosts(hosts) {
        hostsGrid.innerHTML = '';

        if (!hosts || hosts.length === 0) {
            hostsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; color: #a6adc8;">
                    <i class="fa-solid fa-network-wired" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
                    <h3 style="margin: 0 0 10px 0;">No hosts found</h3>
                    <p style="margin: 0;">Would you like to add a new host?</p>
                </div>
            `;
            return;
        }

        hosts.forEach(host => {
            const card = document.createElement('div');
            card.className = 'host-card';
            card.style.position = 'relative';

            const hostIcon = host && host.icon ? host.icon : 'fa-brands fa-linux';
            const hostColor = host && host.color ? host.color : '#d6336c';
            
            let detailsText = `${host.protocol}, ${host.username}`;
            if (host.tags && host.tags.length > 0) {
                detailsText += `, ${host.tags.join(', ')}`;
            }

            // Build card content using DOM APIs to avoid interpreting user data as HTML
            const hostIconDiv = document.createElement('div');
            hostIconDiv.className = 'host-icon';
            hostIconDiv.style.backgroundColor = hostColor;

            const iconElement = document.createElement('i');
            if (typeof hostIcon === 'string') {
                hostIcon.split(/\s+/).forEach(cls => {
                    if (cls) {
                        iconElement.classList.add(cls);
                    }
                });
            }
            hostIconDiv.appendChild(iconElement);

            const hostInfoDiv = document.createElement('div');
            hostInfoDiv.className = 'host-info';

            const hostNameDiv = document.createElement('div');
            hostNameDiv.className = 'host-name';
            hostNameDiv.textContent = host.name;

            const hostDetailsDiv = document.createElement('div');
            hostDetailsDiv.className = 'host-details';
            hostDetailsDiv.textContent = detailsText;

            hostInfoDiv.appendChild(hostNameDiv);
            hostInfoDiv.appendChild(hostDetailsDiv);

            const hostActionsDiv = document.createElement('div');
            hostActionsDiv.className = 'host-actions';
            hostActionsDiv.style.position = 'absolute';
            hostActionsDiv.style.right = '10px';
            hostActionsDiv.style.top = '50%';
            hostActionsDiv.style.transform = 'translateY(-50%)';
            hostActionsDiv.style.display = 'none';

            const editButton = document.createElement('button');
            editButton.className = 'btn-icon-only edit-host-btn';
            editButton.type = 'button';
            editButton.setAttribute('aria-label', 'Edit host');
            editButton.title = 'Edit host';
            editButton.style.background = '#313244';
            editButton.style.border = '1px solid #45475a';
            editButton.style.color = '#a6adc8';
            editButton.style.cursor = 'pointer';
            editButton.style.padding = '10px';
            editButton.style.borderRadius = '6px';
            editButton.style.transition = 'all 0.2s';

            const editIcon = document.createElement('i');
            editIcon.classList.add('fa-solid', 'fa-pen');
            editButton.appendChild(editIcon);

            hostActionsDiv.appendChild(editButton);

            card.appendChild(hostIconDiv);
            card.appendChild(hostInfoDiv);
            card.appendChild(hostActionsDiv);
            
            card.addEventListener('mouseenter', () => {
                const actions = card.querySelector('.host-actions');
                if (actions) actions.style.display = 'block';
            });

            card.addEventListener('mouseleave', () => {
                const actions = card.querySelector('.host-actions');
                if (actions) actions.style.display = 'none';
            });

            const editBtn = card.querySelector('.edit-host-btn');
            if (editBtn) {
                editBtn.addEventListener('mouseover', () => {
                    // editBtn.style.background = '#2d4f35'; // Reverted background change
                    editBtn.style.color = '#a6e3a1';
                });
                editBtn.addEventListener('mouseout', () => {
                    // editBtn.style.background = '#313244'; // Reverted background change
                    editBtn.style.color = '#a6adc8';
                });
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openHostDrawer(host);
                });
            }

            card.addEventListener('click', async () => {
                // Ensure ConnectionModule is loaded
                if (!window.ConnectionModule) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'public/modules/connection/connection.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                const tabId = 'connection-' + Date.now();
                window.TabManager.addTab({
                    id: tabId,
                    title: host.name,
                    icon: hostIcon,
                    contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
                });

                // Initialize terminal
                setTimeout(async () => {
                    if (window.ConnectionModule) {
                        const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, host);
                        const tab = window.TabManager.tabs.find(t => t.id === tabId);
                        if(tab) tab.sessionObj = sessionObj;
                    }
                }, 50);
            });
            
            hostsGrid.appendChild(card);
        });
    }

    async function openHostDrawer(hostToEdit = null) {
        const template = document.getElementById('host-details-template');
        if (!template) return;

        const title = hostToEdit ? 'Edit Host' : 'New Host';
        Drawer.open(title, template.innerHTML);
        
        const tags = await window.electronAPI.hosts.getTags() || [];
        const keys = await window.electronAPI.keychain.getKeyFiles() || [];

        setTimeout(() => {
            const addressInput = document.querySelector('input[placeholder="IP Address or Hostname"]');
            const labelInput = document.querySelector('input[placeholder="Label"]');
            const usernameInput = document.querySelector('input[placeholder="Username"]');
            const passwordInput = document.querySelector('input[placeholder="Password"]');
            const togglePasswordBtn = document.querySelector('.toggle-password');

            const osIconBox = document.querySelector('.host-os-icon');
            const osPickerPanel = document.querySelector('.os-picker-panel');

            const osOptions = [
                { key: 'linux', label: 'Linux', icon: 'fa-brands fa-linux', color: '#d6336c' },
                { key: 'ubuntu', label: 'Ubuntu', icon: 'fa-brands fa-ubuntu', color: '#fab387' },
                { key: 'debian', label: 'Debian', icon: 'fa-brands fa-linux', color: '#89b4fa' },
                { key: 'arch', label: 'Arch Linux', icon: 'fa-brands fa-linux', color: '#1793d1' }
            ];

            let selectedOs = osOptions[0];

            function applySelectedOs() {
                if (!osIconBox) return;
                osIconBox.style.backgroundColor = selectedOs.color;
                const iconEl = osIconBox.querySelector('i');
                if (iconEl) iconEl.className = selectedOs.icon;
            }

            function closeOsPicker() {
                if (osPickerPanel) osPickerPanel.classList.remove('show');
            }

            function renderOsPicker() {
                if (!osPickerPanel) return;
                osPickerPanel.innerHTML = '';

                osOptions.forEach(opt => {
                    const item = document.createElement('div');
                    item.className = 'os-picker-item';
                    item.innerHTML = `
                        <div class="os-picker-swatch" style="background: ${opt.color}"><i class="${opt.icon}"></i></div>
                        <div>${opt.label}</div>
                    `;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectedOs = opt;
                        applySelectedOs();
                        closeOsPicker();
                    });
                    osPickerPanel.appendChild(item);
                });
            }

            if (osIconBox && osPickerPanel) {
                renderOsPicker();

                const existingIcon = hostToEdit && hostToEdit.icon ? hostToEdit.icon : null;
                const fromIcon = existingIcon ? osOptions.find(o => o.icon === existingIcon) : null;
                selectedOs = fromIcon || osOptions[0];
                if (hostToEdit && hostToEdit.color) {
                    selectedOs = { ...selectedOs, color: hostToEdit.color };
                }
                applySelectedOs();

                osIconBox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    osPickerPanel.classList.toggle('show');
                });

                if (window.__hostsOsPickerDocClick) {
                    document.removeEventListener('click', window.__hostsOsPickerDocClick);
                }
                window.__hostsOsPickerDocClick = (e) => {
                    if (!osPickerPanel.contains(e.target) && !osIconBox.contains(e.target)) {
                        closeOsPicker();
                    }
                };
                document.addEventListener('click', window.__hostsOsPickerDocClick);
            }

            if (togglePasswordBtn && passwordInput) {
                togglePasswordBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                    passwordInput.setAttribute('type', type);
                    togglePasswordBtn.classList.toggle('fa-eye');
                    togglePasswordBtn.classList.toggle('fa-eye-slash');
                });
            }

            const certInput = document.querySelector('input[placeholder="Certificate, FIDO2"]');
            const tagsInput = document.querySelector('input[placeholder="Tags"]');
            const portInput = document.getElementById('host-port');
            const btnConnect = document.querySelector('.btn-connect-large');

            if (portInput) {
                portInput.min = String(SSH_PORT_MIN);
                portInput.max = String(SSH_PORT_MAX);
                portInput.step = '1';
                bindSshPortInputValidation(portInput);
            }

            // Removed manual binding of drawer-check since it's handled globally in app.js

            // Populate fields if editing
            if (hostToEdit) {
                if (addressInput) addressInput.value = hostToEdit.address || '';
                if (labelInput) labelInput.value = hostToEdit.name || '';
                if (usernameInput) usernameInput.value = hostToEdit.username || '';
                if (tagsInput && hostToEdit.tags) tagsInput.value = hostToEdit.tags.join(', ');
                if (portInput) portInput.value = String(parseSshPort(hostToEdit.port) || DEFAULT_SSH_PORT);
                if (passwordInput) passwordInput.value = hostToEdit.password || '';
                if (certInput) {
                    if (hostToEdit.certPath) {
                        const matchingKey = keys.find(k => k.path === hostToEdit.certPath);
                        certInput.value = matchingKey ? matchingKey.name : hostToEdit.certPath;
                        certInput.dataset.fullPath = hostToEdit.certPath;
                    } else {
                        certInput.value = '';
                    }
                }
                
                if (btnConnect) btnConnect.textContent = 'Save Changes';

                // Add Delete Button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Host';
                deleteBtn.style.cssText = `
                    width: 100%;
                    padding: 12px;
                    background: #e64553;
                    color: #1e1e2e;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: bold;
                    margin-top: 10px;
                    transition: all 0.2s;
                `;
                
                deleteBtn.addEventListener('mouseover', () => {
                    deleteBtn.style.background = '#d20f39';
                });
                deleteBtn.addEventListener('mouseout', () => {
                    deleteBtn.style.background = '#e64553';
                });

                deleteBtn.addEventListener('click', async () => {
                    try {
                        const currentHosts = await window.electronAPI.hosts.getData() || [];
                        const updatedHosts = currentHosts.filter(h => h.id !== hostToEdit.id);
                        await window.electronAPI.hosts.setData(updatedHosts);
                        
                        allHosts = updatedHosts;
                        filterHosts();
                        
                        if (Drawer && Drawer.close) Drawer.close();
                    } catch (error) {
                        console.error('Error deleting host:', error);
                        window.notifyUser('Failed to delete host', 'error');
                    }
                });

                if (btnConnect && btnConnect.parentNode) {
                    btnConnect.parentNode.insertBefore(deleteBtn, btnConnect.nextSibling);
                }
            }

            if (tagsInput) {
                const container = tagsInput.parentElement;
                container.style.position = 'relative';

                const dropdown = document.createElement('div');
                dropdown.className = 'tags-dropdown';
                dropdown.style.cssText = `
                    position: absolute;
                    top: calc(100% + 5px);
                    left: 0;
                    width: 100%;
                    background: #1e1e2e;
                    border: 1px solid #313244;
                    border-radius: 6px;
                    max-height: 200px;
                    overflow-y: auto;
                    z-index: 10000;
                    display: none;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                `;

                function renderDropdown(filter = '') {
                    dropdown.innerHTML = '';
                    const filtered = tags.filter(t => t.toLowerCase().includes(filter.toLowerCase()));
                    
                    if (filtered.length === 0 && filter) {
                        const item = document.createElement('div');
                        item.textContent = 'Create "' + filter + '"';
                        item.style.cssText = 'padding: 10px 12px; color: #89b4fa; cursor: pointer; font-size: 14px; display: flex; align-items: center; transition: background 0.2s;';
                        item.addEventListener('click', () => {
                            tagsInput.value = filter;
                            dropdown.style.display = 'none';
                        });
                        item.addEventListener('mouseover', () => item.style.background = '#313244');
                        item.addEventListener('mouseout', () => item.style.background = 'transparent');
                        dropdown.appendChild(item);
                    } else {
                        filtered.forEach(tag => {
                            const item = document.createElement('div');
                            item.textContent = tag;
                            item.style.cssText = 'padding: 10px 12px; color: #cdd6f4; cursor: pointer; font-size: 14px; border-bottom: 1px solid #313244; transition: background 0.2s;';
                            if (tag === filtered[filtered.length - 1]) item.style.borderBottom = 'none';
                            
                            item.addEventListener('click', () => {
                                tagsInput.value = tag;
                                dropdown.style.display = 'none';
                            });
                            item.addEventListener('mouseover', () => item.style.background = '#313244');
                            item.addEventListener('mouseout', () => item.style.background = 'transparent');
                            dropdown.appendChild(item);
                        });
                    }
                    
                    if (dropdown.children.length > 0) {
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.style.display = 'none';
                    }
                }

                tagsInput.addEventListener('focus', () => renderDropdown(tagsInput.value));
                tagsInput.addEventListener('input', () => renderDropdown(tagsInput.value));
                
                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });

                container.appendChild(dropdown);
            }

            if (certInput) {
                const container = certInput.parentElement;
                container.style.position = 'relative';
                
                const dropdown = document.createElement('div');
                dropdown.className = 'cert-dropdown';
                dropdown.style.cssText = `
                    position: absolute;
                    top: calc(100% + 5px);
                    left: 0;
                    width: 100%;
                    background: #1e1e2e;
                    border: 1px solid #313244;
                    border-radius: 6px;
                    max-height: 200px;
                    overflow-y: auto;
                    z-index: 10000;
                    display: none;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                `;

                function renderCertDropdown(filter = '') {
                    dropdown.innerHTML = '';
                    
                    const filtered = keys.filter(k => k.name.toLowerCase().includes(filter.toLowerCase()));

                    if (filtered.length === 0) {
                        if (filter) {
                            const item = document.createElement('div');
                            item.textContent = "No matching keys found";
                            item.style.cssText = 'padding: 10px 12px; color: #a6adc8; font-size: 14px; font-style: italic;';
                            dropdown.appendChild(item);
                        } else {
                            // Show all if no filter but keys exist (handled by filtered logic above actually)
                            // If keys is empty initially
                            if (keys.length === 0) {
                                const item = document.createElement('div');
                                item.textContent = "No keys found in Keychain";
                                item.style.cssText = 'padding: 10px 12px; color: #a6adc8; font-size: 14px; font-style: italic;';
                                dropdown.appendChild(item);
                            }
                        }
                    } else {
                        filtered.forEach(key => {
                            const item = document.createElement('div');
                            item.textContent = key.name;
                            item.title = key.path;
                            item.style.cssText = 'padding: 10px 12px; color: #cdd6f4; cursor: pointer; font-size: 14px; border-bottom: 1px solid #313244; transition: background 0.2s;';
                            
                            item.addEventListener('click', () => {
                                certInput.value = key.name;
                                certInput.dataset.fullPath = key.path;
                                dropdown.style.display = 'none';
                            });
                            item.addEventListener('mouseover', () => item.style.background = '#313244');
                            item.addEventListener('mouseout', () => item.style.background = 'transparent');
                            dropdown.appendChild(item);
                        });
                    }
                    
                    if (dropdown.children.length > 0) {
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.style.display = 'none';
                    }
                }

                certInput.addEventListener('focus', () => renderCertDropdown(certInput.value));
                certInput.addEventListener('input', () => renderCertDropdown(certInput.value));
                
                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });

                container.appendChild(dropdown);
            }

            if (btnConnect) {
                btnConnect.addEventListener('click', async () => {
                    // Reset styles
                    if (addressInput) addressInput.style.border = '';
                    if (passwordInput) passwordInput.style.border = '';
                    if (certInput) certInput.style.border = '';
                    if (portInput) {
                        portInput.style.border = '';
                        portInput.setCustomValidity('');
                    }

                    let isValid = true;
                    let normalizedPort = DEFAULT_SSH_PORT;

                    // IP/Hostname Validation
                    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
                    
                    if (!addressInput || !addressInput.value || !ipRegex.test(addressInput.value)) {
                        if (addressInput) addressInput.style.border = '1px solid #f38ba8';
                        isValid = false;
                    }

                    const hasPassword = passwordInput && passwordInput.value;
                    const hasCert = certInput && certInput.value;

                    if (!hasPassword && !hasCert) {
                        if (passwordInput) passwordInput.style.border = '1px solid #f38ba8';
                        if (certInput) certInput.style.border = '1px solid #f38ba8';
                        isValid = false;
                    }

                    if (portInput) {
                        const parsedPort = parseSshPort(portInput.value);
                        if (!parsedPort) {
                            portInput.style.border = '1px solid #f38ba8';
                            portInput.setCustomValidity(`Port must be between ${SSH_PORT_MIN} and ${SSH_PORT_MAX}.`);
                            portInput.reportValidity();
                            isValid = false;
                        } else {
                            normalizedPort = parsedPort;
                            portInput.value = String(parsedPort);
                            portInput.setCustomValidity('');
                        }
                    }

                    if (!isValid) return;

                    const tagInputVal = tagsInput ? tagsInput.value.trim() : '';
                    // Split by comma and filter empty
                    const tagList = tagInputVal 
                        ? tagInputVal.split(',').map(t => t.trim()).filter(t => t.length > 0)
                        : [];
                    
                    // Add new tags if they don't exist
                    let tagsUpdated = false;
                    for (const t of tagList) {
                        if (!tags.includes(t)) {
                            await window.electronAPI.hosts.addTag(t);
                            tags.push(t); // Update local cache to prevent duplicate add requests
                            tagsUpdated = true;
                        }
                    }

                    if (tagsUpdated) {
                        // Refresh tags filter
                        const newTags = await window.electronAPI.hosts.getTags();
                        renderTagsFilter(newTags);
                    }

                    const hostData = {
                        id: hostToEdit ? hostToEdit.id : Date.now(),
                        name: labelInput.value || addressInput.value,
                        icon: selectedOs.icon,
                        color: selectedOs.color,
                        protocol: "ssh",
                        username: usernameInput.value || "root",
                        password: passwordInput ? passwordInput.value : "",
                        address: addressInput.value,
                        port: String(normalizedPort),
                        tags: tagList,
                        certPath: certInput ? (certInput.dataset.fullPath || certInput.value) : '',
                        ...(hostToEdit && Number.isFinite(Number(hostToEdit.terminalFontSize))
                            ? { terminalFontSize: Number(hostToEdit.terminalFontSize) }
                            : {})
                    };

                    try {
                        const currentHosts = await window.electronAPI.hosts.getData() || [];
                        
                        if (hostToEdit) {
                            const index = currentHosts.findIndex(h => h.id === hostToEdit.id);
                            if (index !== -1) {
                                currentHosts[index] = hostData;
                            }
                        } else {
                            currentHosts.push(hostData);
                        }
                        
                        await window.electronAPI.hosts.setData(currentHosts);
                        
                        // Update local data and re-render
                        allHosts = currentHosts;
                        filterHosts(); // Re-apply filters if any
                        
                        if (Drawer && Drawer.close) Drawer.close();

                        // Auto-connect only if NOT editing
                        if (!hostToEdit) {
                            if (!window.ConnectionModule) {
                                await new Promise((resolve, reject) => {
                                    const script = document.createElement('script');
                                    script.src = 'public/modules/connection/connection.js';
                                    script.onload = resolve;
                                    script.onerror = reject;
                                    document.head.appendChild(script);
                                });
                            }

                            const tabId = 'connection-' + Date.now();
                            window.TabManager.addTab({
                                id: tabId,
                                title: hostData.name,
                                icon: hostData.icon,
                                contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
                            });

                            setTimeout(async () => {
                                if (window.ConnectionModule) {
                                    const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, hostData);
                                    const tab = window.TabManager.tabs.find(t => t.id === tabId);
                                    if(tab) tab.sessionObj = sessionObj;
                                }
                            }, 50);
                        }
                    } catch (error) {
                        console.error('Error saving host:', error);
                        window.notifyUser('Failed to save host', 'error');
                    }
                });
            }
        }, 100);
    }

    btnNewHost.addEventListener('click', () => openHostDrawer());

    // --- Terminal Button Listener ---
    if (btnTerminal) {
        btnTerminal.addEventListener('click', async () => {
             // Ensure ConnectionModule is loaded
             if (!window.ConnectionModule) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'public/modules/connection/connection.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            const tabId = 'local-' + Date.now();
            window.TabManager.addTab({
                id: tabId,
                title: 'Local Terminal',
                icon: 'fa-solid fa-terminal',
                contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
            });

            setTimeout(async () => {
                const hostInfo = {
                    protocol: 'LOCAL',
                    name: 'Local Terminal',
                    username: 'user', // dummy
                    hostname: 'localhost'
                };
                if (window.ConnectionModule) {
                    const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, hostInfo);
                    const tab = window.TabManager.tabs.find(t => t.id === tabId);
                    if(tab) tab.sessionObj = sessionObj;
                }
            }, 50);
        });
    }

    // --- Serial Button Listener ---
    if (btnSerial) {
        btnSerial.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            // Toggle visibility
            const isVisible = serialPopup.classList.contains('show');
            
            // Close other popups
            tagsPopup.classList.remove('show');
            
            if (isVisible) {
                serialPopup.classList.remove('show');
                return;
            }

            // Position popup under the button
            const rect = btnSerial.getBoundingClientRect();
            const parentRect = btnSerial.parentElement.getBoundingClientRect();
            serialPopup.style.left = (rect.left - parentRect.left) + 'px';
            serialPopup.style.top = (rect.bottom - parentRect.top + 5) + 'px'; // +5px margin
            
            serialPopup.classList.add('show');

            // Load Ports
            const listContainer = serialPopup.querySelector('.tags-list');
            const input = serialPopup.querySelector('input');
            const refreshIcon = serialPopup.querySelector('.fa-sync');
            
            async function scanPorts() {
                listContainer.innerHTML = '<div style="padding: 10px; color: #a6adc8;">Scanning...</div>';
                input.value = "Scanning ports...";
                refreshIcon.classList.add('fa-spin');

                try {
                    const ports = await window.electronAPI.hosts.getSerialPorts() || [];
                    
                    listContainer.innerHTML = '';
                    input.value = `${ports.length} ports found`;
                    refreshIcon.classList.remove('fa-spin');

                    if (ports.length === 0) {
                        listContainer.innerHTML = '<div style="padding: 10px; color: #f38ba8;">No serial ports found</div>';
                    }

                    ports.forEach(port => {
                        const item = document.createElement('div');
                        item.className = 'tag-item';
                        item.style.cursor = 'pointer';
                        item.style.display = 'flex';
                        item.style.flexDirection = 'column';
                        item.style.alignItems = 'flex-start';
                        item.style.padding = '8px 12px';
                        
                        item.innerHTML = `
                            <span style="font-weight: bold; color: #cdd6f4;">${port.path}</span>
                            <span style="font-size: 11px; color: #a6adc8;">${port.manufacturer || 'Unknown'}</span>
                        `;
                        
                        item.addEventListener('mouseover', () => item.style.background = '#313244');
                        item.addEventListener('mouseout', () => item.style.background = 'transparent');
                        
                        item.addEventListener('click', async () => {
                            // Connect to Serial
                            if (!window.ConnectionModule) {
                                await new Promise((resolve, reject) => {
                                    const script = document.createElement('script');
                                    script.src = 'public/modules/connection/connection.js';
                                    script.onload = resolve;
                                    script.onerror = reject;
                                    document.head.appendChild(script);
                                });
                            }

                            const tabId = 'serial-' + Date.now();
                            window.TabManager.addTab({
                                id: tabId,
                                title: port.path,
                                icon: 'fa-solid fa-microchip',
                                contentHtml: `<div id="terminal-${tabId}" style="height: 100%; width: 100%; background: #1e1e1e; overflow: hidden;"></div>`
                            });

                            setTimeout(async () => {
                                const hostInfo = {
                                    protocol: 'SERIAL',
                                    name: port.path,
                                    path: port.path,
                                    address: port.path,
                                    baudRate: 9600 // default
                                };
                                if (window.ConnectionModule) {
                                    const sessionObj = await window.ConnectionModule.init(`terminal-${tabId}`, hostInfo);
                                    const tab = window.TabManager.tabs.find(t => t.id === tabId);
                                    if(tab) tab.sessionObj = sessionObj;
                                }
                            }, 50);
                            
                            serialPopup.classList.remove('show');
                        });

                        listContainer.appendChild(item);
                    });

                } catch (err) {
                    console.error("Serial port error", err);
                    listContainer.innerHTML = '<div style="padding: 10px; color: #f38ba8;">Error scanning ports</div>';
                    input.value = "Error";
                    refreshIcon.classList.remove('fa-spin');
                }
            }
            
            // Refresh on icon click
            refreshIcon.style.cursor = 'pointer'; // Ensure it looks clickable
            refreshIcon.onclick = (e) => {
                 e.stopPropagation();
                 scanPorts();
            };

            // Initial scan
            scanPorts();

        });
    }

    btnTags.addEventListener('click', (e) => {
        e.stopPropagation();
        if (serialPopup) serialPopup.classList.remove('show'); // Close serial popup
        tagsPopup.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
         // Close serial popup on outside click
        if (serialPopup && btnSerial && !serialPopup.contains(e.target) && !btnSerial.contains(e.target)) {
            serialPopup.classList.remove('show');
        }

        if (!tagsPopup.contains(e.target) && !btnTags.contains(e.target)) {
            tagsPopup.classList.remove('show');
        }
    });
})();
