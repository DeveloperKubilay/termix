(function() {
    const isAndroid = typeof window !== 'undefined' && (
        !!window.TermixAndroid ||
        (document && document.documentElement && document.documentElement.classList.contains('termix-android'))
    );

    async function loadKeys() {
        const keysList = document.getElementById('keys-list');
        if (!keysList) return;

        const keyFiles = await window.electronAPI.keychain.getKeyFiles();

        if (keyFiles.length === 0) {
            keysList.innerHTML = '<p style="color: var(--text-muted);">No keys found. Add your SSH keys here.</p>';
            return;
        }

        if (isAndroid) {
            keysList.innerHTML = '';
            keyFiles.forEach(file => {
                const safeName = file.relativePath || file.name;

                const item = document.createElement('div');
                item.className = 'key-item';
                item.dataset.filename = safeName;
                item.style.cssText = 'background: rgba(255,255,255,0.05); padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; position: relative;';

                const info = document.createElement('div');

                const keyIcon = document.createElement('i');
                keyIcon.className = 'fa-solid fa-key';
                keyIcon.style.cssText = 'margin-right: 10px; color: #89b4fa;';

                const nameEl = document.createElement('strong');
                nameEl.textContent = safeName;

                const sizeEl = document.createElement('span');
                sizeEl.style.cssText = 'color: var(--text-muted); margin-left: 10px;';
                sizeEl.textContent = `${file.size} KB`;

                info.appendChild(keyIcon);
                info.appendChild(nameEl);
                info.appendChild(sizeEl);

                const actions = document.createElement('div');
                actions.className = 'key-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-delete-key';
                deleteBtn.dataset.filename = safeName;
                deleteBtn.title = 'Delete Key';
                deleteBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: #f38ba8; display: inline-flex; align-items: center; justify-content: center;';

                const trashIcon = document.createElement('i');
                trashIcon.className = 'fa-solid fa-trash';
                deleteBtn.appendChild(trashIcon);

                actions.appendChild(deleteBtn);
                item.appendChild(info);
                item.appendChild(actions);

                deleteBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const filename = deleteBtn.dataset.filename;
                    if (!filename) return;

                    let confirmed = false;
                    const confirmMsg = `Are you sure you want to delete "${filename}"?`;
                    if (window.AppConfirm && typeof window.AppConfirm.confirm === 'function') {
                        confirmed = await window.AppConfirm.confirm(confirmMsg, {
                            title: 'Delete Key',
                            confirmText: 'Delete',
                            cancelText: 'Cancel'
                        });
                    } else if (typeof window.confirmAction === 'function') {
                        confirmed = await window.confirmAction(confirmMsg, {
                            title: 'Delete Key',
                            confirmText: 'Delete'
                        });
                    } else if (typeof window.confirm === 'function') {
                        confirmed = window.confirm(confirmMsg);
                    }

                    if (!confirmed) return;

                    try {
                        const deleteFn = window.electronAPI.keychain.deleteKeyFile;
                        if (typeof deleteFn !== 'function') {
                            throw new Error('Keychain delete API is unavailable.');
                        }
                        const result = await deleteFn(filename);
                        if (result && result.success) {
                            if (window.notifyUser) window.notifyUser('Key deleted', 'success');
                            loadKeys();
                        } else {
                            const err = (result && result.error) || 'Failed to delete key';
                            if (window.notifyUser) window.notifyUser(err, 'error');
                        }
                    } catch (err) {
                        console.error('Delete key error:', err);
                        if (window.notifyUser) window.notifyUser(err.message || 'Error deleting key', 'error');
                    }
                });

                keysList.appendChild(item);
            });
            return;
        }

        keysList.innerHTML = keyFiles.map(file => {
            const safeName = file.relativePath || file.name;
            return `
                <div class="key-item" data-filename="${safeName}" style="cursor: pointer; background: rgba(255,255,255,0.05); padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; position: relative;">
                    <div>
                        <i class="fa-solid fa-key" style="margin-right: 10px; color: #89b4fa;"></i>
                        <strong>${safeName}</strong>
                        <span style="color: var(--text-muted); margin-left: 10px;">${file.size} KB</span>
                    </div>
                    <div class="key-actions" style="opacity: 0; transition: opacity 0.2s; background: #313244; padding: 8px; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-pen" style="color: #a6adc8;"></i>
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.key-item').forEach(item => {
            const handler = async (e) => {
                e.preventDefault();
                const filename = item.dataset.filename;
                try {
                    const result = await window.electronAPI.keychain.readKeyFile(filename);
                    if (result.success) {
                        openEditDrawer(filename, result.content);
                    } else {
                        window.notifyUser('Failed to read key: ' + result.error, 'error');
                    }
                } catch (err) {
                    console.error(err);
                    window.notifyUser('Error reading key', 'error');
                }
            };

            item.addEventListener('click', handler);
            item.addEventListener('contextmenu', handler);
        });
    }

    function openEditDrawer(filename, content) {
        const template = document.getElementById('key-edit-template');
        if (!template) return;

        Drawer.open('Edit Key File', template.innerHTML);

        const filenameInput = document.getElementById('edit-key-filename');
        const contentInput = document.getElementById('edit-key-content');
        const saveBtn = document.getElementById('btn-save-key');

        // Store original filename
        const originalFilename = filename;

        if (filenameInput) filenameInput.value = filename;
        if (contentInput) contentInput.value = content;

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const newFilename = filenameInput.value;
                const newContent = contentInput.value;

                if (filenameInput) {
                    filenameInput.style.borderColor = 'var(--border)';
                }

                if (!newFilename) {
                    if (filenameInput) {
                        filenameInput.style.borderColor = '#f38ba8';
                        filenameInput.focus();
                    }
                    return;
                }

                try {
                    const result = await window.electronAPI.keychain.saveKeyFile(originalFilename, newFilename, newContent);
                    if (result.success) {
                        Drawer.close();
                        loadKeys();
                    } else {
                        window.notifyUser('Failed to save key: ' + result.error, 'error');
                    }
                } catch (err) {
                    console.error(err);
                    window.notifyUser('Error saving key', 'error');
                }
            });
        }
    }

    document.getElementById('btn-new-key')?.addEventListener('click', async () => {
        if (isAndroid) {
            try {
                if (window.TermixAndroid && typeof window.TermixAndroid.invoke === 'function') {
                    const res = await window.TermixAndroid.invoke('native:import-key');
                    if (res && res.cancelled) return;
                    if (res && res.name) {
                        if (window.notifyUser) window.notifyUser(`Key "${res.name}" imported`, 'success');
                        await loadKeys();
                    }
                }
            } catch (err) {
                console.error('Key import error:', err);
                if (window.notifyUser) window.notifyUser('Key import failed: ' + (err.message || err), 'error');
            }
            return;
        }
        await window.electronAPI.keychain.openFilesFolder();
        setTimeout(loadKeys, 1000);
    });

    loadKeys();
    setInterval(loadKeys, 3000);
})();
