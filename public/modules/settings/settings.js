(function () {
    const aiMethod = document.getElementById('ai-method');
    const aiUrl = document.getElementById('ai-url');
    const aiBody = document.getElementById('ai-body');
    const aiHeaders = document.getElementById('ai-headers');
    const btnToggleTheme = document.getElementById('btn-toggle-theme');
    const btnDeleteAccount = document.getElementById('btn-delete-account');
    const deleteAccountPanel = document.getElementById('delete-account-panel');
    const deleteAccountMessage = document.getElementById('delete-account-message');
    const btnConfirmDeleteAccount = document.getElementById('btn-confirm-delete-account');
    const btnCancelDeleteAccount = document.getElementById('btn-cancel-delete-account');

    const currentUser = document.getElementById('current-user-name');
    const storageType = document.getElementById('storage-type');
    const firebaseOptions = document.getElementById('firebase-sync-options');
    const syncProviderName = document.getElementById('sync-provider-name');
    const syncProviderDescription = document.getElementById('sync-provider-description');
    const tagsList = document.getElementById('tags-list');

    const autoUpdateToggle = document.getElementById('auto-update-toggle');
    const updateCurrentVersion = document.getElementById('update-current-version');
    const updateAvailableVersion = document.getElementById('update-available-version');
    const updateLastChecked = document.getElementById('update-last-checked');
    const updateMessage = document.getElementById('update-message');
    const updateProgressWrap = document.getElementById('update-progress-wrap');
    const updateProgressFill = document.getElementById('update-progress-fill');
    const updateProgressText = document.getElementById('update-progress-text');
    const btnCheckUpdate = document.getElementById('btn-check-update');
    const btnInstallUpdate = document.getElementById('btn-install-update');

    let activeCloudProvider = null;
    let activeProfileId = null;
    let activeProfileName = 'this account';
    let profileCount = 0;
    let updateState = null;
    let isThemeSaveInProgress = false;
    let isDeleteInProgress = false;

    const deleteButtonDefaults = {
        trigger: btnDeleteAccount ? btnDeleteAccount.innerHTML : '',
        confirm: btnConfirmDeleteAccount ? btnConfirmDeleteAccount.innerHTML : '',
        cancel: btnCancelDeleteAccount ? btnCancelDeleteAccount.innerHTML : ''
    };

    function normalizeUiTheme(theme) {
        return String(theme || '').trim().toLowerCase() === 'modern' ? 'modern' : 'classic';
    }

    let selectedUiTheme = normalizeUiTheme(
        document.documentElement.getAttribute('data-theme')
        || (window.ThemeManager ? window.ThemeManager.getCurrentTheme() : 'classic')
    );

    function renderThemeButton() {
        if (!btnToggleTheme) return;
        const isClassic = selectedUiTheme === 'classic';
        btnToggleTheme.innerHTML = isClassic
            ? '<i class="fa-solid fa-palette"></i> Theme: Classic'
            : '<i class="fa-solid fa-palette"></i> Theme: Modern';
    }

    function applyUiTheme(theme, options = {}) {
        const next = normalizeUiTheme(theme);
        selectedUiTheme = window.ThemeManager
            ? window.ThemeManager.apply(next, options)
            : next;
        renderThemeButton();
    }

    async function persistUiTheme(theme) {
        if (!window.electronAPI || !window.electronAPI.settings || !window.electronAPI.settings.saveSettings) {
            return false;
        }

        await window.electronAPI.settings.saveSettings({
            uiTheme: normalizeUiTheme(theme)
        });
        return true;
    }

    function getProfileMeta(type) {
        const normalized = String(type || 'local').toLowerCase();

        if (normalized === 'firebase') {
            return {
                storageLabel: 'Firebase',
                isCloud: true,
                cloudProvider: 'Firebase'
            };
        }

        if (normalized === 'qmm') {
            return {
                storageLabel: 'QMM',
                isCloud: true,
                cloudProvider: 'QMM'
            };
        }

        return {
            storageLabel: 'Local JSON',
            isCloud: false,
            cloudProvider: null
        };
    }

    function formatDateTime(value) {
        if (!value) return 'Never';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Never';
        return date.toLocaleString();
    }

    function setDeletePanelVisible(visible) {
        if (!deleteAccountPanel) return;
        deleteAccountPanel.hidden = !visible;
    }

    function renderDeletePanelMessage() {
        if (!deleteAccountMessage) return;

        let message = `Delete '${activeProfileName}' and remove its saved hosts, snippets, tags, and settings from this device.`;
        if (activeCloudProvider) {
            message += ' Cloud data is not deleted automatically.';
        }
        if (profileCount <= 1) {
            message += ' Because this is the last profile, Termix will create a fresh default profile after deletion.';
        } else {
            message += ' This action cannot be undone.';
        }

        deleteAccountMessage.textContent = message;
    }

    function renderDeleteButtonState() {
        if (btnDeleteAccount) {
            btnDeleteAccount.disabled = !activeProfileId || isDeleteInProgress;
            btnDeleteAccount.style.opacity = btnDeleteAccount.disabled ? '0.72' : '1';
            btnDeleteAccount.style.pointerEvents = btnDeleteAccount.disabled ? 'none' : 'auto';
            btnDeleteAccount.innerHTML = deleteButtonDefaults.trigger;
        }

        if (btnConfirmDeleteAccount) {
            btnConfirmDeleteAccount.disabled = !activeProfileId || isDeleteInProgress;
            btnConfirmDeleteAccount.style.opacity = btnConfirmDeleteAccount.disabled ? '0.72' : '1';
            btnConfirmDeleteAccount.style.pointerEvents = btnConfirmDeleteAccount.disabled ? 'none' : 'auto';
            btnConfirmDeleteAccount.innerHTML = isDeleteInProgress
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...'
                : deleteButtonDefaults.confirm;
        }

        if (btnCancelDeleteAccount) {
            btnCancelDeleteAccount.disabled = isDeleteInProgress;
            btnCancelDeleteAccount.style.opacity = btnCancelDeleteAccount.disabled ? '0.72' : '1';
            btnCancelDeleteAccount.style.pointerEvents = btnCancelDeleteAccount.disabled ? 'none' : 'auto';
            btnCancelDeleteAccount.innerHTML = deleteButtonDefaults.cancel;
        }
    }

    function renderUpdateState(nextState = {}) {
        updateState = {
            ...(updateState || {}),
            ...(nextState || {})
        };

        updateCurrentVersion.textContent = updateState.currentVersion || '-';
        updateAvailableVersion.textContent =
            updateState.downloadedVersion
            || updateState.availableVersion
            || (updateState.status === 'up-to-date' ? (updateState.currentVersion || '-') : '-');
        updateLastChecked.textContent = formatDateTime(updateState.lastCheckedAt);
        const updaterSupported = updateState.supported !== false;
        const messageText = typeof updateState.message === 'string' ? updateState.message.trim() : '';
        updateMessage.hidden = false;
        updateMessage.textContent = messageText || (updaterSupported ? '' : 'Updater is not available in this build.');
        if (!updateMessage.textContent) {
            updateMessage.hidden = true;
        }
        autoUpdateToggle.checked = Boolean(updateState.autoUpdateEnabled);
        autoUpdateToggle.disabled = !updaterSupported;

        const progress = Number(updateState.progress || 0);
        const showProgress = updaterSupported && updateState.status === 'downloading';
        updateProgressWrap.hidden = !showProgress;
        updateProgressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        updateProgressText.textContent = showProgress ? `${Math.round(progress)}%` : '';

        const isChecking = updateState.status === 'checking';
        const isDownloading = updateState.status === 'downloading';
        const isInstalling = updateState.status === 'installing';
        const canInstall = updateState.status === 'downloaded';

        btnCheckUpdate.disabled = !updaterSupported || isChecking || isDownloading || isInstalling;
        btnInstallUpdate.disabled = !updaterSupported || !canInstall || isInstalling;
    }

    async function loadUpdateState(initialAutoUpdateEnabled) {
        if (!window.electronAPI.settings || !window.electronAPI.settings.getUpdateSettings) {
            renderUpdateState({
                supported: false,
                autoUpdateEnabled: Boolean(initialAutoUpdateEnabled),
                status: 'disabled',
                message: 'Updater channel is unavailable in this build.'
            });
            return;
        }

        try {
            const state = await window.electronAPI.settings.getUpdateSettings();
            renderUpdateState(state);
        } catch (err) {
            renderUpdateState({
                status: 'error',
                message: `Failed to load updater state: ${err.message}`
            });
        }
    }

    function setupUpdaterEventBridge() {
        if (!window.__termixUpdaterEventBridgeReady) {
            window.__termixUpdaterEventBridgeReady = true;
            window.electronAPI.on('updater:status', (event, payload) => {
                if (typeof window.__termixUpdaterStateHandler === 'function') {
                    window.__termixUpdaterStateHandler(payload);
                }
            });
        }
        window.__termixUpdaterStateHandler = (payload) => {
            renderUpdateState(payload);
        };
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

    async function loadSettings() {
        try {
            const data = await window.electronAPI.settings.getSettings();
            const profileType = data && data.profile ? data.profile.type : 'local';
            const profileMeta = getProfileMeta(profileType);
            let profilesPayload = null;

            if (window.electronAPI.profiles && window.electronAPI.profiles.getProfiles) {
                try {
                    profilesPayload = await window.electronAPI.profiles.getProfiles();
                } catch (profileErr) {
                    console.warn('Failed to load profile list for settings:', profileErr);
                }
            }

            currentUser.textContent = data.profile.name;
            storageType.textContent = profileMeta.storageLabel;
            activeCloudProvider = profileMeta.cloudProvider;
            activeProfileName = data.profile.name || 'this account';
            activeProfileId = profilesPayload && profilesPayload.activeProfileId
                ? profilesPayload.activeProfileId
                : null;
            profileCount = profilesPayload && Array.isArray(profilesPayload.profiles)
                ? profilesPayload.profiles.length
                : (activeProfileId ? 1 : 0);

            if (profileMeta.isCloud) {
                firebaseOptions.style.display = 'block';
                if (syncProviderName) syncProviderName.textContent = profileMeta.cloudProvider;
                if (syncProviderDescription) {
                    syncProviderDescription.textContent = `Sync your local data with ${profileMeta.cloudProvider}.`;
                }
            } else {
                firebaseOptions.style.display = 'none';
            }

            if (data.ai) {
                aiMethod.value = data.ai.method || 'GET';
                aiUrl.value = data.ai.url || '';
                aiBody.value = typeof data.ai.body === 'object' ? JSON.stringify(data.ai.body, null, 2) : (data.ai.body || '');
                aiHeaders.value = typeof data.ai.headers === 'object' ? JSON.stringify(data.ai.headers, null, 2) : (data.ai.headers || '');
            }

            selectedUiTheme = normalizeUiTheme(
                data.uiTheme
                || (window.ThemeManager ? window.ThemeManager.getCurrentTheme() : null)
                || document.documentElement.getAttribute('data-theme')
            );
            applyUiTheme(selectedUiTheme, { persist: true });
            renderThemeButton();
            renderDeletePanelMessage();
            renderDeleteButtonState();
            setDeletePanelVisible(false);

            renderTags(data.tags);
            await loadUpdateState(data.updateSettings && data.updateSettings.autoUpdateEnabled);
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }

    window.deleteTag = async (tag) => {
        try {
            const newTags = await window.electronAPI.hosts.deleteTag(tag);
            renderTags(newTags);
        } catch (err) {
            window.notifyUser('Failed to delete tag: ' + err.message, 'error');
        }
    };

    document.getElementById('btn-open-profile-folder').addEventListener('click', async () => {
        await window.electronAPI.settings.openProfileFolder();
    });

    document.getElementById('btn-open-config-file').addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.settings.openConfigFile();
            if (result && result.success && result.path) {
                window.notifyUser('Opened config: ' + result.path, 'success');
            }
        } catch (err) {
            window.notifyUser('Failed to open config file: ' + err.message, 'error');
        }
    });

    if (btnToggleTheme) {
        btnToggleTheme.addEventListener('click', async () => {
            if (isThemeSaveInProgress) return;

            const previousTheme = selectedUiTheme;
            const next = selectedUiTheme === 'classic' ? 'modern' : 'classic';
            applyUiTheme(next, { persist: true });

            isThemeSaveInProgress = true;
            btnToggleTheme.style.pointerEvents = 'none';
            btnToggleTheme.style.opacity = '0.78';

            try {
                await persistUiTheme(next);
            } catch (err) {
                applyUiTheme(previousTheme, { persist: true });
                window.notifyUser('Theme save failed: ' + err.message, 'error');
            } finally {
                isThemeSaveInProgress = false;
                btnToggleTheme.style.pointerEvents = 'auto';
                btnToggleTheme.style.opacity = '1';
            }
        });
    }

    if (btnDeleteAccount) {
        btnDeleteAccount.addEventListener('click', () => {
            if (!activeProfileId || isDeleteInProgress) return;
            renderDeletePanelMessage();
            setDeletePanelVisible(deleteAccountPanel ? deleteAccountPanel.hidden : false);
        });
    }

    if (btnCancelDeleteAccount) {
        btnCancelDeleteAccount.addEventListener('click', () => {
            if (isDeleteInProgress) return;
            setDeletePanelVisible(false);
        });
    }

    if (btnConfirmDeleteAccount) {
        btnConfirmDeleteAccount.addEventListener('click', async () => {
            if (!activeProfileId || isDeleteInProgress) return;

            isDeleteInProgress = true;
            renderDeleteButtonState();

            try {
                const result = await window.electronAPI.profiles.deleteProfile(activeProfileId);
                if (!result || result.success !== true) {
                    throw new Error(result && result.message ? result.message : 'Account delete failed.');
                }

                window.location.reload();
            } catch (err) {
                isDeleteInProgress = false;
                renderDeleteButtonState();
                window.notifyUser('Failed to delete account: ' + err.message, 'error');
            }
        });
    }

    autoUpdateToggle.addEventListener('change', async () => {
        try {
            const result = await window.electronAPI.settings.setUpdateSettings({
                autoUpdateEnabled: autoUpdateToggle.checked
            });
            if (result && result.success) {
                renderUpdateState(result.state);
                window.notifyUser(
                    autoUpdateToggle.checked
                        ? 'Startup update checks enabled.'
                        : 'Startup update checks disabled.',
                    'success'
                );
                return;
            }
            throw new Error(result && result.message ? result.message : 'Failed to save update settings.');
        } catch (err) {
            autoUpdateToggle.checked = !autoUpdateToggle.checked;
            window.notifyUser('Failed to change update preference: ' + err.message, 'error');
        }
    });

    btnCheckUpdate.addEventListener('click', async () => {
        try {
            const res = await window.electronAPI.settings.checkForUpdates();
            if (!res.success) {
                window.notifyUser(res.message || 'Update check failed.', 'error');
            }
            if (res.state) renderUpdateState(res.state);
        } catch (err) {
            window.notifyUser('Failed to check updates: ' + err.message, 'error');
        }
    });

    btnInstallUpdate.addEventListener('click', async () => {
        const approved = await window.confirmAction(
            'The app will restart to install the downloaded update. Continue?',
            {
                title: 'Install Update',
                confirmText: 'Install & Restart',
                cancelText: 'Cancel'
            }
        );
        if (!approved) return;

        try {
            const res = await window.electronAPI.settings.installUpdate();
            if (!res.success) {
                window.notifyUser(res.message || 'Update install failed.', 'error');
                return;
            }
            if (res.state) renderUpdateState(res.state);
        } catch (err) {
            window.notifyUser('Failed to install update: ' + err.message, 'error');
        }
    });

    document.getElementById('btn-save-settings').addEventListener('click', async function () {
        const btn = this;
        const aiUrlWrapper = aiUrl.parentElement;
        aiUrlWrapper.style.borderColor = 'var(--border)';
        aiBody.style.borderColor = 'var(--border)';
        aiHeaders.style.borderColor = 'var(--border)';

        let urlVal = aiUrl.value.trim();
        if (urlVal && !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(urlVal)) {
            urlVal = `http://${urlVal}`;
            aiUrl.value = urlVal;
        }

        if (urlVal) {
            try {
                new URL(urlVal);
            } catch (_) {
                aiUrlWrapper.style.borderColor = '#ff4444';
                return;
            }
        }

        let body = {};
        const bodyVal = aiBody.value.trim();
        if (bodyVal) {
            try {
                body = JSON.parse(bodyVal);
            } catch (_) {
                aiBody.style.borderColor = '#ff4444';
                return;
            }
        } else {
            aiBody.value = '{}';
        }

        let headers = {};
        const hVal = aiHeaders.value.trim();
        if (hVal) {
            try {
                headers = JSON.parse(hVal);
            } catch (_) {
                aiHeaders.style.borderColor = '#ff4444';
                return;
            }
        } else {
            aiHeaders.value = '{}';
        }

        const settings = {
            ai: {
                method: aiMethod.value,
                url: urlVal,
                body,
                headers
            },
            uiTheme: selectedUiTheme
        };

        const originalText = btn.innerHTML;
        const originalBg = btn.style.background;
        const originalColor = btn.style.color;

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.8';

        try {
            await window.electronAPI.settings.saveSettings(settings);
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
            btn.style.background = '#a6e3a1';
            btn.style.color = '#1e1e2e';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = originalBg;
                btn.style.color = originalColor;
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            }, 1000);
        } catch (err) {
            console.error(err);
            btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
            btn.style.background = '#f38ba8';
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

    document.getElementById('btn-sync-pull').addEventListener('click', async () => {
        const providerLabel = activeCloudProvider || 'Cloud';
        const approved = await window.confirmAction(
            `This will overwrite your local data with data from ${providerLabel}. Continue?`,
            {
                title: `${providerLabel} Pull`,
                confirmText: 'Pull Data',
                cancelText: 'Cancel',
                tone: 'danger'
            }
        );
        if (!approved) return;
        try {
            const res = await window.electronAPI.settings.syncFirebase('pull');
            window.notifyUser(res.message, res && res.success ? 'success' : 'error');
            if (res.success) {
                loadSettings();
            }
        } catch (e) {
            window.notifyUser('Sync error: ' + e.message, 'error');
        }
    });

    document.getElementById('btn-sync-push').addEventListener('click', async () => {
        const providerLabel = activeCloudProvider || 'Cloud';
        const approved = await window.confirmAction(
            `This will overwrite ${providerLabel} data with your local data. Continue?`,
            {
                title: `${providerLabel} Push`,
                confirmText: 'Push Data',
                cancelText: 'Cancel',
                tone: 'danger'
            }
        );
        if (!approved) return;
        try {
            const res = await window.electronAPI.settings.syncFirebase('push');
            window.notifyUser(res.message, res && res.success ? 'success' : 'error');
        } catch (e) {
            window.notifyUser('Sync error: ' + e.message, 'error');
        }
    });

    setupUpdaterEventBridge();
    renderThemeButton();
    renderDeleteButtonState();
    loadSettings();
})();
