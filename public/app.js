document.addEventListener('DOMContentLoaded', () => {
    const hostsGrid = document.getElementById('hosts-grid');
    const btnNewHost = document.getElementById('btn-new-host');
    const rightDrawer = document.getElementById('right-drawer');
    const closeDrawer = document.getElementById('close-drawer');
    const btnTags = document.getElementById('btn-tags');
    const tagsPopup = document.getElementById('tags-popup');

    // Load Hosts
    fetch('public/hosts.json')
        .then(response => response.json())
        .then(data => {
            renderHosts(data);
        })
        .catch(error => console.error('Error loading hosts:', error));

    function renderHosts(hosts) {
        hostsGrid.innerHTML = '';
        hosts.forEach(host => {
            const card = document.createElement('div');
            card.className = 'host-card';
            
            card.innerHTML = `
                <div class="host-icon" style="background-color: ${host.color}">
                    <i class="${host.icon}"></i>
                </div>
                <div class="host-info">
                    <div class="host-name">${host.name}</div>
                    <div class="host-details">${host.protocol}, ${host.username}</div>
                </div>
            `;
            
            hostsGrid.appendChild(card);
        });
    }

    // Drawer Logic
    btnNewHost.addEventListener('click', () => {
        rightDrawer.classList.add('open');
    });

    closeDrawer.addEventListener('click', () => {
        rightDrawer.classList.remove('open');
    });

    // Tags Popup Logic
    btnTags.addEventListener('click', (e) => {
        e.stopPropagation();
        tagsPopup.classList.toggle('show');
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!tagsPopup.contains(e.target) && !btnTags.contains(e.target)) {
            tagsPopup.classList.remove('show');
        }
    });
});
