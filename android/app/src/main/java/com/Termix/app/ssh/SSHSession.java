package com.Termix.app.ssh;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.Session;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class SSHSession {
    private final Session jschSession;
    private final ChannelShell channel;
    private final InputStream inputStream;
    private final OutputStream outputStream;

    public SSHSession(Session jschSession, ChannelShell channel) throws IOException {
        this.jschSession = jschSession;
        this.channel = channel;
        this.inputStream = channel.getInputStream();
        this.outputStream = channel.getOutputStream();
    }

    public InputStream getInputStream() {
        return inputStream;
    }

    public void sendInput(String data) throws IOException {
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        outputStream.write(bytes);
        outputStream.flush();
    }

    public void resize(int cols, int rows) {
        channel.setPtySize(cols, rows, cols * 8, rows * 16);
    }

    public int getExitStatus() {
        return channel.getExitStatus();
    }

    public void close() {
        try {
            channel.disconnect();
        } catch (Exception ignored) {}
        try {
            jschSession.disconnect();
        } catch (Exception ignored) {}
    }
}
