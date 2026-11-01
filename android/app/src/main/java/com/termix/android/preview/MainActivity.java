package com.termix.android.preview;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
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
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;

public final class MainActivity extends Activity implements RuntimeController.Listener {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String INDEX = ORIGIN + "/assets/web/index.html";
    private static final int IMPORT_KEY = 2001;
    private static final int FILE_CHOOSER = 2002;
    private static final int CREATE_DOWNLOAD_DOCUMENT = 2003;
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
    private Object createDocRequestId;
    private JavaScriptReplyProxy createDocProxy;
    private String createDocProposedName;
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
            case "native:request-notifications": {
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_NOTIFICATIONS);
                        respond(proxy, id, new JSONObject().put("requested", true).put("granted", false), null);
                        break;
                    }
                }
                respond(proxy, id, new JSONObject().put("requested", false).put("granted", true), null);
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse("content://com.android.providers.downloads.documents/document/downloads"));
                    } catch (Exception ignored) {}
                }
                try { startActivityForResult(intent, IMPORT_KEY); }
                catch (Exception exception) {
                    importRequestId = null;
                    importProxy = null;
                    respond(proxy, id, null, exception.getMessage());
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
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse("content://com.android.providers.downloads.documents/document/downloads"));
                    } catch (Exception ignored) {}
                }
                try {
                    startActivityForResult(intent, PICK_UPLOAD_FILE);
                } catch (Exception exception) {
                    uploadRequestId = null;
                    uploadProxy = null;
                    respond(proxy, id, null, "Failed to open document picker: " + exception.getMessage());
                }
                break;
            }
            case "native:create-download-document": {
                if (createDocRequestId != null) {
                    respond(proxy, id, null, "A download document creation is already in progress.");
                    break;
                }
                String name = null;
                JSONObject options = args.optJSONObject(0);
                if (options != null) {
                    name = options.optString("name", null);
                } else if (args.length() > 0) {
                    name = args.optString(0, null);
                }
                if (name == null || name.trim().isEmpty()) {
                    name = "download";
                }
                name = name.replaceAll("[/\\\\:*?\"<>|\\x00-\\x1F]", "_").trim();
                if (name.isEmpty()) name = "download";

                createDocRequestId = id;
                createDocProxy = proxy;
                createDocProposedName = name;

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
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
                    startActivityForResult(intent, CREATE_DOWNLOAD_DOCUMENT);
                } catch (Exception exception) {
                    createDocRequestId = null;
                    createDocProxy = null;
                    createDocProposedName = null;
                    respond(proxy, id, null, "Failed to open document creator: " + exception.getMessage());
                }
                break;
            }
            case "native:transfer-run": {
                JSONObject runOptions = args.optJSONObject(0);
                if (runOptions == null) {
                    respond(proxy, id, null, "transfer-run requires an options object.");
                    break;
                }
                runtime.documentTransfers().runTransfer(runOptions, new DocumentTransfers.Callback() {
                    @Override
                    public void onSuccess(JSONObject result) {
                        runOnUiThread(() -> respond(proxy, id, result, null));
                    }

                    @Override
                    public void onError(String error) {
                        runOnUiThread(() -> respond(proxy, id, null, error));
                    }
                });
                break;
            }
            case "native:transfer-cancel": {
                String idOrHandle = null;
                JSONObject cancelOptions = args.optJSONObject(0);
                if (cancelOptions != null) {
                    idOrHandle = cancelOptions.optString("transferId", null);
                    if (idOrHandle == null || idOrHandle.isEmpty()) {
                        idOrHandle = cancelOptions.optString("handle", null);
                    }
                } else if (args.length() > 0) {
                    idOrHandle = args.optString(0, null);
                }
                boolean cancelled = runtime.documentTransfers().cancelTransfer(idOrHandle);
                JSONObject result = new JSONObject().put("success", true).put("cancelled", cancelled);
                respond(proxy, id, result, null);
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
                try {
                    JSONObject result = new JSONObject().put("cancelled", true);
                    respond(proxy, id, result, null);
                } catch (Exception ignored) {}
                return;
            }
            Uri uri = data.getData();
            new Thread(() -> {
                File destination = null;
                try {
                    String originalName = "private-key";
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                            originalName = cursor.getString(0);
                        }
                    }
                    if (originalName == null || originalName.trim().isEmpty()) {
                        originalName = "private-key";
                    }
                    originalName = new File(originalName).getName();
                    originalName = originalName.replaceAll("[/\\\\:*?\"<>|\\x00-\\x1F]", "_").trim();
                    if (originalName.isEmpty()) originalName = "private-key";

                    String baseName = originalName;
                    String extension = ".key";
                    int lastDot = originalName.lastIndexOf('.');
                    if (lastDot > 0 && lastDot < originalName.length() - 1) {
                        String ext = originalName.substring(lastDot + 1).toLowerCase();
                        if (ext.matches("^(pem|key|pub|ppk|cer|crt|pfx)$")) {
                            baseName = originalName.substring(0, lastDot);
                            extension = "." + ext;
                        } else {
                            baseName = originalName;
                            extension = ".key";
                        }
                    } else if (lastDot == 0) {
                        baseName = originalName.substring(1);
                        if (baseName.isEmpty()) baseName = "private-key";
                        extension = ".key";
                    }

                    File directory = new File(getFilesDir(), "data/files");
                    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private key directory.");

                    String candidateName = baseName + extension;
                    destination = new File(directory, candidateName);
                    int counter = 1;
                    while (!destination.createNewFile()) {
                        candidateName = baseName + "-" + counter + extension;
                        destination = new File(directory, candidateName);
                        counter++;
                    }

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
                        output.flush();
                    }
                    destination.setReadable(false, false);
                    destination.setWritable(false, false);
                    if (!destination.setReadable(true, true) || !destination.setWritable(true, true)) {
                        throw new IOException("Cannot restrict imported key permissions.");
                    }
                    JSONObject result = new JSONObject().put("name", destination.getName()).put("path", destination.getAbsolutePath());
                    runOnUiThread(() -> respond(proxy, id, result, null));
                } catch (Exception exception) {
                    if (destination != null && destination.exists()) destination.delete();
                    runOnUiThread(() -> respond(proxy, id, null, "Key import failed: " + exception.getMessage()));
                }
            }, "termix-key-import").start();
            return;
        }
        if (requestCode == CREATE_DOWNLOAD_DOCUMENT && createDocRequestId != null) {
            Object id = createDocRequestId;
            JavaScriptReplyProxy proxy = createDocProxy;
            String proposedName = createDocProposedName;
            createDocRequestId = null;
            createDocProxy = null;
            createDocProposedName = null;

            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                try {
                    JSONObject result = new JSONObject().put("cancelled", true);
                    respond(proxy, id, result, null);
                } catch (Exception ignored) {}
                return;
            }

            Uri uri = data.getData();
            int flags = data.getFlags();
            DocumentTransfers.CreateDocResult docResult = runtime.documentTransfers().registerDownloadUri(uri, proposedName, flags);
            respond(proxy, id, docResult.toJsonObject(), null);
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
            int flags = data.getFlags();
            DocumentTransfers.PickResult pickResult = runtime.documentTransfers().registerUploadUri(uri, flags);
            respond(proxy, id, pickResult.toJsonObject(), null);
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
