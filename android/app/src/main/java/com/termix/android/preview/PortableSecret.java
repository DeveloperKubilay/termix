package com.termix.android.preview;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Only encrypted key material is persisted; the wrapping key never leaves Android Keystore. */
final class PortableSecret {
    private static final String ALIAS = "termix.preview.portable.v2";

    static String load(Context context) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        AtomicFile file = new AtomicFile(new File(context.getNoBackupFilesDir(), "portable-secret.v2"));
        boolean wrappedExists = file.getBaseFile().exists();
        if (!store.containsAlias(ALIAS)) {
            if (wrappedExists) {
                throw new IllegalStateException("Portable secret exists but its Keystore key is unavailable; refusing to replace it.");
            }
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build());
            generator.generateKey();
        }
        SecretKey wrappingKey = (SecretKey) store.getKey(ALIAS, null);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] secret;
        if (wrappedExists) {
            byte[] wrapped = file.readFully();
            if (wrapped.length < 1 + 12 + 16 || wrapped[0] != 1) {
                throw new IllegalStateException("Invalid wrapped portable secret.");
            }
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey,
                    new GCMParameterSpec(128, Arrays.copyOfRange(wrapped, 1, 13)));
            secret = cipher.doFinal(Arrays.copyOfRange(wrapped, 13, wrapped.length));
            if (secret.length != 48) throw new IllegalStateException("Invalid portable secret length.");
        } else {
            secret = new byte[48];
            new SecureRandom().nextBytes(secret);
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
            byte[] ciphertext = cipher.doFinal(secret);
            byte[] iv = cipher.getIV();
            if (iv.length != 12) throw new IllegalStateException("Unexpected GCM nonce length.");
            byte[] wrapped = ByteBuffer.allocate(1 + iv.length + ciphertext.length)
                    .put((byte) 1).put(iv).put(ciphertext).array();
            FileOutputStream stream = null;
            try {
                stream = file.startWrite();
                stream.write(wrapped);
                file.finishWrite(stream);
            } catch (Exception exception) {
                if (stream != null) file.failWrite(stream);
                Arrays.fill(secret, (byte) 0);
                throw exception;
            }
        }
        try {
            return Base64.encodeToString(secret, Base64.NO_WRAP);
        } finally {
            Arrays.fill(secret, (byte) 0);
        }
    }

    private PortableSecret() { }
}
