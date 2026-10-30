package com.termix.android.preview;

import android.app.Application;

public final class TermixApplication extends Application {
    private RuntimeController runtime;

    @Override public void onCreate() {
        super.onCreate();
        runtime = new RuntimeController(this);
        runtime.start();
    }

    RuntimeController runtime() { return runtime; }
}
