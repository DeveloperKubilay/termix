(function() {
    async function loadKeys() {
        const keysList = document.getElementById('keys-list');
        
        const keyFiles = await window.electronAPI.keychain.getKeyFiles();

        if (keyFiles.length === 0) {
            keysList.innerHTML = '<p style="color: var(--text-muted);">No keys found. Add your SSH keys here.</p>';
            return;
        }

        keysList.innerHTML = keyFiles.map(file => {
            return `
                <div class="key-item" data-filename="${file.relativePath}" style="cursor: pointer; background: rgba(255,255,255,0.05); padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; position: relative;">
                    <div>
                        <i class="fa-solid fa-key" style="margin-right: 10px; color: #89b4fa;"></i>
                        <strong>${file.relativePath}</strong>
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
                        alert('Failed to read key: ' + result.error);
                    }
                } catch (err) {
                    console.error(err);
                    alert('Error reading key');
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
                
                if (!newFilename) {
                    alert('Filename cannot be empty');
                    return;
                }

                try {
                    const result = await window.electronAPI.keychain.saveKeyFile(originalFilename, newFilename, newContent);
                    if (result.success) {
                        Drawer.close();
                        loadKeys();
                    } else {
                        alert('Failed to save key: ' + result.error);
                    }
                } catch (err) {
                    console.error(err);
                    alert('Error saving key');
                }
            });
        }
    }

    document.getElementById('btn-new-key').addEventListener('click', async () => {
        await window.electronAPI.keychain.openFilesFolder();
        setTimeout(loadKeys, 1000);
    });

    loadKeys();
    setInterval(loadKeys, 3000);
})();
