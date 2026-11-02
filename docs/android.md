# Termix Android (Bağımsız Önizleme)

Termix Android, masaüstü veya harici köprü sunucusu gerektirmeyen **tamamen bağımsız (standalone)** bir Android uygulamasıdır. SSH ve SFTP bağlantıları doğrudan mobil cihaz üzerindeki gömülü Node.js çekirdeği tarafından kurulur.

---

## Mimari ve Çalışma Prensibi

1. **Önyüz (Frontend):**
   - Vanilla HTML5 / CSS3 / JavaScript arayüzü (`public/`).
   - AndroidX `WebView` ve `WebViewAssetLoader` üzerinden özel `https://appassets.androidplatform.net/assets/web/` kökünde sunulur.
   - Dosya sistemi doğrudan WebView'a açılmaz; tüm etkileşim güvenlik kısıtlı `WebMessageListener` ile yapılır.

2. **Gömülü Çalışma Zamanı (Embedded Runtime):**
   - Node.js `v18.20.4` ARM64 / x86_64 ikilileri APK içine gömülüdür (`libnode.so` + `libtermix-runtime.so`).
   - Uygulama süreci içinde JNI aracılığıyla in-process olarak başlatılır.

3. **Güvenli IPC İletişimi:**
   - Web arayüzü ile gömülü Node backend arasındaki iletişim, uygulama özelindeki Unix domain socket (`LocalSocket` / `net.createServer`) üzerinden gerçekleştirilir.
   - Her mesaj 4-byte big-endian uzunluk öneki ile çerçevelenir ve 4 MiB sınırına tabidir.
   - UID doğrulaması (`Process.myUid()`) ile harici süreçlerin sokete bağlanması engellenir.

4. **Donanım Destekli Şifreleme (Android Keystore):**
   - Masaüstündeki `node-machine-id` bağımlılığı yerine, Android tarafında `AndroidKeyStore` (`AES/GCM/NoPadding`) ile 48-baytlık anahtar üretilir.
   - Bu anahtar `TERMIX_PORTABLE_KEY` olarak gömülü Node ortamına aktarılır ve profil parolaları AES-256 ile şifrelenir.

---

## Desteklenen ve Desteklenmeyen Özellikler

| Özellik | Android Desteği | Açıklama |
|---|---|---|
| **SSH Terminal** | ✅ Tam Destek | PTY shell, ANSI/renk, xterm.js, Unicode ve Türkçe karakter desteği. |
| **Mobil Dokunmatik Çubuk** | ✅ Tam Destek | `Ctrl`, `Esc`, `Tab`, Ok tuşları (`↑`, `↓`, `←`, `→`), `Copy`, `Paste`, `Keyboard`. |
| **Host Yönetimi** | ✅ Tam Destek | Host ekleme, düzenleme, silme, etiketleme ve yerel şifrelenmiş profilde saklama. |
| **Host Key Doğrulama** | ✅ Tam Destek | Yeni SSH sunucusu ilk bağlantıda parmak izi onayı ister ve `known_hosts` veritabanına ekler. |
| **SFTP Dosya Yönetimi** | ✅ Tam Destek | Uzak sunucu dosya listeleme, indirme/yükleme, oluşturma/silme. |
| **Profil Kalıcılığı** | ✅ Tam Destek | Uygulama kapatılıp açılsa bile anahtarlar ve host kayıtları korunur. |
| **Lokal Terminal / Serial** | ❌ Desteklenmiyor | Android sandbox kısıtları nedeniyle devre dışı bırakılmıştır. |
| **Masaüstü Güncelleyici** | ❌ Desteklenmiyor | APK güncellemeleri GitHub Releases üzerinden sağlanır. |

---

## Yerel Derleme (Local Build)

### Gereksinimler
- **Node.js:** >= 20.x
- **JDK:** Temurin JDK 17 veya 21 (`JAVA_HOME`)
- **Android SDK:** API 35 (Android 15)
- **NDK:** Sürüm `27.2.12479018`
- **CMake:** Sürüm `3.22.1`

### Derleme Adımları

1. Bağımlılıkları yükleyin:
   ```bash
   npm ci
   ```
   Android paketlerini ayrı lock dosyasındaki sürümlerle yükleyin. Yerel native
   eklentiler Android paketine alınmadığından kurulum scriptleri ve isteğe bağlı
   bağımlılıklar çalıştırılmaz:
   ```bash
   npm ci --prefix util/android --ignore-scripts --omit=optional
   ```

2. Birim ve sözleşme testlerini çalıştırın:
   ```bash
   npm run android:test
   ```

3. Doğrulanmış Node.js çalışma zamanını temin edin:
   ```bash
   npm run android:runtime:preview
   ```

4. Web varlıklarını ve backend modüllerini hazırlayın:
   ```bash
   npm run android:prepare
   ```

5. Android APK çıktısı üretin:
   ```bash
   npm run android:build:preview
   ```

Çıktı APK dosyası: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Fiziksel Cihazda Yükleme ve Test

ADB ile bağlı telefona kurmak için:
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.termix.android.preview/.MainActivity
```

---

## Donanım ve Sayfa Boyutu Notu (16 KB Kernel Uyumluluğu)
- Mevcut `nodejs-mobile` resmi ikilileri 4 KB sayfa boyutuyla derlenmiştir.
- Samsung Galaxy S21 FE 5G ve birçok mevcut cihaz 4 KB sayfa boyutu (`ro.boot.hardware.cpu.pagesize = 4096`) kullandığından sorunsuz çalışır.
- Derleme betiğinde `-PtermixAllowEolRuntime=true` bayrağı açıkça talep edilmektedir.

---

## GitHub Actions Otomasyonu
`.github/workflows/android.yml` yalnız manuel `workflow_dispatch` ile çalışır. ARM64 ve x86_64 içeren tek debug APK üretir ve `termix-android-preview-apk` adıyla 14 gün saklanan artifact olarak sunar.

Başarılı derlemeden sonra ayrı yayınlama işi, GitHub'ın mevcut Latest release'ini kontrol eder. Release yayımlanmış/stable olmalı; `latest.yml`, `latest-linux.yml`, `latest-mac.yml` ve Windows/Linux/macOS paketlerini içermelidir. Uygun release yoksa yayınlama başarısız olur; oluşturulmuş Actions artifact'i korunur.

APK, masaüstü release sürümü ve Android workflow'unun kendi çalışma numarasıyla adlandırılır: `Termix-android-v1.0.60.12.apk`. Sonraki Android çalışması `.13.apk` üretir; aynı çalışmayı yeniden denemek numarayı değiştirmez. Aynı adlı dosya varsa üzerine yazılmadan yayınlama durdurulur. Yeni release oluşturulmaz; etiket, Latest durumu, masaüstü paketleri ve güncelleme metadata dosyaları değiştirilmez. Dosya adı Android uygulamasının iç sürümünü değiştirmez.

Yalnız yayınlama işine `contents: write` izni verilir. Workflow'u manuel çalıştırmak APK'nın mevcut release'e yayımlanmasını da başlatır.
