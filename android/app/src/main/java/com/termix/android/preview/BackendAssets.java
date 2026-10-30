package com.termix.android.preview;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Extract into a hash-versioned private tree, publishing it only after a complete copy. */
final class BackendAssets {
    static File prepare(Context context) throws IOException {
        File runtimeRoot = new File(context.getFilesDir(), "runtime");
        mkdir(runtimeRoot);
        String version = BuildConfig.BACKEND_ASSET_VERSION;
        File runtime = new File(runtimeRoot, version);
        File backend = new File(runtime, "backend");
        File entry = new File(backend, "bootstrap.js");
        File complete = new File(runtime, ".complete");
        if (!complete.isFile() || !entry.isFile()) {
            File staging = new File(runtimeRoot, version + ".staging");
            remove(staging);
            mkdir(staging);
            try {
                copy(context.getAssets(), "backend", new File(staging, "backend"));
                if (!new File(staging, "backend/bootstrap.js").isFile()) {
                    throw new IOException("Missing bundled assets/backend/bootstrap.js. Package the Android backend first.");
                }
                if (!new File(staging, ".complete").createNewFile()) {
                    throw new IOException("Cannot mark backend extraction complete.");
                }
                remove(runtime);
                if (!staging.renameTo(runtime)) throw new IOException("Cannot publish extracted backend assets.");
            } catch (IOException exception) {
                remove(staging);
                throw exception;
            }
        }
        // A process launches one runtime. Old versions are no longer in use after process replacement.
        File[] oldVersions = runtimeRoot.listFiles();
        if (oldVersions != null) {
            for (File old : oldVersions) if (!old.equals(runtime)) remove(old);
        }
        return entry;
    }

    private static void copy(AssetManager assets, String path, File destination) throws IOException {
        String[] children = assets.list(path);
        if (children != null && children.length > 0) {
            mkdir(destination);
            for (String child : children) copy(assets, path + "/" + child, new File(destination, child));
            return;
        }
        mkdir(destination.getParentFile());
        try (InputStream input = assets.open(path); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    private static void mkdir(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create " + directory);
    }

    private static void remove(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        if (!file.delete()) throw new IOException("Cannot remove stale runtime asset " + file);
    }

    private BackendAssets() { }
}
