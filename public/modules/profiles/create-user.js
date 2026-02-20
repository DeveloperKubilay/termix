(function() {
    const nameInput = document.getElementById('profile-name');
    const jsonLabel = document.getElementById('type-json-label');
    const firebaseLabel = document.getElementById('type-firebase-label');
    const firebaseSection = document.getElementById('firebase-section');
    const configInput = document.getElementById('firebase-config');
    const createBtn = document.getElementById('create-profile-btn');
    const permWriteBtn = document.getElementById('perm-write');

    const ERROR_BORDER = '#f38ba8';
    const DEFAULT_BORDER = 'var(--border)';

    let selectedType = 'local';
    let writePermission = true;

    const buttonDefaults = {
        text: createBtn ? createBtn.innerHTML : 'Create User',
        background: createBtn ? createBtn.style.background : '',
        color: createBtn ? createBtn.style.color : ''
    };

    function markInvalid(inputEl) {
        if (!inputEl) return;
        inputEl.style.borderColor = ERROR_BORDER;
    }

    function clearInvalid(inputEl) {
        if (!inputEl) return;
        inputEl.style.borderColor = DEFAULT_BORDER;
    }

    function resetValidation() {
        clearInvalid(nameInput);
        clearInvalid(configInput);
    }

    function setButtonLoading() {
        if (!createBtn) return;
        createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        createBtn.style.pointerEvents = 'none';
        createBtn.style.opacity = '0.8';
    }

    function setButtonSuccess() {
        if (!createBtn) return;
        createBtn.innerHTML = '<i class="fa-solid fa-check"></i> Created!';
        createBtn.style.background = '#a6e3a1';
        createBtn.style.color = '#1e1e2e';
        createBtn.style.pointerEvents = 'none';
        createBtn.style.opacity = '1';
    }

    function setButtonError() {
        if (!createBtn) return;
        createBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
        createBtn.style.background = '#f38ba8';
        createBtn.style.color = '#1e1e2e';
        createBtn.style.pointerEvents = 'none';
        createBtn.style.opacity = '1';
    }

    function resetButton() {
        if (!createBtn) return;
        createBtn.innerHTML = buttonDefaults.text;
        createBtn.style.background = buttonDefaults.background;
        createBtn.style.color = buttonDefaults.color;
        createBtn.style.pointerEvents = 'auto';
        createBtn.style.opacity = '1';
    }

    function setType(type) {
        selectedType = type;

        if (type === 'local') {
            jsonLabel.classList.add('selected');
            jsonLabel.style.borderColor = 'var(--accent)';
            jsonLabel.style.background = 'rgba(137, 180, 250, 0.1)';
            jsonLabel.querySelector('input').checked = true;

            firebaseLabel.classList.remove('selected');
            firebaseLabel.style.borderColor = 'var(--border)';
            firebaseLabel.style.background = 'transparent';

            firebaseSection.style.display = 'none';
            clearInvalid(configInput);
            return;
        }

        firebaseLabel.classList.add('selected');
        firebaseLabel.style.borderColor = 'var(--accent)';
        firebaseLabel.style.background = 'rgba(137, 180, 250, 0.1)';
        firebaseLabel.querySelector('input').checked = true;

        jsonLabel.classList.remove('selected');
        jsonLabel.style.borderColor = 'var(--border)';
        jsonLabel.style.background = 'transparent';

        firebaseSection.style.display = 'block';

        if (!configInput.value.trim()) {
            configInput.value = '{}';
        }
    }

    function toggleWrite(btn) {
        writePermission = !writePermission;
        if (writePermission) {
            btn.classList.add('active');
            btn.style.background = 'var(--accent)';
            btn.style.color = 'var(--bg-dark)';
            return;
        }

        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-main)';
    }

    jsonLabel.addEventListener('click', () => setType('local'));
    firebaseLabel.addEventListener('click', () => setType('firebase'));
    permWriteBtn.addEventListener('click', () => toggleWrite(permWriteBtn));

    if (nameInput) {
        nameInput.addEventListener('input', () => clearInvalid(nameInput));
    }

    if (configInput) {
        configInput.addEventListener('input', () => clearInvalid(configInput));
    }

    createBtn.addEventListener('click', async () => {
        resetValidation();

        const name = nameInput.value.trim();
        if (!name) {
            markInvalid(nameInput);
            nameInput.focus();
            return;
        }

        let config = {};
        if (selectedType === 'firebase') {
            try {
                const rawConfig = configInput.value.trim() || '{}';
                config = JSON.parse(rawConfig);
            } catch (_) {
                markInvalid(configInput);
                configInput.focus();
                return;
            }
        }

        const payload = {
            name,
            type: selectedType,
            config: selectedType === 'firebase' ? config : {},
            write: selectedType === 'firebase' ? writePermission : true
        };

        setButtonLoading();

        try {
            if (!window.electronAPI || !window.electronAPI.profiles || !window.electronAPI.profiles.createProfile) {
                console.error('Electron API not found');
                setButtonError();
                window.notifyUser('System error: API not connected.', 'error');
                setTimeout(resetButton, 2000);
                return;
            }

            const result = await window.electronAPI.profiles.createProfile(payload);
            if (!result || result.success !== true) {
                setButtonError();
                window.notifyUser(result && result.message ? result.message : 'Error creating profile', 'error');
                setTimeout(resetButton, 2000);
                return;
            }

            setButtonSuccess();

            if (window.ProfileManager && window.ProfileManager.refreshProfiles) {
                await window.ProfileManager.refreshProfiles();
            }

            if (result.firebaseSync && result.firebaseSync.success === false) {
                window.notifyUser('Profile created, but Firebase pull failed: ' + result.firebaseSync.message, 'warning');
            }

            nameInput.value = '';

            if (result.switched) {
                setTimeout(() => window.location.reload(), 420);
                return;
            }

            setTimeout(resetButton, 1000);
        } catch (err) {
            console.error(err);
            setButtonError();
            window.notifyUser('Error creating profile: ' + err.message, 'error');
            setTimeout(resetButton, 2000);
        }
    });
})();
