package com.termix.android.preview;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.UUID;

public final class MainActivity extends Activity implements RuntimeController.Listener {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String INDEX = ORIGIN + "/assets/web/index.html";
    private static final int IMPORT_KEY = 2001;
    private static final int FILE_CHOOSER = 2002;
    private static final int EXPORT_FILE = 2003;
    private static final int PICK_UPLOAD_FILE = 2004;
    private static final int PERMISSION_REQUEST_NOTIFICATIONS = 3001;
    private WebView webView;
    private TextView status;
    private RuntimeController runtime;
    private JavaScriptReplyProxy replyProxy;
    private String ready;
    private final ArrayDeque<String> pending = new ArrayDeque<>();
    private Object importRequestId;
    private JavaScriptReplyProxy importProxy;
    private ValueCallback<Uri[]> fileUploadCallback;
    private Object exportRequestId;
    private JavaScriptReplyProxy exportProxy;
    private File exportSourceFile;
    private String exportDisplayName;
    private Object uploadRequestId;
    private JavaScriptReplyProxy uploadProxy;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(17, 22, 30));
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                        | android.view.WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        status = new TextView(this);
        status.setTextColor(Color.LTGRAY);
        status.setTextSize(11);
        status.setPadding(16, 8, 16, 8);
        status.setText("Local feasibility preview · bundled Node is NOT production / 16 KB ready");
        status.setVisibility(View.GONE);
        layout.addView(status, new LinearLayout.LayoutParams(-1, -2));
        webView = new WebView(this);
        layout.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_NOTIFICATIONS);
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            onStatus("This Android System WebView lacks secure WebMessageListener. Update WebView; no insecure bridge fallback is provided.", true);
            return;
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // UI preferences only; credentials stay in native/backend private storage.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebViewAssetLoader.AssetsPathHandler webAssets = new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/web/", path -> webAssets.handle("web/" + path))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("GET".equals(request.getMethod()) && trusted(uri) && uri.getPath() != null
                        && uri.getPath().startsWith("/assets/web/")) {
                    WebResourceResponse response = assets.shouldInterceptRequest(uri);
                    if (response != null) return response;
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never give an untrusted page access to the injected bridge object.
                return !trusted(request.getUrl()) || request.getUrl().getPath() == null
                        || !request.getUrl().getPath().startsWith("/assets/web/");
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                replyProxy = null;
                pending.clear();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) onStatus("WebView failed: " + error.getDescription(), true);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) { request.deny(); }
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                    fileUploadCallback = null;
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileUploadCallback = null;
                    return false;
                }
            }
        });
        WebViewCompat.addWebMessageListener(webView, "termixNative", Collections.singleton(ORIGIN),
                (view, message, sourceOrigin, isMainFrame, proxy) -> {
                    if (!isMainFrame || !trusted(sourceOrigin)) return;
                    String json = message.getData();
                    if (json == null || json.getBytes(StandardCharsets.UTF_8).length > RuntimeController.MAX_FRAME) {
                        onStatus("Rejected oversized or non-text bridge message.", true);
                        return;
                    }
                    try {
                        JSONObject frame = new JSONObject(json);
                        if ("bridge:attach".equals(frame.optString("type"))) {
                            replyProxy = proxy;
                            if (ready != null) proxy.postMessage(ready);
                            while (!pending.isEmpty()) proxy.postMessage(pending.removeFirst());
                            return;
                        }
                        replyProxy = proxy;
                        if ("request".equals(frame.optString("type")) && frame.optString("channel").startsWith("native:")) {
                            nativeRequest(frame, proxy);
                        } else {
                            runtime.send(json);
                        }
                    } catch (Exception exception) {
                        onStatus("Invalid native bridge message: " + exception.getMessage(), true);
                    }
                });
        runtime = ((TermixApplication) getApplication()).runtime();
        runtime.attach(this);
        webView.loadUrl(INDEX);
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    File getStagingRoot() throws IOException {
        File staging = new File(getFilesDir(), "data/local/staging");
        if (!staging.isDirectory() && !staging.mkdirs()) {
            throw new IOException("Cannot create staging directory.");
        }
        return staging;
    }

    static void validateStagingPath(File stagingRoot, File sourceFile) throws IOException, SecurityException {
        if (stagingRoot == null || sourceFile == null) {
            throw new IllegalArgumentException("Staging root and source file must not be null.");
        }
        Path rootNorm = stagingRoot.toPath().toAbsolutePath().normalize();
        Path canonRootNorm = stagingRoot.getCanonicalFile().toPath().toAbsolutePath().normalize();
        Path sourceNorm = sourceFile.toPath().toAbsolutePath().normalize();

        Path effectiveRoot = sourceNorm.startsWith(rootNorm) ? rootNorm
                : (sourceNorm.startsWith(canonRootNorm) ? canonRootNorm : null);
        if (effectiveRoot == null || sourceNorm.equals(effectiveRoot)) {
            throw new SecurityException("Path is outside dedicated staging root.");
        }

        Path current = sourceNorm;
        while (current != null) {
            if (Files.isSymbolicLink(current)) {
                throw new SecurityException("Symbolic links are not allowed in staging path: " + current);
            }
            if (current.equals(effectiveRoot)) {
                break;
            }
            current = current.getParent();
        }

        if (!Files.exists(sourceNorm, LinkOption.NOFOLLOW_LINKS)) {
            throw new FileNotFoundException("Staged file does not exist.");
        }
        if (Files.isSymbolicLink(sourceNorm)) {
            throw new SecurityException("Staged item must not be a symbolic link.");
        }
        if (!Files.isRegularFile(sourceNorm, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Staged item must be a regular file.");
        }

        File canonicalRoot = stagingRoot.getCanonicalFile();
        File canonicalSource = sourceFile.getCanonicalFile();
        String rootCanonStr = canonicalRoot.getPath();
        if (!rootCanonStr.endsWith(File.separator)) {
            rootCanonStr += File.separator;
        }
        if (!canonicalSource.getPath().startsWith(rootCanonStr)) {
            throw new SecurityException("Canonical path escapes dedicated staging root.");
        }
        if (Files.isSymbolicLink(canonicalSource.toPath())) {
            throw new SecurityException("Symbolic links are not allowed in canonical staging path.");
        }
        if (!Files.isRegularFile(canonicalSource.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Canonical staged item must be a regular file.");
        }
    }

    private void cleanupExportSource() {
        if (exportSourceFile != null) {
            try {
                if (exportSourceFile.exists()) exportSourceFile.delete();
                File parent = exportSourceFile.getParentFile();
                File stagingRoot = getStagingRoot().getCanonicalFile();
                if (parent != null && !parent.getCanonicalFile().equals(stagingRoot) && parent.isDirectory()) {
                    parent.delete();
                }
            } catch (Exception ignored) {}
        }
    }

    private void nativeRequest(JSONObject frame, JavaScriptReplyProxy proxy) throws Exception {
        Object id = frame.get("id");
        JSONArray args = frame.optJSONArray("args");
        if (args == null) args = new JSONArray();
        switch (frame.getString("channel")) {
            case "native:clipboard-read-text": {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                ClipData clip = clipboard.getPrimaryClip();
                CharSequence text = clip == null || clip.getItemCount() == 0 ? "" : clip.getItemAt(0).getText();
                respond(proxy, id, text == null ? "" : text.toString(), null);
                break;
            }
            case "native:clipboard-write-text": {
                String text = args.getString(0);
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("Termix", text);
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    android.os.PersistableBundle extras = new android.os.PersistableBundle();
                    extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
                    clip.getDescription().setExtras(extras);
                }
                clipboard.setPrimaryClip(clip);
                respond(proxy, id, JSONObject.NULL, null);
                break;
            }
            case "native:show-keyboard": {
                webView.requestFocus();
                ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                respond(proxy, id, JSONObject.NULL, null);
                break;
            }
            case "native:import-key": {
                if (importRequestId != null) {
                    respond(proxy, id, null, "A key import is already open.");
                    break;
                }
                importRequestId = id;
                importProxy = proxy;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, IMPORT_KEY); }
                catch (Exception exception) {
                    importRequestId = null;
                    importProxy = null;
                    respond(proxy, id, null, exception.getMessage());
                }
                break;
            }
            case "native:export-file": {
                if (exportRequestId != null) {
                    respond(proxy, id, null, "A file export is already in progress.");
                    break;
                }
                String localPath = null;
                String name = null;
                JSONObject options = args.optJSONObject(0);
                if (options != null) {
                    localPath = options.optString("localPath", null);
                    name = options.optString("name", null);
                } else {
                    localPath = args.optString(0, null);
                    if (args.length() > 1) name = args.optString(1, null);
                }
                if (localPath == null || localPath.trim().isEmpty()) {
                    respond(proxy, id, null, "localPath is required for file export.");
                    break;
                }
                File stagingRoot;
                File sourceFile;
                try {
                    stagingRoot = getStagingRoot();
                    sourceFile = new File(localPath).getAbsoluteFile();
                    validateStagingPath(stagingRoot, sourceFile);
                } catch (Exception ex) {
                    respond(proxy, id, null, "Invalid export path: " + ex.getMessage());
                    break;
                }

                if (name == null || name.trim().isEmpty()) {
                    name = sourceFile.getName();
                }
                name = name.replaceAll("[/\\\\:*?\"<>|]", "_").trim();
                if (name.isEmpty()) name = "download";

                exportRequestId = id;
                exportProxy = proxy;
                exportSourceFile = sourceFile;
                exportDisplayName = name;

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                String mimeType = "*/*";
                int dot = name.lastIndexOf('.');
                if (dot > 0 && dot < name.length() - 1) {
                    String ext = name.substring(dot + 1).toLowerCase();
                    String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                    if (guessed != null && !guessed.isEmpty()) mimeType = guessed;
                }
                intent.setType(mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(intent, EXPORT_FILE);
                } catch (Exception exception) {
                    cleanupExportSource();
                    exportRequestId = null;
                    exportProxy = null;
                    exportSourceFile = null;
                    exportDisplayName = null;
                    respond(proxy, id, null, "Failed to open document creator: " + exception.getMessage());
                }
                break;
            }
            case "native:pick-upload-file": {
                if (uploadRequestId != null) {
                    respond(proxy, id, null, "A file upload picker is already open.");
                    break;
                }
                uploadRequestId = id;
                uploadProxy = proxy;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(intent, PICK_UPLOAD_FILE);
                } catch (Exception exception) {
                    uploadRequestId = null;
                    uploadProxy = null;
                    respond(proxy, id, null, "Failed to open document picker: " + exception.getMessage());
                }
                break;
            }
            default:
                respond(proxy, id, null, "Unsupported native command.");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    } else if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
            return;
        }
        if (requestCode == IMPORT_KEY && importRequestId != null) {
            Object id = importRequestId;
            JavaScriptReplyProxy proxy = importProxy;
            importRequestId = null;
            importProxy = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                respond(proxy, id, JSONObject.NULL, null);
                return;
            }
            Uri uri = data.getData();
            new Thread(() -> {
                File destination = null;
                try {
                    String name = "private-key";
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
                    }
                    File directory = new File(getFilesDir(), "data/files");
                    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private key directory.");
                    destination = new File(directory, UUID.randomUUID().toString() + ".key");
                    try (InputStream input = getContentResolver().openInputStream(uri);
                         FileOutputStream output = new FileOutputStream(destination)) {
                        if (input == null) throw new IOException("Cannot open selected key.");
                        byte[] buffer = new byte[8192];
                        int total = 0;
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            total += count;
                            if (total > 2 * 1024 * 1024) throw new IOException("Selected key exceeds 2 MiB.");
                            output.write(buffer, 0, count);
                        }
                    }
                    destination.setReadable(false, false);
                    destination.setWritable(false, false);
                    if (!destination.setReadable(true, true) || !destination.setWritable(true, true)) {
                        throw new IOException("Cannot restrict imported key permissions.");
                    }
                    JSONObject result = new JSONObject().put("name", name).put("path", destination.getAbsolutePath());
                    runOnUiThread(() -> respond(proxy, id, result, null));
                } catch (Exception exception) {
                    if (destination != null) destination.delete();
                    runOnUiThread(() -> respond(proxy, id, null, "Key import failed: " + exception.getMessage()));
                }
            }, "termix-key-import").start();
            return;
        }
        if (requestCode == EXPORT_FILE && exportRequestId != null) {
            Object id = exportRequestId;
            JavaScriptReplyProxy proxy = exportProxy;
            File source = exportSourceFile;
            String name = exportDisplayName;
            exportRequestId = null;
            exportProxy = null;
            exportSourceFile = null;
            exportDisplayName = null;

            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                if (source != null && source.exists()) source.delete();
                try {
                    JSONObject result = new JSONObject().put("cancelled", true);
                    respond(proxy, id, result, null);
                } catch (Exception ignored) {}
                return;
            }

            Uri targetUri = data.getData();
            new Thread(() -> {
                try {
                    File stagingRoot = getStagingRoot();
                    validateStagingPath(stagingRoot, source);

                    long total = 0;
                    try (InputStream input = new FileInputStream(source);
                         OutputStream output = getContentResolver().openOutputStream(targetUri, "w")) {
                        if (output == null) throw new IOException("Cannot open destination document output stream.");
                        byte[] buffer = new byte[65536];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            output.write(buffer, 0, count);
                            total += count;
                            if (Thread.currentThread().isInterrupted()) {
                                throw new IOException("File export thread was interrupted.");
                            }
                        }
                        output.flush();
                    }
                    if (source != null && source.exists()) source.delete();
                    try {
                        File parent = source != null ? source.getParentFile() : null;
                        File canonStagingRoot = stagingRoot.getCanonicalFile();
                        if (parent != null && !parent.getCanonicalFile().equals(canonStagingRoot) && parent.isDirectory()) {
                            parent.delete();
                        }
                    } catch (Exception ignored) {}
                    long bytesWritten = total;
                    JSONObject result = new JSONObject().put("success", true).put("name", name).put("bytes", bytesWritten);
                    runOnUiThread(() -> respond(proxy, id, result, null));
                } catch (Exception exception) {
                    if (source != null && source.exists()) source.delete();
                    runOnUiThread(() -> respond(proxy, id, null, "Export failed: " + exception.getMessage()));
                }
            }, "termix-file-export").start();
            return;
        }
        if (requestCode == PICK_UPLOAD_FILE && uploadRequestId != null) {
            Object id = uploadRequestId;
            JavaScriptReplyProxy proxy = uploadProxy;
            uploadRequestId = null;
            uploadProxy = null;

            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                try {
                    JSONObject result = new JSONObject().put("cancelled", true);
                    respond(proxy, id, result, null);
                } catch (Exception ignored) {}
                return;
            }

            Uri uri = data.getData();
            new Thread(() -> {
                File stagedFile = null;
                File stageDir = null;
                try {
                    String name = "upload";
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                            name = cursor.getString(0);
                        }
                    }
                    if (name == null || name.trim().isEmpty()) name = "upload";
                    name = name.replaceAll("[/\\\\:*?\"<>|]", "_").trim();
                    if (name.isEmpty()) name = "upload";

                    File stagingRoot = getStagingRoot();
                    String stageId = "upload-" + UUID.randomUUID().toString();
                    stageDir = new File(stagingRoot, stageId);
                    if (!stageDir.isDirectory() && !stageDir.mkdirs()) {
                        throw new IOException("Cannot create staging directory.");
                    }
                    stagedFile = new File(stageDir, name);

                    long totalBytes = 0;
                    try (InputStream in = getContentResolver().openInputStream(uri);
                         OutputStream out = new FileOutputStream(stagedFile)) {
                        if (in == null) throw new IOException("Cannot open selected file input stream.");
                        byte[] buffer = new byte[65536];
                        int count;
                        while ((count = in.read(buffer)) != -1) {
                            out.write(buffer, 0, count);
                            totalBytes += count;
                            if (Thread.currentThread().isInterrupted()) {
                                throw new IOException("File staging thread was interrupted.");
                            }
                        }
                        out.flush();
                    }

                    validateStagingPath(stagingRoot, stagedFile);

                    JSONObject result = new JSONObject()
                            .put("success", true)
                            .put("name", name)
                            .put("bytes", totalBytes)
                            .put("localPath", stagedFile.getAbsolutePath())
                            .put("stageId", stageId);
                    runOnUiThread(() -> respond(proxy, id, result, null));
                } catch (Exception exception) {
                    if (stagedFile != null && stagedFile.exists()) stagedFile.delete();
                    if (stageDir != null && stageDir.exists()) stageDir.delete();
                    runOnUiThread(() -> respond(proxy, id, null, "Upload staging failed: " + exception.getMessage()));
                }
            }, "termix-file-stage-upload").start();
            return;
        }
    }

    private void respond(JavaScriptReplyProxy proxy, Object id, Object result, String error) {
        if (isDestroyed() || replyProxy == null) return;
        try {
            JSONObject frame = new JSONObject().put("type", "response").put("id", id);
            if (error == null) frame.put("result", result == null ? JSONObject.NULL : result);
            else frame.put("error", new JSONObject().put("code", "NATIVE_ERROR").put("message", error));
            proxy.postMessage(frame.toString());
        } catch (Exception exception) { onStatus("Native response failed: " + exception.getMessage(), true); }
    }

    @Override public void onStatus(String text, boolean failed) {
        status.setText(text);
        status.setTextColor(failed ? Color.rgb(255, 150, 140) : Color.LTGRAY);
        status.setVisibility(failed ? View.VISIBLE : View.GONE);
    }

    @Override public void onMessage(String json) {
        try {
            JSONObject frame = new JSONObject(json);
            if ("ready".equals(frame.optString("type"))) ready = json;
            if ("runtime:disconnected".equals(frame.optString("channel"))) ready = null;
        } catch (Exception ignored) { }
        if (replyProxy != null) replyProxy.postMessage(json);
        else if (ready == null || !ready.equals(json)) {
            if (pending.size() >= 128) pending.removeFirst();
            pending.addLast(json);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (BuildConfig.DEBUG) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) webView.onResume();
    }

    @Override protected void onPause() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (runtime != null) runtime.detach(this);
        replyProxy = null;
        if (webView != null) {
            WebViewCompat.removeWebMessageListener(webView, "termixNative");
            webView.destroy();
        }
        super.onDestroy();
    }
}
