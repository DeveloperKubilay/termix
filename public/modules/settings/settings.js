(function() {
    const aiMethod = document.getElementById('ai-method');
    const aiUrl = document.getElementById('ai-url');
    const aiHeaders = document.getElementById('ai-headers');
    
    const currentUser = document.getElementById('current-user-name');
    const storageType = document.getElementById('storage-type');
    
    const firebaseOptions = document.getElementById('firebase-sync-options');
    const tagsList = document.getElementById('tags-list');

    // Load Settings
    async function loadSettings() {
        try {
            const data = await window.electronAPI.settings.getSettings();
            
            // Profile Info
            currentUser.textContent = data.profile.name;
            storageType.textContent = data.profile.type === 'firebase' ? 'Firebase' : 'Local JSON';

            if (data.profile.type === 'firebase') {
                firebaseOptions.style.display = 'block';
            } else {
                firebaseOptions.style.display = 'none';
            }

            // AI Settings
            if (data.ai) {
                aiMethod.value = data.ai.method || 'GET';
                aiUrl.value = data.ai.url || '';
                aiHeaders.value = typeof data.ai.headers === 'object' ? JSON.stringify(data.ai.headers, null, 2) : (data.ai.headers || '');
            }

            // Tags
            renderTags(data.tags);

        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }

    function renderTags(tags) {
        if (!tags || tags.length === 0) {
            tagsList.innerHTML = '<span style="color: var(--text-muted);">No tags found.</span>';
            return;
        }

        tagsList.innerHTML = tags.map(tag => `
            <div class="tag-item">
                ${tag}
                <i class="fa-solid fa-xmark tag-delete" onclick="deleteTag('${tag}')"></i>
            </div>
        `).join('');
    }

    // Expose delete tag function globally
    window.deleteTag = async (tag) => {
        if (!confirm(`Are you sure you want to delete tag "${tag}"?`)) return;
        
        try {
            const newTags = await window.electronAPI.hosts.deleteTag(tag);
            renderTags(newTags);
        } catch (err) {
            alert('Failed to delete tag: ' + err.message);
        }
    };

    // Open Profile Folder
    document.getElementById('btn-open-profile-folder').addEventListener('click', async () => {
        await window.electronAPI.settings.openProfileFolder();
    });

    // Save Settings
    document.getElementById('btn-save-settings').addEventListener('click', async function() {
        const btn = this;
        
        // Reset styles
        // The URL input is inside a flex wrapper, so we target the parent
        const aiUrlWrapper = aiUrl.parentElement;
        aiUrlWrapper.style.borderColor = 'var(--border)';
        aiHeaders.style.borderColor = 'var(--border)';

        // Validate URL
        const urlVal = aiUrl.value.trim();
        if (urlVal) {
            try {
                new URL(urlVal);
            } catch (_) {
                aiUrlWrapper.style.borderColor = '#ff4444';
                return;
            }
        }

        // Validate Headers
        let headers = {};
        const hVal = aiHeaders.value.trim();
        
        if (hVal) {
            try {
                headers = JSON.parse(hVal);
            } catch (e) {
                aiHeaders.style.borderColor = '#ff4444';
                return;
            }
        } else {
            headers = {};
            aiHeaders.value = '{}';
        }

        const settings = {
            ai: {
                method: aiMethod.value,
                url: urlVal,
                headers: headers
            }
        };

        const originalText = btn.innerHTML;
        const originalBg = btn.style.background;
        const originalColor = btn.style.color;

        // Loading state
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.8';

        try {
            await window.electronAPI.settings.saveSettings(settings);
            
            // Success state
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
            btn.style.background = '#a6e3a1'; // Green
            btn.style.color = '#1e1e2e';      // Dark Text
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = originalBg;
                btn.style.color = originalColor;
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            }, 1000);
        } catch (err) {
            console.error(err);
            // Error state
            btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
            btn.style.background = '#f38ba8'; // Red
            btn.style.color = '#1e1e2e';
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = originalBg;
                btn.style.color = originalColor;
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            }, 2000);
        }
    });

    // Firebase Sync
    document.getElementById('btn-sync-pull').addEventListener('click', async () => {
        if (!confirm('This will overwrite your local data with data from Firebase. Continue?')) return;
        try {
            const res = await window.electronAPI.settings.syncFirebase('pull');
            alert(res.message);
            if(res.success) {
                // If pull is successful, we should probably update the UI tag list etc if the page isn't reloaded
                loadSettings(); 
            }
        } catch (e) {
            alert('Sync error: ' + e.message);
        }
    });

    document.getElementById('btn-sync-push').addEventListener('click', async () => {
        if (!confirm('This will overwrite Firebase data with your local data. Continue?')) return;
        try {
            const res = await window.electronAPI.settings.syncFirebase('push');
            alert(res.message);
        } catch (e) {
            alert('Sync error: ' + e.message);
        }
    });

    loadSettings();
})();
