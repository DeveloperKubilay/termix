package com.Termix.app;

import com.Termix.app.ssh.SSHPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SSHPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
