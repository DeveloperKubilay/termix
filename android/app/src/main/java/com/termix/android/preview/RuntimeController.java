package com.termix.android.preview;

import android.content.Context;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Process-owned Node lifecycle and private, bounded length-prefixed JSON transport. */
final class RuntimeController {
    static final int MAX_FRAME = 4 * 1024 * 1024;
    interface Listener {
        void onStatus(String text, boolean failed);
        void onMessage(String json);
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean started = new AtomicBoolean();
    private final ThreadPoolExecutor writer = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(256), runnable -> new Thread(runnable, "termix-socket-write"));
    private final ArrayDeque<String> pending = new ArrayDeque<>();
    private volatile DataOutputStream output;
    private volatile LocalSocket socket;
    private volatile boolean nodeExited;
    // The following fields are confined to the main thread.
    private Listener listener;
    private String status = "Preparing embedded runtime…";
    private boolean failed;
    private String ready;

    RuntimeController(Context context) { this.context = context.getApplicationContext(); }

    void start() {
        if (!started.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                File entry = BackendAssets.prepare(context);
                File data = new File(context.getFilesDir(), "data");
                if (!data.isDirectory() && !data.mkdirs()) throw new IOException("Cannot create private data directory.");
                File socketPath = new File(context.getFilesDir(), "n.sock");
                if (socketPath.getAbsolutePath().getBytes(StandardCharsets.UTF_8).length > 100) {
                    throw new IOException("Private socket path exceeds Unix-domain socket limit.");
                }
                if (socketPath.exists() && !socketPath.delete()) throw new IOException("Cannot remove stale private socket.");
                String key = PortableSecret.load(context);
                System.loadLibrary("termix-runtime");
                publishStatus("Starting embedded Node…", false);
                new Thread(() -> {
                    try {
                        int result = nativeStart(entry.getAbsolutePath(), data.getAbsolutePath(), key,
                                socketPath.getAbsolutePath(), context.getCacheDir().getAbsolutePath());
                        publishStatus("Embedded Node stopped (" + result + "). Close and reopen the app to restart.", true);
                    } catch (Throwable exception) {
                        Log.e("TermixRuntime", "Embedded Node launch failed", exception);
                        publishStatus("Embedded Node launch failed: " + safeMessage(exception), true);
                    } finally {
                        nodeExited = true;
                        closeSocket();
                    }
                }, "termix-node").start();
                connect(socketPath);
            } catch (Throwable exception) {
                Log.e("TermixRuntime", "Runtime startup failed", exception);
                publishStatus("Runtime startup failed: " + safeMessage(exception), true);
            }
        }, "termix-runtime-prepare").start();
    }

    void attach(Listener value) {
        listener = value;
        value.onStatus(status, failed);
        if (ready != null) value.onMessage(ready);
        while (!pending.isEmpty()) value.onMessage(pending.removeFirst());
    }

    void detach(Listener value) { if (listener == value) listener = null; }

    void send(String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > MAX_FRAME) {
            reject(json, "FRAME_TOO_LARGE", "Bridge frame exceeds the 4 MiB limit.");
            return;
        }
        if (output == null || nodeExited) {
            reject(json, "RUNTIME_UNAVAILABLE", "Embedded runtime is not connected.");
            return;
        }
        try {
            writer.execute(() -> {
                try {
                    DataOutputStream stream = output;
                    if (stream == null) throw new IOException("Runtime socket disconnected.");
                    stream.writeInt(bytes.length);
                    stream.write(bytes);
                    stream.flush();
                } catch (IOException exception) {
                    reject(json, "RUNTIME_DISCONNECTED", safeMessage(exception));
                    closeSocket();
                    publishStatus("Runtime transport failed: " + safeMessage(exception), true);
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException exception) {
            reject(json, "BRIDGE_BUSY", "Native bridge queue is full.");
        }
    }

    private void connect(File socketPath) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        LocalSocket connected = null;
        IOException last = null;
        while (System.nanoTime() < deadline && !nodeExited) {
            LocalSocket attempt = new LocalSocket();
            try {
                attempt.connect(new LocalSocketAddress(socketPath.getAbsolutePath(), LocalSocketAddress.Namespace.FILESYSTEM));
                if (attempt.getPeerCredentials().getUid() != Process.myUid()) throw new IOException("Unexpected runtime socket peer UID.");
                connected = attempt;
                break;
            } catch (IOException exception) {
                last = exception;
                attempt.close();
                Thread.sleep(100);
            }
        }
        if (connected == null) throw new IOException("Embedded Node did not open its private socket within 30 seconds.", last);
        socket = connected;
        output = new DataOutputStream(connected.getOutputStream());
        publishStatus("Private runtime transport connected; waiting for backend ready…", false);
        try (DataInputStream input = new DataInputStream(connected.getInputStream())) {
            while (true) {
                int length = input.readInt();
                if (length <= 0 || length > MAX_FRAME) throw new IOException("Invalid backend frame length: " + length);
                byte[] bytes = new byte[length];
                input.readFully(bytes);
                String json = new String(bytes, StandardCharsets.UTF_8);
                JSONObject frame = new JSONObject(json);
                if ("ready".equals(frame.optString("type"))) {
                    if (frame.optInt("protocol") != 1) throw new IOException("Unsupported backend bridge protocol.");
                    publishStatus("Embedded runtime ready · local 4 KB feasibility preview", false);
                }
                deliver(json);
            }
        } finally {
            closeSocket();
            publishStatus("Runtime transport disconnected. Close and reopen the app to restart.", true);
        }
    }

    private void closeSocket() {
        main.post(() -> {
            ready = null;
            pending.clear();
            TermixService.updateState(context, 0, 0, 0);
            if (listener != null) listener.onMessage("{\"type\":\"event\",\"channel\":\"runtime:disconnected\",\"payload\":{\"message\":\"Runtime disconnected; process restart required\"}}");
        });
        output = null;
        LocalSocket old = socket;
        socket = null;
        if (old != null) try { old.close(); } catch (IOException ignored) { }
    }

    void stopAllConnections() {
        send("{\"type\":\"request\",\"id\":\"service-stop-all\",\"channel\":\"android:stop-all-connections\",\"args\":[]}");
    }

    private void publishStatus(String text, boolean failure) {
        main.post(() -> {
            status = text;
            failed = failure;
            if (listener != null) listener.onStatus(text, failure);
        });
    }

    private void deliver(String json) {
        main.post(() -> {
            try {
                JSONObject obj = new JSONObject(json);
                if ("ready".equals(obj.optString("type"))) ready = json;
                if ("event".equals(obj.optString("type")) && "android:service-state".equals(obj.optString("channel"))) {
                    JSONObject payload = obj.optJSONObject("payload");
                    if (payload != null) {
                        int terminals = payload.optInt("terminals", 0);
                        int sftp = payload.optInt("sftp", 0);
                        int transfers = payload.optInt("transfers", 0);
                        TermixService.updateState(context, terminals, sftp, transfers);
                    }
                }
            } catch (Exception ignored) { }
            if (listener != null) listener.onMessage(json);
            else if (ready == null || !ready.equals(json)) {
                // Keep recent events up to bounded limit while there is no foreground WebView.
                if (pending.size() >= 512) pending.removeFirst();
                pending.addLast(json);
            }
        });
    }

    private void reject(String request, String code, String message) {
        try {
            JSONObject frame = new JSONObject(request);
            if (!"request".equals(frame.optString("type"))) return;
            JSONObject error = new JSONObject().put("message", message).put("code", code);
            deliver(new JSONObject().put("type", "response").put("id", frame.get("id")).put("error", error).toString());
        } catch (Exception exception) { Log.w("TermixRuntime", "Cannot reject malformed request", exception); }
    }

    private static String safeMessage(Throwable exception) {
        return exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
    }

    private static native int nativeStart(String entry, String data, String key, String socket, String temp);
}
