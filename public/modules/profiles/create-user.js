(function() {
    const nameInput = document.getElementById('profile-name');
    const jsonLabel = document.getElementById('type-json-label');
    const firebaseLabel = document.getElementById('type-firebase-label');
    const firebaseSection = document.getElementById('firebase-section');
    const configInput = document.getElementById('firebase-config');
    const createBtn = document.getElementById('create-profile-btn');

    const permWriteBtn = document.getElementById('perm-write');

    let selectedType = 'local';
    let writePermission = true;

    // Toggle Storage Type
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
        } else {
            firebaseLabel.classList.add('selected');
            firebaseLabel.style.borderColor = 'var(--accent)';
            firebaseLabel.style.background = 'rgba(137, 180, 250, 0.1)';
            firebaseLabel.querySelector('input').checked = true;

            jsonLabel.classList.remove('selected');
            jsonLabel.style.borderColor = 'var(--border)';
            jsonLabel.style.background = 'transparent';

            firebaseSection.style.display = 'block';
            
            // Set default value if empty
            if (!configInput.value.trim()) {
                configInput.value = '{}';
            }
        }
    }

    jsonLabel.addEventListener('click', () => setType('local'));
    firebaseLabel.addEventListener('click', () => setType('firebase'));

    function toggleWrite(btn) {
        writePermission = !writePermission;
        if (writePermission) {
            btn.classList.add('active');
            btn.style.background = 'var(--accent)';
            btn.style.color = 'var(--bg-dark)';
        } else {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-main)';
        }
    }

    permWriteBtn.addEventListener('click', () => toggleWrite(permWriteBtn));

    // Create User Action
    createBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            alert('Please enter a user name.');
            return;
        }

        let config = {};
        if (selectedType === 'firebase') {
            try {
                config = JSON.parse(configInput.value);
            } catch (e) {
                alert('Invalid Firebase JSON configuration.');
                return;
            }
        }

        const payload = {
            name,
            type: selectedType,
            config: selectedType === 'firebase' ? config : {},
            write: selectedType === 'firebase' ? writePermission : true
        };

        try {
            // Using electronAPI exposed by ipc-preloader
            if (window.electronAPI && window.electronAPI.profiles && window.electronAPI.profiles.createProfile) {
                const result = await window.electronAPI.profiles.createProfile(payload);
                if (result.success) {
                    alert(result.message);
                    if (window.ProfileManager && window.ProfileManager.refreshProfiles) {
                        await window.ProfileManager.refreshProfiles();
                    }
                    if (result.firebaseSync && result.firebaseSync.success === false) {
                        alert('Profile created, but Firebase pull failed: ' + result.firebaseSync.message);
                    }
                    if (result.switched) {
                        window.location.reload();
                        return;
                    }
                    nameInput.value = '';
                } else {
                    alert('Error creating profile');
                }
            } else {
                console.error('Electron API not found');
                alert('System error: API not connected.');
            }
        } catch (err) {
            console.error(err);
            alert('Error creating profile: ' + err.message);
        }
    });

})();
