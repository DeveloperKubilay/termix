(function() {
    window.loadKnownHosts = async () => {
        const list = document.getElementById('known-hosts-list');
        list.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Loading...</td></tr>';

        try {
            // Use dynamically loaded API structure: window.electronAPI.knownHosts.getHosts()
            // The module name is 'known-hosts', but ipc-loader converts handler names to camelCase.
            // However, module names in ipc-loader come from folder names directly 'known-hosts'.
            // But let's check how ipc-preloader exposes them. It uses moduleName as key.
            // 'known-hosts' contains a hyphen, so in JS object it must be accessed via bracket notation or check how ipc-loader keys modules.
            
            // Let's assume ipc-loader uses folder name 'known-hosts' as key.
            // And ipc-loader camelCases the file names for methods.
            // delete-host.js -> deleteHost
            // get-hosts.js -> getHosts
            
            const hosts = await window.electronAPI['known-hosts'].getHosts();
            
            if (!hosts || hosts.length === 0) {
                list.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No known hosts found directly. Connect to a server to add one.</td></tr>';
                return;
            }

            list.innerHTML = hosts.map(host => `
                <tr>
                    <td><span style="font-weight: 500; color: var(--text-color);">${host.address}</span></td>
                    <td><span class="code-snippet">${host.port}</span></td>
                    <td>${new Date(host.firstSeen).toLocaleString()}</td>
                    <td><span class="code-snippet" title="${host.key}">${host.key.substring(0, 20)}...</span></td>
                    <td style="text-align: right;">
                        <button class="btn btn-primary btn-sm" onclick="deleteKnownHost('${host.address}', ${host.port})">
                            <i class="fas fa-trash"></i> Forget
                        </button>
                    </td>
                </tr>
            `).join('');

        } catch (err) {
            console.error(err);
            list.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ff4444;">Error loading hosts: ${err.message}</td></tr>`;
        }
    };

    window.deleteKnownHost = async (address, port) => {
        try {
            const result = await window.electronAPI['known-hosts'].deleteHost({ address, port });
            if (result.success) {
                loadKnownHosts();
            } else {
                window.notifyUser('Failed to delete host: ' + result.message, 'error');
            }
        } catch (err) {
            window.notifyUser('Error: ' + err.message, 'error');
        }
    };

    // Initial load
    loadKnownHosts();
})();
