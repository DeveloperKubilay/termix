package com.Termix.app.ssh;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "SSH")
public class SSHPlugin extends Plugin {

    private final ConcurrentHashMap<String, SSHSession> sessions = new ConcurrentHashMap<>();

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("address", "");
        int port = call.getInt("port", 22);
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String privateKey = call.getString("privateKey", "");
        String sessionId = call.getString("sessionId",
                String.valueOf(System.currentTimeMillis() + "-" + (int)(Math.random() * 1000)));

        if (host.isEmpty() || username.isEmpty()) {
            JSObject err = new JSObject();
            err.put("status", "error");
            err.put("message", "Host and username are required.");
            call.resolve(err);
            return;
        }

        new Thread(() -> {
            try {
                JSch jsch = new JSch();

                if (!privateKey.isEmpty()) {
                    byte[] keyBytes = privateKey.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    jsch.addIdentity("key-" + sessionId, keyBytes, null, null);
                }

                com.jcraft.jsch.Session jschSession = jsch.getSession(username, host, port);

                if (!password.isEmpty()) {
                    jschSession.setPassword(password);
                }

                // Accept all host keys - we handle known-hosts in the web layer
                jschSession.setConfig("StrictHostKeyChecking", "no");
                jschSession.setConfig("PreferredAuthentications", "publickey,password");
                jschSession.setTimeout(20000);
                jschSession.connect(20000);

                ChannelShell channel = (ChannelShell) jschSession.openChannel("shell");
                channel.setPtyType("xterm-256color");
                channel.setPtySize(80, 24, 640, 384);

                SSHSession sshSession = new SSHSession(jschSession, channel);
                channel.connect();

                sessions.put(sessionId, sshSession);

                // Notify ssh-ready
                JSObject readyData = new JSObject();
                readyData.put("sessionId", sessionId);
                notifyListeners("sshReady", readyData);

                // Start reading output in background thread
                startOutputReader(sessionId, sshSession);

                JSObject result = new JSObject();
                result.put("status", "connected");
                result.put("sessionId", sessionId);
                call.resolve(result);

            } catch (Exception e) {
                JSObject errorResult = new JSObject();
                errorResult.put("status", "error");
                errorResult.put("message", e.getMessage() != null ? e.getMessage() : "Connection failed.");
                call.resolve(errorResult);
            }
        }).start();
    }

    private void startOutputReader(String sessionId, SSHSession sshSession) {
        new Thread(() -> {
            InputStream is = sshSession.getInputStream();
            byte[] buffer = new byte[4096];
            int bytesRead;
            try {
                while ((bytesRead = is.read(buffer)) != -1) {
                    String data = new String(buffer, 0, bytesRead, java.nio.charset.StandardCharsets.UTF_8);
                    JSObject termData = new JSObject();
                    termData.put("sessionId", sessionId);
                    termData.put("data", data);
                    notifyListeners("termData", termData);
                }
            } catch (IOException ignored) {
                // Stream closed — normal disconnect
            }

            int exitCode = sshSession.getExitStatus();
            sessions.remove(sessionId);

            JSObject disconnectData = new JSObject();
            disconnectData.put("sessionId", sessionId);
            disconnectData.put("exitCode", exitCode);
            notifyListeners("termDisconnected", disconnectData);
        }).start();
    }

    @PluginMethod
    public void sendInput(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        String data = call.getString("data", "");

        SSHSession session = sessions.get(sessionId);
        if (session == null) {
            call.resolve();
            return;
        }
        try {
            session.sendInput(data);
        } catch (IOException e) {
            call.reject("Failed to send input: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void resize(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        int cols = call.getInt("cols", 80);
        int rows = call.getInt("rows", 24);

        SSHSession session = sessions.get(sessionId);
        if (session != null) {
            session.resize(cols, rows);
        }
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        SSHSession session = sessions.remove(sessionId);
        if (session != null) {
            session.close();
        }
        call.resolve();
    }
}
