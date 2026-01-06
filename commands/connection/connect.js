module.exports = async (filesPath, hostInfo) => {
    // Burasi Backend (Main Process)
    // Gercek SSH baglantisi burada baslatilacak.
    
    console.log('[Backend] Connection request received for:', hostInfo.name);

    // Simdilik fake bir asenkron islem yapiyoruz (orn: veritabani sorgusu veya ssh handshake)
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                status: 'success',
                message: `Backend'den selam! ${hostInfo.name} (${hostInfo.username}@${hostInfo.address || 'localhost'}) ile bağlantı simülasyonu başarılı.`,
                timestamp: Date.now()
            });
        }, 1500); // 1.5 saniye bekle
    });
};
