package com.termix.android.preview;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.net.Uri;
import android.os.Process;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Process-owned SAF document handle store and direct Unix-domain socket streaming bridge.
 * All file bytes stream directly between Android SAF ContentResolver and backend t.sock.
 * No intermediate staging copies of files are created on disk or in memory.
 */
public final class DocumentTransfers {
    private static final String TAG = "DocumentTransfers";

    private static final int BUFFER_SIZE = 128 * 1024; // 128 KiB buffer
    private static final int MAX_HANDSHAKE_HEADER = 4096;
    private static final int SOCKET_IDLE_TIMEOUT_MS = 120_000; // 120 seconds idle timeout
    private static final long HANDLE_TTL_MS = 15 * 60 * 1000L; // 15 minutes TTL for unconsumed handles
    private static final String JOURNAL_FILE = "saf-created-docs.journal";

    public interface Callback {
        void onSuccess(JSONObject result);
        void onError(String error);
    }

    public static final class PickResult {
        public final boolean success;
        public final String handle;
        public final String name;
        public final Long size; // null if unknown

        public PickResult(boolean success, String handle, String name, Long size) {
            this.success = success;
            this.handle = handle;
            this.name = name;
            this.size = size;
        }

        public JSONObject toJsonObject() {
            try {
                JSONObject json = new JSONObject();
                json.put("success", success);
                json.put("handle", handle);
                json.put("name", name);
                if (size != null) {
                    json.put("size", size.longValue());
                } else {
                    json.put("size", JSONObject.NULL);
                }
                return json;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }

    public static final class CreateDocResult {
        public final boolean success;
        public final String handle;
        public final String name;

        public CreateDocResult(boolean success, String handle, String name) {
            this.success = success;
            this.handle = handle;
            this.name = name;
        }

        public JSONObject toJsonObject() {
            try {
                JSONObject json = new JSONObject();
                json.put("success", success);
                json.put("handle", handle);
                json.put("name", name);
                return json;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }

    private static final class ManagedDoc {
        final String handle;
        final String direction; // "upload" | "download"
        final Uri uri;
        final String name;
        final Long size; // known upload size or null
        final long createdAt;
        final boolean isCreatedDocument; // true if created via ACTION_CREATE_DOCUMENT

        ManagedDoc(String handle, String direction, Uri uri, String name, Long size, boolean isCreatedDocument) {
            this.handle = handle;
            this.direction = direction;
            this.uri = uri;
            this.name = name;
            this.size = size;
            this.createdAt = System.currentTimeMillis();
            this.isCreatedDocument = isCreatedDocument;
        }
    }

    private static final class ActiveTransfer {
        final String transferId;
        final String handle;
        final String direction;
        final ManagedDoc doc;
        final Future<?> future;
        final LocalSocket socket;
        volatile boolean cancelled;

        ActiveTransfer(String transferId, String handle, String direction, ManagedDoc doc, Future<?> future, LocalSocket socket) {
            this.transferId = transferId;
            this.handle = handle;
            this.direction = direction;
            this.doc = doc;
            this.future = future;
            this.socket = socket;
        }
    }

    private final Context context;
    private final Map<String, ManagedDoc> handles = new ConcurrentHashMap<>();
    private final Map<String, ActiveTransfer> activeTransfers = new ConcurrentHashMap<>();
    // Bounded executor max 2 concurrent direct streams
    private final ExecutorService streamExecutor = Executors.newFixedThreadPool(2, runnable -> new Thread(runnable, "termix-transfer-stream"));
    private final Object journalLock = new Object();

    public DocumentTransfers(Context context) {
        this.context = context.getApplicationContext();
        cleanupStaleCreatedDocsOnStartup();
        cleanupLegacyStagingDirectories();
    }

    /**
     * Registers a picked upload file URI and returns {success:true, handle, name, size}.
     */
    public PickResult registerUploadUri(Uri uri, int flags) {
        if (uri == null) throw new IllegalArgumentException("URI cannot be null");
        pruneExpiredHandles();

        // Persist URI permission when available flags passed
        tryPersistUriPermission(uri, flags);

        String name = "upload";
        Long size = null;
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                    name = cursor.getString(nameIdx);
                }
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                    long val = cursor.getLong(sizeIdx);
                    if (val >= 0) size = val;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to query metadata for upload URI: " + e.getMessage());
        }

        if (name == null || name.trim().isEmpty()) name = "upload";
        name = name.replaceAll("[/\\\\:*?\"<>|\\x00-\\x1F]", "_").trim();
        if (name.isEmpty()) name = "upload";

        String handle = "doc-up-" + UUID.randomUUID().toString();
        ManagedDoc doc = new ManagedDoc(handle, "upload", uri, name, size, false);
        handles.put(handle, doc);

        return new PickResult(true, handle, name, size);
    }

    /**
     * Registers a created download document URI and returns {success:true, handle, name}.
     */
    public CreateDocResult registerDownloadUri(Uri uri, String name, int flags) {
        if (uri == null) throw new IllegalArgumentException("URI cannot be null");
        pruneExpiredHandles();

        // Persist URI permission when available flags passed
        tryPersistUriPermission(uri, flags);

        if (name == null || name.trim().isEmpty()) {
            name = "download";
            try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        name = cursor.getString(nameIdx);
                    }
                }
            } catch (Exception ignored) {}
        }
        name = name.replaceAll("[/\\\\:*?\"<>|\\x00-\\x1F]", "_").trim();
        if (name.isEmpty()) name = "download";

        String handle = "doc-dl-" + UUID.randomUUID().toString();
        ManagedDoc doc = new ManagedDoc(handle, "download", uri, name, null, true);
        handles.put(handle, doc);

        // Record in atomic journal
        addJournalEntry(handle, uri.toString(), name);

        return new CreateDocResult(true, handle, name);
    }

    private void tryPersistUriPermission(Uri uri, int flags) {
        if (uri == null) return;
        int takeFlags = flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (takeFlags != 0) {
            try {
                context.getContentResolver().takePersistableUriPermission(uri, takeFlags);
            } catch (SecurityException ignored) {
                // Provider doesn't support persistable permissions; transient permission is still valid
            } catch (Exception e) {
                Log.w(TAG, "Cannot take persistable URI permission: " + e.getMessage());
            }
        }
    }

    /**
     * Executes native:transfer-run over Unix socket t.sock.
     */
    public void runTransfer(JSONObject options, Callback callback) {
        pruneExpiredHandles();
        try {
            String handle = options.getString("handle");
            String transferId = options.getString("transferId");
            String socketPathStr = options.getString("socketPath");
            String token = options.getString("token");
            String direction = options.getString("direction");

            ManagedDoc doc = handles.get(handle);
            if (doc == null) {
                callback.onError("Transfer handle not found or expired.");
                return;
            }

            if (!direction.equals(doc.direction)) {
                callback.onError("Direction mismatch between handle and prepare result.");
                return;
            }

            File expectedSocket = new File(context.getFilesDir(), "t.sock");
            File givenSocket = new File(socketPathStr);
            if (!givenSocket.getCanonicalFile().equals(expectedSocket.getCanonicalFile())) {
                callback.onError("Invalid socket path: must match private application t.sock.");
                return;
            }

            LocalSocket localSocket = new LocalSocket();
            ActiveTransfer[] transferRef = new ActiveTransfer[1];

            Future<?> future = streamExecutor.submit(() -> {
                boolean success = false;
                long totalBytes = 0;
                String failureMessage = null;

                try {
                    localSocket.connect(new LocalSocketAddress(expectedSocket.getAbsolutePath(), LocalSocketAddress.Namespace.FILESYSTEM));
                    localSocket.setSoTimeout(SOCKET_IDLE_TIMEOUT_MS);

                    if (localSocket.getPeerCredentials().getUid() != Process.myUid()) {
                        throw new SecurityException("Local socket peer UID does not match application UID.");
                    }

                    // Handshake frame: 4-byte BE JSON byte length <= 4096, UTF-8 JSON {transferId, token, direction}
                    JSONObject handshakeObj = new JSONObject();
                    handshakeObj.put("transferId", transferId);
                    handshakeObj.put("token", token);
                    handshakeObj.put("direction", direction);
                    byte[] handshakeBytes = handshakeObj.toString().getBytes(StandardCharsets.UTF_8);
                    if (handshakeBytes.length > MAX_HANDSHAKE_HEADER) {
                        throw new IOException("Handshake JSON exceeds maximum frame size 4096.");
                    }

                    DataOutputStream socketOut = new DataOutputStream(localSocket.getOutputStream());
                    DataInputStream socketIn = new DataInputStream(localSocket.getInputStream());

                    socketOut.writeInt(handshakeBytes.length);
                    socketOut.write(handshakeBytes);
                    socketOut.flush();

                    // Read backend response: 4-byte BE JSON length
                    JSONObject backendReply = readFramedJson(socketIn);
                    if (!backendReply.optBoolean("success", false)) {
                        String errMsg = backendReply.optString("error", "Backend handshake rejected.");
                        throw new IOException(errMsg);
                    }

                    if ("upload".equals(direction)) {
                        totalBytes = streamUpload(doc.uri, localSocket, socketOut, socketIn, transferRef[0]);
                    } else if ("download".equals(direction)) {
                        long expectedSize = backendReply.optLong("size", -1);
                        totalBytes = streamDownload(doc.uri, socketIn, socketOut, expectedSize, transferRef[0]);
                    } else {
                        throw new IllegalArgumentException("Unknown direction: " + direction);
                    }

                    success = true;
                } catch (Throwable t) {
                    if (transferRef[0] != null && transferRef[0].cancelled) {
                        failureMessage = "Transfer cancelled.";
                    } else {
                        failureMessage = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
                        Log.e(TAG, "Transfer " + transferId + " (" + direction + ") failed", t);
                    }
                } finally {
                    try { localSocket.close(); } catch (Exception ignored) {}
                    activeTransfers.remove(transferId);
                    handles.remove(handle);

                    if (success) {
                        // If download succeeded cleanly, remove from atomic journal
                        if ("download".equals(direction)) {
                            removeJournalEntry(handle);
                        }
                        try {
                            JSONObject res = new JSONObject();
                            res.put("success", true);
                            res.put("bytes", totalBytes);
                            callback.onSuccess(res);
                        } catch (Exception e) {
                            callback.onError(e.getMessage());
                        }
                    } else {
                        // Failed or cancelled download cleanup
                        if ("download".equals(direction) && doc.isCreatedDocument) {
                            boolean deleted = safelyDeleteDocumentUri(doc.uri);
                            if (deleted) {
                                removeJournalEntry(handle);
                            }
                            Log.w(TAG, "Cleaned up failed/cancelled download document (deleted=" + deleted + "): " + doc.uri);
                        }
                        callback.onError(failureMessage != null ? failureMessage : "Transfer failed.");
                    }
                }
            });

            ActiveTransfer activeTransfer = new ActiveTransfer(transferId, handle, direction, doc, future, localSocket);
            transferRef[0] = activeTransfer;
            activeTransfers.put(transferId, activeTransfer);

        } catch (Exception e) {
            callback.onError("Failed to initiate transfer: " + e.getMessage());
        }
    }

    private long streamUpload(Uri uri, LocalSocket socket, DataOutputStream socketOut, DataInputStream socketIn, ActiveTransfer active) throws IOException {
        long totalBytes = 0;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Cannot open SAF input stream for URI: " + uri);
            byte[] buf = new byte[BUFFER_SIZE];
            int read;
            while ((read = in.read(buf)) != -1) {
                if (active != null && active.cancelled) throw new IOException("Transfer cancelled.");
                socketOut.write(buf, 0, read);
                totalBytes += read;
            }
            socketOut.flush();
        }

        // Half-close write side
        socket.shutdownOutput();

        // Wait for final backend confirmation
        JSONObject finalReply = readFramedJson(socketIn);
        if (!finalReply.optBoolean("success", false)) {
            throw new IOException(finalReply.optString("error", "Backend upload commit failed."));
        }
        return totalBytes;
    }

    private long streamDownload(Uri uri, DataInputStream socketIn, DataOutputStream socketOut, long expectedSize, ActiveTransfer active) throws IOException {
        long totalBytes = 0;
        try (OutputStream out = context.getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException("Cannot open SAF output stream for URI: " + uri);
            byte[] buf = new byte[BUFFER_SIZE];

            if (expectedSize >= 0) {
                long remaining = expectedSize;
                while (remaining > 0) {
                    if (active != null && active.cancelled) throw new IOException("Transfer cancelled.");
                    int toRead = (int) Math.min(buf.length, remaining);
                    int read = socketIn.read(buf, 0, toRead);
                    if (read == -1) {
                        throw new IOException("Unexpected EOF while reading download data. Expected " + expectedSize + " bytes, received " + totalBytes);
                    }
                    out.write(buf, 0, read);
                    totalBytes += read;
                    remaining -= read;
                }
            } else {
                int read;
                while ((read = socketIn.read(buf)) != -1) {
                    if (active != null && active.cancelled) throw new IOException("Transfer cancelled.");
                    out.write(buf, 0, read);
                    totalBytes += read;
                }
            }
            out.flush();
        }

        // Send framed confirmation to backend: {success:true, bytes}
        JSONObject clientAck = new JSONObject();
        try {
            clientAck.put("success", true);
            clientAck.put("bytes", totalBytes);
        } catch (Exception ignored) {}
        byte[] ackBytes = clientAck.toString().getBytes(StandardCharsets.UTF_8);
        socketOut.writeInt(ackBytes.length);
        socketOut.write(ackBytes);
        socketOut.flush();

        // Wait for final ack from backend
        JSONObject finalReply = readFramedJson(socketIn);
        if (!finalReply.optBoolean("success", false)) {
            throw new IOException(finalReply.optString("error", "Backend download finalization failed."));
        }
        return totalBytes;
    }

    private static JSONObject readFramedJson(DataInputStream in) throws IOException {
        int length = in.readInt();
        if (length <= 0 || length > MAX_HANDSHAKE_HEADER) {
            throw new IOException("Framed JSON length out of bounds: " + length);
        }
        byte[] bytes = new byte[length];
        in.readFully(bytes);
        try {
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IOException("Malformed framed JSON response: " + e.getMessage(), e);
        }
    }

    /**
     * Cancels transfer by transferId or handle.
     * Closes socket, interrupts thread, deletes incomplete created document if download.
     * Also releases unstarted handle if backend prepare failed or cancelled.
     */
    public boolean cancelTransfer(String idOrHandle) {
        if (idOrHandle == null || idOrHandle.isEmpty()) return false;

        // 1. Check if active transfer
        ActiveTransfer active = activeTransfers.get(idOrHandle);
        if (active == null) {
            for (ActiveTransfer a : activeTransfers.values()) {
                if (idOrHandle.equals(a.handle)) {
                    active = a;
                    break;
                }
            }
        }

        if (active != null) {
            active.cancelled = true;
            try { active.socket.close(); } catch (Exception ignored) {}
            active.future.cancel(true);
            activeTransfers.remove(active.transferId);
            handles.remove(active.handle);
            if ("download".equals(active.direction) && active.doc.isCreatedDocument) {
                boolean deleted = safelyDeleteDocumentUri(active.doc.uri);
                if (deleted) removeJournalEntry(active.handle);
                Log.w(TAG, "Cancelled active download transfer; safely deleted document: " + active.doc.uri);
            }
            return true;
        }

        // 2. Check if unstarted handle
        ManagedDoc doc = handles.remove(idOrHandle);
        if (doc != null) {
            if ("download".equals(doc.direction) && doc.isCreatedDocument) {
                boolean deleted = safelyDeleteDocumentUri(doc.uri);
                if (deleted) removeJournalEntry(doc.handle);
                Log.w(TAG, "Cancelled unstarted download handle; safely deleted document: " + doc.uri);
            }
            return true;
        }

        return false;
    }

    /**
     * Cancels all native direct streams on runtime disconnect.
     */
    public void cancelAll() {
        for (String transferId : activeTransfers.keySet()) {
            cancelTransfer(transferId);
        }
        for (String handle : handles.keySet()) {
            cancelTransfer(handle);
        }
    }

    private void pruneExpiredHandles() {
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<String, ManagedDoc>> it = handles.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, ManagedDoc> entry = it.next();
            ManagedDoc doc = entry.getValue();
            if (now - doc.createdAt > HANDLE_TTL_MS) {
                it.remove();
                if ("download".equals(doc.direction) && doc.isCreatedDocument) {
                    boolean deleted = safelyDeleteDocumentUri(doc.uri);
                    if (deleted) removeJournalEntry(doc.handle);
                    Log.w(TAG, "Expired unstarted download handle pruned; deleted document: " + doc.uri);
                }
            }
        }
    }

    private boolean safelyDeleteDocumentUri(Uri uri) {
        if (uri == null) return false;
        try {
            return DocumentsContract.deleteDocument(context.getContentResolver(), uri);
        } catch (Exception e) {
            Log.w(TAG, "DocumentsContract.deleteDocument failed for " + uri + ": " + e.getMessage());
            return false;
        }
    }

    private void addJournalEntry(String handle, String uriStr, String name) {
        synchronized (journalLock) {
            try {
                JSONArray array = readJournalEntries();
                JSONObject entry = new JSONObject();
                entry.put("handle", handle);
                entry.put("uri", uriStr);
                entry.put("name", name);
                entry.put("createdAt", System.currentTimeMillis());
                array.put(entry);
                writeJournalEntries(array);
            } catch (Exception e) {
                Log.e(TAG, "Failed to add journal entry: " + e.getMessage(), e);
            }
        }
    }

    private void removeJournalEntry(String handle) {
        synchronized (journalLock) {
            try {
                JSONArray array = readJournalEntries();
                JSONArray newArray = new JSONArray();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.optJSONObject(i);
                    if (obj != null && !handle.equals(obj.optString("handle"))) {
                        newArray.put(obj);
                    }
                }
                writeJournalEntries(newArray);
            } catch (Exception e) {
                Log.e(TAG, "Failed to remove journal entry: " + e.getMessage(), e);
            }
        }
    }

    private JSONArray readJournalEntries() {
        AtomicFile file = new AtomicFile(new File(context.getNoBackupFilesDir(), JOURNAL_FILE));
        if (!file.getBaseFile().exists()) return new JSONArray();
        try {
            byte[] bytes = file.readFully();
            if (bytes.length == 0) return new JSONArray();
            return new JSONArray(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "Failed to read journal file: " + e.getMessage());
            return new JSONArray();
        }
    }

    private void writeJournalEntries(JSONArray array) {
        AtomicFile file = new AtomicFile(new File(context.getNoBackupFilesDir(), JOURNAL_FILE));
        FileOutputStream fos = null;
        try {
            fos = file.startWrite();
            byte[] bytes = array.toString().getBytes(StandardCharsets.UTF_8);
            fos.write(bytes);
            file.finishWrite(fos);
        } catch (Exception e) {
            if (fos != null) file.failWrite(fos);
            Log.e(TAG, "Failed to write journal file: " + e.getMessage(), e);
        }
    }

    /**
     * Cleans up unfinalized created documents recorded in the atomic journal on startup.
     */
    private void cleanupStaleCreatedDocsOnStartup() {
        new Thread(() -> {
            synchronized (journalLock) {
                try {
                    JSONArray array = readJournalEntries();
                    if (array.length() == 0) return;
                    JSONArray remaining = new JSONArray();
                    for (int i = 0; i < array.length(); i++) {
                        JSONObject entry = array.optJSONObject(i);
                        if (entry == null) continue;
                        String uriStr = entry.optString("uri");
                        if (uriStr != null && !uriStr.isEmpty()) {
                            try {
                                Uri uri = Uri.parse(uriStr);
                                boolean deleted = safelyDeleteDocumentUri(uri);
                                if (!deleted) {
                                    // If deletion failed (e.g. permission revoked or provider offline), preserve in journal
                                    remaining.put(entry);
                                }
                            } catch (Exception e) {
                                remaining.put(entry);
                            }
                        }
                    }
                    writeJournalEntries(remaining);
                } catch (Exception e) {
                    Log.w(TAG, "Startup journal cleanup encountered error: " + e.getMessage());
                }
            }
        }, "termix-journal-cleanup").start();
    }

    /**
     * Confined migration cleanup for old dedicated staging directory data/local/staging.
     * No symlinks followed; keys, config, and other user data are untouched.
     */
    private void cleanupLegacyStagingDirectories() {
        new Thread(() -> {
            try {
                File stagingRoot = new File(context.getFilesDir(), "data/local/staging");
                if (!stagingRoot.exists() || !stagingRoot.isDirectory()) return;

                Path stagingPath = stagingRoot.toPath().toAbsolutePath().normalize();
                if (Files.isSymbolicLink(stagingPath)) {
                    Log.w(TAG, "Legacy staging root is a symbolic link; skipping cleanup.");
                    return;
                }

                // Recursively delete contents of data/local/staging without following symlinks
                deleteDirectoryConfined(stagingPath, stagingPath);
            } catch (Exception e) {
                Log.w(TAG, "Legacy staging cleanup failed: " + e.getMessage());
            }
        }, "termix-staging-cleanup").start();
    }

    private static void deleteDirectoryConfined(Path root, Path dir) {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path entry : stream) {
                if (Files.isSymbolicLink(entry)) {
                    Files.deleteIfExists(entry);
                    continue;
                }
                if (Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) {
                    deleteDirectoryConfined(root, entry);
                    Files.deleteIfExists(entry);
                } else {
                    Files.deleteIfExists(entry);
                }
            }
        } catch (Exception ignored) {}
    }
}
