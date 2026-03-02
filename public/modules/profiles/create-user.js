(function() {
    const nameInput = document.getElementById('profile-name');
    const jsonLabel = document.getElementById('type-json-label');
    const firebaseLabel = document.getElementById('type-firebase-label');
    const qmmLabel = document.getElementById('type-qmm-label');
    const firebaseSection = document.getElementById('firebase-section');
    const qmmSection = document.getElementById('qmm-section');
    const configInput = document.getElementById('firebase-config');
    const qmmUrlInput = document.getElementById('qmm-url');
    const qmmPasswordInput = document.getElementById('qmm-password');
    const qmmAllowSelfSignedInput = document.getElementById('qmm-allow-self-signed');
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
        clearInvalid(qmmUrlInput);
        clearInvalid(qmmPasswordInput);
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

    function normalizeUrl(rawValue) {
        let value = String(rawValue || '').trim();
        if (!value) return null;

        if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
            value = `https://${value}`;
        }

        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            parsed.hash = '';
            return parsed.toString();
        } catch (_) {
            return null;
        }
    }

    function setType(type) {
        selectedType = type;

        const labels = {
            local: jsonLabel,
            firebase: firebaseLabel,
            qmm: qmmLabel
        };

        Object.keys(labels).forEach((key) => {
            const labelEl = labels[key];
            if (!labelEl) return;

            if (key === type) {
                labelEl.classList.add('selected');
                labelEl.style.borderColor = 'var(--accent)';
                labelEl.style.background = 'rgba(137, 180, 250, 0.1)';
                const radio = labelEl.querySelector('input');
                if (radio) radio.checked = true;
            } else {
                labelEl.classList.remove('selected');
                labelEl.style.borderColor = 'var(--border)';
                labelEl.style.background = 'transparent';
            }
        });

        if (firebaseSection) {
            firebaseSection.style.display = type === 'firebase' ? 'block' : 'none';
        }

        if (qmmSection) {
            qmmSection.style.display = type === 'qmm' ? 'block' : 'none';
        }

        if (type === 'firebase' && configInput && !configInput.value.trim()) {
            configInput.value = '{}';
        }

        if (type !== 'firebase') {
            clearInvalid(configInput);
        }

        if (type !== 'qmm') {
            clearInvalid(qmmUrlInput);
            clearInvalid(qmmPasswordInput);
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

    if (jsonLabel) jsonLabel.addEventListener('click', () => setType('local'));
    if (firebaseLabel) firebaseLabel.addEventListener('click', () => setType('firebase'));
    if (qmmLabel) qmmLabel.addEventListener('click', () => setType('qmm'));
    if (permWriteBtn) permWriteBtn.addEventListener('click', () => toggleWrite(permWriteBtn));

    if (nameInput) {
        nameInput.addEventListener('input', () => clearInvalid(nameInput));
    }

    if (configInput) {
        configInput.addEventListener('input', () => clearInvalid(configInput));
    }

    if (qmmUrlInput) {
        qmmUrlInput.addEventListener('input', () => clearInvalid(qmmUrlInput));
    }

    if (qmmPasswordInput) {
        qmmPasswordInput.addEventListener('input', () => clearInvalid(qmmPasswordInput));
    }

    if (!createBtn) return;

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
        } else if (selectedType === 'qmm') {
            const normalizedUrl = normalizeUrl(qmmUrlInput ? qmmUrlInput.value : '');
            const password = qmmPasswordInput ? qmmPasswordInput.value.trim() : '';

            if (!normalizedUrl) {
                markInvalid(qmmUrlInput);
                if (qmmUrlInput) qmmUrlInput.focus();
                return;
            }

            if (!password) {
                markInvalid(qmmPasswordInput);
                if (qmmPasswordInput) qmmPasswordInput.focus();
                return;
            }

            if (qmmUrlInput) {
                qmmUrlInput.value = normalizedUrl;
            }

            config = {
                url: normalizedUrl,
                password,
                allowSelfSigned: qmmAllowSelfSignedInput ? Boolean(qmmAllowSelfSignedInput.checked) : true
            };
        }

        const isCloudProfile = selectedType === 'firebase' || selectedType === 'qmm';

        const payload = {
            name,
            type: selectedType,
            config: isCloudProfile ? config : {},
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

            if (result.cloudSync && result.cloudSync.success === false) {
                const provider = result.cloudSync.providerName || 'Cloud';
                window.notifyUser(`Profile created, but ${provider} pull failed: ${result.cloudSync.message}`, 'warning');
            } else if (result.firebaseSync && result.firebaseSync.success === false) {
                window.notifyUser('Profile created, but Firebase pull failed: ' + result.firebaseSync.message, 'warning');
            }

            nameInput.value = '';
            if (qmmPasswordInput) qmmPasswordInput.value = '';

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

    setType('local');
})();
