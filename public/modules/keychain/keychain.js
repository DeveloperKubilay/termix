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
                <div style="background: rgba(255,255,255,0.05); padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <i class="fa-solid fa-key" style="margin-right: 10px; color: #89b4fa;"></i>
                        <strong>${file.relativePath}</strong>
                        <span style="color: var(--text-muted); margin-left: 10px;">${file.size} KB</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('btn-new-key').addEventListener('click', async () => {
        await window.electronAPI.keychain.openFilesFolder();
        setTimeout(loadKeys, 1000);
    });

    loadKeys();
    setInterval(loadKeys, 3000);
})();
