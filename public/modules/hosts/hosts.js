(function() {
    const hostsGrid = document.getElementById('hosts-grid');
    const btnNewHost = document.getElementById('btn-new-host');
    const btnTags = document.getElementById('btn-tags');
    const tagsPopup = document.getElementById('tags-popup');

    const tagsListContainer = document.querySelector('.tags-list');
    const tagsFooter = document.querySelector('.tags-footer');

    let allHosts = [];
    let selectedTags = new Set();

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
            label.innerHTML = `
                <input type="checkbox" value="${tag}">
                <span>${tag}</span>
            `;
            
            const checkbox = label.querySelector('input');
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
            
            let detailsText = `${host.protocol}, ${host.username}`;
            if (host.tags && host.tags.length > 0) {
                detailsText += `, ${host.tags.join(', ')}`;
            }

            card.innerHTML = `
                <div class="host-icon" style="background-color: ${host.color}">
                    <i class="${host.icon}"></i>
                </div>
                <div class="host-info">
                    <div class="host-name">${host.name}</div>
                    <div class="host-details">${detailsText}</div>
                </div>
                <div class="host-actions" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); display: none;">
                    <button class="btn-icon-only edit-host-btn" style="background: #313244; border: 1px solid #45475a; color: #a6adc8; cursor: pointer; padding: 10px; border-radius: 6px; transition: all 0.2s;">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
            `;
            
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

            card.addEventListener('click', () => {
                window.TabManager.addTab({
                    title: host.name,
                    icon: host.icon,
                    contentHtml: `
                        <div style="padding: 20px; height: 100%; background-color: #1e1e2e; color: #cdd6f4; font-family: monospace;">
                            <h3>Connecting to ${host.username}@${host.hostname || host.name}...</h3>
                            <p>Protocol: ${host.protocol}</p>
                            <p>>_ Connection established.</p>
                        </div>
                    `
                });
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
            const certInput = document.querySelector('input[placeholder="Certificate, FIDO2"]');
            const tagsInput = document.querySelector('input[placeholder="Tags"]');
            const portInput = document.querySelector('input[type="number"]');
            const btnConnect = document.querySelector('.btn-connect-large');

            // Removed manual binding of drawer-check since it's handled globally in app.js

            // Populate fields if editing
            if (hostToEdit) {
                if (addressInput) addressInput.value = hostToEdit.address || '';
                if (labelInput) labelInput.value = hostToEdit.name || '';
                if (usernameInput) usernameInput.value = hostToEdit.username || '';
                if (tagsInput && hostToEdit.tags) tagsInput.value = hostToEdit.tags[0] || ''; // Assuming single tag for now or first one
                if (portInput) portInput.value = hostToEdit.port || 22;
                // Password is usually not stored or retrieved for security, but if it was:
                // if (passwordInput) passwordInput.value = hostToEdit.password || '';
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
                        alert('Failed to delete host');
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
                        item.innerHTML = `Create "${filter}"`;
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

                    let isValid = true;

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

                    if (!isValid) return;

                    const tagValue = tagsInput ? tagsInput.value.trim() : '';
                    
                    // Add new tag if it doesn't exist
                    if (tagValue && !tags.includes(tagValue)) {
                        await window.electronAPI.hosts.addTag(tagValue);
                        // Refresh tags filter
                        const newTags = await window.electronAPI.hosts.getTags();
                        renderTagsFilter(newTags);
                    }

                    const hostData = {
                        id: hostToEdit ? hostToEdit.id : Date.now(),
                        name: labelInput.value || addressInput.value,
                        icon: "fa-brands fa-linux",
                        color: "#d6336c",
                        protocol: "ssh",
                        username: usernameInput.value || "root",
                        address: addressInput.value,
                        port: portInput ? portInput.value : 22,
                        tags: tagValue ? [tagValue] : [],
                        certPath: certInput ? (certInput.dataset.fullPath || certInput.value) : ''
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
                    } catch (error) {
                        console.error('Error saving host:', error);
                        alert('Failed to save host');
                    }
                });
            }
        }, 100);
    }

    btnNewHost.addEventListener('click', () => openHostDrawer());

    btnTags.addEventListener('click', (e) => {
        e.stopPropagation();
        tagsPopup.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!tagsPopup.contains(e.target) && !btnTags.contains(e.target)) {
            tagsPopup.classList.remove('show');
        }
    });
})();
