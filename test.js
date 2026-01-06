var firebase = require("firebase/app");
var firestore = require("firebase/firestore");

let firebaseConfig = {}
// Başlatıyoruz
var app = firebase.initializeApp(firebaseConfig);
var db = firestore.getFirestore(app);

// Test Koleksiyonu
var COLLECTION_NAME = "test_db_dump";

console.log("🔥 Bağlantı fena, operasyon başlıyor...");

// 1. Yaz (Write)
var yeniVeri = {
    olay: "Test sürüşü",
    tarih: new Date().toString(),
    not: "Bu veri yok olacak"
};

firestore.addDoc(firestore.collection(db, COLLECTION_NAME), yeniVeri)
    .then(function(docRef) {
        console.log("✍️  Veriyi sapladık, ID bu: " + docRef.id);

        // 2. Hepsini Çek (Read All)
        console.log("👀 Tüm DB'yi (koleksiyonu) çekiyorum...");
        return firestore.getDocs(firestore.collection(db, COLLECTION_NAME))
            .then(function(querySnapshot) {
                if (querySnapshot.empty) {
                    console.log("📭 Bomboş buralar.");
                } else {
                    querySnapshot.forEach(function(doc) {
                        console.log("📄 [Bulundu] " + doc.id + " => ", doc.data());
                    });
                }
                 return docRef; // Zincire ID'yi pasla
            });
    })
    .then(function(docRef) {
        // 3. Sil (Delete)
        console.log("🗑️  Şimdi o veriyi uçuruyorum: " + docRef.id);
      //  return firestore.deleteDoc(firestore.doc(db, COLLECTION_NAME, docRef.id));
    })
    .then(function() {
        console.log("✨ Temizlik bitti, iz kalmadı. Hadi eyvallah.");
        // process.exit(0); // Node processini bitir
    })
    .catch(function(err) {
        console.error("💀 Patladık kanka: ", err);
    });