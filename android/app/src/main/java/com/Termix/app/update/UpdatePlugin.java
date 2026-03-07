package com.Termix.app.update;

import android.content.Intent;
import android.net.Uri;

import com.Termix.app.BuildConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * UpdatePlugin — exposes two methods to the JS layer:
 *
 *  • getAppVersion()     → { version: "1.0.42" }
 *    Returns the versionName baked into the APK at build time.
 *
 *  • openReleasesPage()  → {}
 *    Opens the Termix GitHub Releases page in the default browser so the
 *    user can download the latest APK manually.
 */
@CapacitorPlugin(name = "Update")
public class UpdatePlugin extends Plugin {

    private static final String RELEASES_URL =
            "https://github.com/DeveloperKubilay/termix/releases";

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("version", BuildConfig.VERSION_NAME);
        call.resolve(ret);
    }

    @PluginMethod
    public void openReleasesPage(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_URL));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("No browser application found to open the releases page.");
        }
    }
}
