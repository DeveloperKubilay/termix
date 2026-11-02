# Termix Gizlilik Politikası

**Son güncelleme: 2 Kasım 2026**

Termix, güvenliği ve gizliliği ön planda tutan, yerel çalışma esasına dayalı açık kaynaklı bir SSH ve SFTP uygulamasıdır. Temel yaklaşımı, bağlantı bilgilerinizi ve uygulama verilerinizi kendi kontrolünüzde tutmaktır. Bu politika Termix'in masaüstü ve Android sürümlerini kapsar.

## Yerel çalışma ve veri gizliliği

**Termix, bilgilerinizi kendisine veya geliştiricilerine ait sunuculara göndermez; bu bilgileri toplamaz ve kendi amaçları için kullanmaz.** Yerel kullanımda bağlantı bilgileriniz, parolalarınız, SSH anahtarlarınız ve uygulama ayarlarınız cihazınızda kalır.

SSH ve SFTP işlemleri, cihazınız ile bağlanmayı seçtiğiniz sunucular arasında gerçekleştirilir. Termix, bu bağlantılar için geliştiricilere ait bir aracı sunucu kullanılmasını gerektirmez.

Yerel saklama, tüm verilerin ayrıca şifrelendiği anlamına gelmez. Cihazınızın ve işletim sistemi hesabınızın güvenliğini korumanız önemlidir.

## İsteğe bağlı üçüncü taraf hizmetler

Termix, **QMM ve Firebase entegrasyonlarını** destekler. Bu özelliklerin kullanılması zorunlu değildir; siz yapılandırmadığınız sürece etkinleşmez.

Bu hizmetleri bağlamanız durumunda ilgili özellik için gereken bilgiler, seçtiğiniz hizmetle paylaşılır. Bu sistemler Termix tarafından sağlanan merkezi bir bulut hizmeti değildir.

Üçüncü taraf hizmetlerin verileri nasıl sakladığı, işlediği ve koruduğu kendi koşullarına ve yapılandırmalarına bağlıdır. **Bu hizmetlerin kendi veri işleme, saklama ve güvenlik uygulamalarından Termix sorumlu değildir.** Bu açıklama, yürürlükteki mevzuattan doğan sorumlulukları ortadan kaldırmaz.

## Diğer isteğe bağlı bağlantılar ve güncellemeler

Harici bir yapay zekâ sağlayıcısını kullanmayı seçerseniz, ilgili özellikte gönderdiğiniz içerik yapılandırdığınız sağlayıcıya iletilir ve o sağlayıcının gizlilik koşullarına tabi olur. Gizli bilgileri göndermeden önce paylaştığınız içeriği kontrol edin.

Güncelleme kontrolü ve indirme işlemleri GitHub veya ilgili dağıtım hizmetleriyle ağ bağlantısı kurulmasını gerektirebilir. Bu hizmetler, IP adresi gibi standart bağlantı bilgilerini kendi gizlilik koşulları kapsamında işleyebilir.

Bu bağlantılar, yerel verilerinizin Termix geliştiricilerine ait bir sunucuya yüklenmesi anlamına gelmez.

## Verilerinizin kontrolü

Kayıtlı bilgilerinizi uygulama üzerinden yönetebilir ve silebilirsiniz. Üçüncü taraf bir hizmete aktardığınız verileri ise ilgili hizmet üzerinden ayrıca yönetmeniz gerekebilir. Yerel verileri silmek, harici hizmetlerdeki kopyaları otomatik olarak silmez.

## Açık kaynak ve iletişim

Termix'in kaynak kodu incelemeye açıktır. Gizlilikle ilgili sorularınız için proje deposundan iletişime geçebilirsiniz. Herkese açık destek kayıtlarında parola veya özel anahtar paylaşmayın.

**Proje ve iletişim:** [github.com/DeveloperKubilay/termix](https://github.com/DeveloperKubilay/termix)

Bu politika, uygulamanın özellikleri veya veri işleme biçimi değiştiğinde güncellenebilir. Güncel metnin tarihi yukarıda belirtilir.
