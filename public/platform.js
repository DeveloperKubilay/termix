/**
 * platform.js — Termix Platform Abstraction Layer
 *
 * On Electron: window.electronAPI is already injected by the preload script,
 * so this file does nothing and the rest of the app works unchanged.
 *
 * On Android (Capacitor): window.electronAPI is not available.
 * This file creates a compatible polyfill that routes calls through the
 * native SSHPlugin Capacitor plugin, and stores settings / hosts in
 * localStorage so the UI works without a Node.js backend.
 */
(function () {
    'use strict';

    // If Electron already injected the real API, nothing to do.
    if (window.electronAPI) return;

    // ─── Helpers ────────────────────────────────────────────────────────────────

    function lsGet(key, fallback) {
        try {
            const raw = localStorage.getItem('termix:' + key);
            return raw !== null ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function lsSet(key, value) {
        try {
            localStorage.setItem('termix:' + key, JSON.stringify(value));
        } catch (_) {}
    }

    // ─── Event Bus (mirrors Electron's ipcRenderer.on) ──────────────────────────

    const eventBus = {};

    function busOn(channel, handler) {
        if (!eventBus[channel]) eventBus[channel] = [];
        eventBus[channel].push(handler);
    }

    function busEmit(channel, data) {
        const handlers = eventBus[channel];
        if (!handlers) return;
        handlers.forEach(function (h) { h(null, data); });
    }

    // ─── SSH Plugin Bridge ───────────────────────────────────────────────────────

    var sshPlugin = null;

    function getSSHPlugin() {
        if (sshPlugin) return sshPlugin;
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SSH) {
            sshPlugin = window.Capacitor.Plugins.SSH;
            // Forward native events → event bus
            sshPlugin.addListener('termData', function (data) {
                busEmit('term-data', data);
            });
            sshPlugin.addListener('termDisconnected', function (data) {
                busEmit('term-disconnected', data);
            });
            sshPlugin.addListener('sshReady', function (data) {
                busEmit('ssh-ready', data);
            });
        }
        return sshPlugin;
    }

    // ─── Default Terminal Settings ───────────────────────────────────────────────

    function defaultTerminalSettings() {
        return {
            theme: {
                background: '#1e1e2e',
                foreground: '#cdd6f4',
                cursor: '#f5e0dc',
                cursorAccent: '#1e1e2e',
                black: '#45475a',
                red: '#f38ba8',
                green: '#a6e3a1',
                yellow: '#f9e2af',
                blue: '#89b4fa',
                magenta: '#f5c2e7',
                cyan: '#94e2d5',
                white: '#bac2de',
                brightBlack: '#585b70',
                brightRed: '#f38ba8',
                brightGreen: '#a6e3a1',
                brightYellow: '#f9e2af',
                brightBlue: '#89b4fa',
                brightMagenta: '#f5c2e7',
                brightCyan: '#94e2d5',
                brightWhite: '#a6adc8'
            },
            cursorBlink: true,
            scrollback: 1000,
            fontSize: 14,
            fontFamily: '"JetBrains Mono", Consolas, monospace',
            rightClickCopyPaste: false,
            uiTheme: 'classic'
        };
    }

    // ─── Update helpers ──────────────────────────────────────────────────────────

    /** Returns true when version string a is strictly newer than b (semver). */
    function semverGt(a, b) {
        var pa = a.split('.').map(Number);
        var pb = b.split('.').map(Number);
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var da = pa[i] || 0;
            var db = pb[i] || 0;
            if (da > db) return true;
            if (da < db) return false;
        }
        return false;
    }

    var cachedUpdateResult = null;
    var cachedUpdateTime = 0;
    var UPDATE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

    // ─── polyfill API ────────────────────────────────────────────────────────────

    var api = {

        /** Mirror of ipcRenderer.send for terminal I/O */
        send: function (channel, data) {
            var plugin = getSSHPlugin();
            if (!plugin) return;
            if (channel === 'term-input') {
                plugin.sendInput(data).catch(function (e) { console.error('term-input error', e); });
            } else if (channel === 'term-resize') {
                plugin.resize(data).catch(function (e) { console.error('term-resize error', e); });
            } else if (channel === 'term-close') {
                plugin.close(data).catch(function (e) { console.error('term-close error', e); });
            }
        },

        /** Mirror of ipcRenderer.on */
        on: function (channel, handler) {
            busOn(channel, handler);
        },

        // ── connection ──────────────────────────────────────────────────────────
        connection: {
            connect: function (hostInfo) {
                var plugin = getSSHPlugin();
                if (!plugin) {
                    return Promise.resolve({ status: 'error', message: 'SSH plugin not available.' });
                }
                return plugin.connect(hostInfo);
            },
            getSettings: function () {
                var saved = lsGet('terminalSettings', null);
                var settings = Object.assign({}, defaultTerminalSettings(), saved || {});
                return Promise.resolve(settings);
            },
            saveSettings: function (settings) {
                lsSet('terminalSettings', settings);
                return Promise.resolve({ success: true });
            }
        },

        // ── hosts ───────────────────────────────────────────────────────────────
        hosts: {
            getData: function () {
                return Promise.resolve({ hosts: lsGet('hosts', []) });
            },
            setData: function (data) {
                if (data && Array.isArray(data.hosts)) lsSet('hosts', data.hosts);
                return Promise.resolve({ success: true });
            },
            getTags: function () {
                return Promise.resolve({ tags: lsGet('tags', []) });
            },
            addTag: function (tag) {
                var tags = lsGet('tags', []);
                tags.push(tag);
                lsSet('tags', tags);
                return Promise.resolve({ success: true });
            },
            deleteTag: function (tagId) {
                var tags = lsGet('tags', []).filter(function (t) { return t.id !== tagId; });
                lsSet('tags', tags);
                return Promise.resolve({ success: true });
            },
            getSerialPorts: function () {
                return Promise.resolve({ ports: [] });
            },
            updateTerminalFontSize: function (hostId, fontSize) {
                var hosts = lsGet('hosts', []);
                var h = hosts.find(function (x) { return x.id === hostId; });
                if (h) h.terminalFontSize = fontSize;
                lsSet('hosts', hosts);
                return Promise.resolve({ success: true });
            }
        },

        // ── keychain ────────────────────────────────────────────────────────────
        keychain: {
            getKeyFiles: function () {
                return Promise.resolve({ keys: lsGet('keychain', []) });
            },
            saveKeyFile: function (data) {
                var keys = lsGet('keychain', []);
                var existing = keys.findIndex(function (k) { return k.name === data.name; });
                if (existing >= 0) {
                    keys[existing] = data;
                } else {
                    keys.push(data);
                }
                lsSet('keychain', keys);
                return Promise.resolve({ success: true });
            },
            readKeyFile: function (name) {
                var keys = lsGet('keychain', []);
                var key = keys.find(function (k) { return k.name === name; });
                return Promise.resolve({ content: key ? key.content : '' });
            },
            openFilesFolder: function () {
                return Promise.resolve({});
            }
        },

        // ── known-hosts ─────────────────────────────────────────────────────────
        knownHosts: {
            getHosts: function () {
                return Promise.resolve({ hosts: lsGet('knownHosts', []) });
            },
            deleteHost: function (data) {
                var hosts = lsGet('knownHosts', []).filter(function (h) {
                    return !(h.address === data.address && Number(h.port) === Number(data.port));
                });
                lsSet('knownHosts', hosts);
                return Promise.resolve({ success: true });
            }
        },

        // ── port-forwarding ─────────────────────────────────────────────────────
        portForwarding: {
            getForwards: function () {
                return Promise.resolve({ forwards: [] });
            },
            saveForward: function () {
                return Promise.resolve({ success: true });
            },
            deleteForward: function () {
                return Promise.resolve({ success: true });
            },
            startForward: function () {
                return Promise.resolve({ status: 'error', message: 'Port forwarding is not supported on Android.' });
            }
        },

        // ── profiles ────────────────────────────────────────────────────────────
        profiles: {
            getProfiles: function () {
                var profiles = lsGet('profiles', [{ id: 'default', name: 'Default', type: 'local' }]);
                return Promise.resolve({
                    profiles: profiles,
                    activeProfileId: lsGet('activeProfileId', 'default')
                });
            },
            createProfile: function (data) {
                var profiles = lsGet('profiles', []);
                var newProfile = Object.assign({ id: 'profile-' + Date.now() }, data);
                profiles.push(newProfile);
                lsSet('profiles', profiles);
                return Promise.resolve({ success: true, profile: newProfile });
            },
            deleteProfile: function (profileId) {
                var profiles = lsGet('profiles', []).filter(function (p) { return p.id !== profileId; });
                lsSet('profiles', profiles);
                return Promise.resolve({ success: true });
            },
            switchProfile: function (profileId) {
                lsSet('activeProfileId', profileId);
                return Promise.resolve({ success: true });
            }
        },

        // ── settings ────────────────────────────────────────────────────────────
        settings: {
            getSettings: function () {
                var settings = lsGet('appSettings', defaultTerminalSettings());
                return Promise.resolve(settings);
            },
            saveSettings: function (data) {
                var current = lsGet('appSettings', defaultTerminalSettings());
                lsSet('appSettings', Object.assign({}, current, data));
                return Promise.resolve({ success: true });
            },
            checkForUpdates: function () {
                var updatePlugin = window.Capacitor &&
                    window.Capacitor.Plugins &&
                    window.Capacitor.Plugins.Update;
                if (!updatePlugin) {
                    return Promise.resolve({ status: 'not-supported' });
                }
                var now = Date.now();
                if (cachedUpdateResult && (now - cachedUpdateTime) < UPDATE_CACHE_TTL) {
                    return Promise.resolve(cachedUpdateResult);
                }
                return updatePlugin.getAppVersion()
                    .then(function (result) {
                        var currentVersion = result.version;
                        return fetch(
                            'https://api.github.com/repos/DeveloperKubilay/termix/releases/latest'
                        )
                            .then(function (r) {
                                if (r.status === 403 || r.status === 429) {
                                    return Promise.reject(
                                        new Error('GitHub API rate limit exceeded. Try again later.')
                                    );
                                }
                                return r.json();
                            })
                            .then(function (release) {
                                var latestTag = (release.tag_name || '').replace(/^v/, '');
                                var updateAvailable = !!latestTag && semverGt(latestTag, currentVersion);
                                var ret = {
                                    status: 'checked',
                                    updateAvailable: updateAvailable,
                                    currentVersion: currentVersion,
                                    latestVersion: latestTag
                                };
                                cachedUpdateResult = ret;
                                cachedUpdateTime = now;
                                return ret;
                            });
                    })
                    .catch(function (e) {
                        return { status: 'error', message: e.message };
                    });
            },
            downloadUpdate: function () {
                var updatePlugin = window.Capacitor &&
                    window.Capacitor.Plugins &&
                    window.Capacitor.Plugins.Update;
                if (!updatePlugin) {
                    return Promise.resolve({ status: 'not-supported' });
                }
                return updatePlugin.openReleasesPage().then(function () {
                    return { status: 'opening-browser' };
                });
            },
            installUpdate: function () {
                return Promise.resolve({ status: 'not-supported' });
            },
            getUpdateSettings: function () {
                return Promise.resolve({ autoUpdate: false });
            },
            setUpdateSettings: function () {
                return Promise.resolve({ success: true });
            },
            openConfigFile: function () {
                return Promise.resolve({});
            },
            openProfileFolder: function () {
                return Promise.resolve({});
            },
            syncFirebase: function () {
                return Promise.resolve({ status: 'not-supported' });
            }
        },

        // ── sftp ────────────────────────────────────────────────────────────────
        sftp: {
            connect: function () {
                return Promise.resolve({ status: 'error', message: 'SFTP is not yet supported on Android.' });
            },
            disconnect: function () { return Promise.resolve({}); },
            listDirectory: function () { return Promise.resolve({ items: [] }); },
            readFile: function () { return Promise.resolve({ content: '' }); },
            writeFile: function () { return Promise.resolve({ success: true }); },
            createDirectory: function () { return Promise.resolve({ success: true }); },
            createFile: function () { return Promise.resolve({ success: true }); },
            deleteItems: function () { return Promise.resolve({ success: true }); },
            renameItem: function () { return Promise.resolve({ success: true }); },
            copyItems: function () { return Promise.resolve({ success: true }); }
        },

        // ── snippets ────────────────────────────────────────────────────────────
        snippets: {
            getSnippets: function () {
                return Promise.resolve({ snippets: lsGet('snippets', []) });
            },
            saveSnippet: function (snippet) {
                var snippets = lsGet('snippets', []);
                var idx = snippets.findIndex(function (s) { return s.id === snippet.id; });
                if (idx >= 0) {
                    snippets[idx] = snippet;
                } else {
                    snippet.id = snippet.id || ('snippet-' + Date.now());
                    snippets.push(snippet);
                }
                lsSet('snippets', snippets);
                return Promise.resolve({ success: true });
            },
            deleteSnippet: function (id) {
                var snippets = lsGet('snippets', []).filter(function (s) { return s.id !== id; });
                lsSet('snippets', snippets);
                return Promise.resolve({ success: true });
            },
            importFromUrl: function () {
                return Promise.resolve({ status: 'error', message: 'Not supported on Android.' });
            }
        },

        // ── ai ──────────────────────────────────────────────────────────────────
        ai: {
            ask: function (data) {
                var apiKey = lsGet('aiApiKey', '');
                var model = lsGet('aiModel', 'gpt-4o-mini');
                if (!apiKey) {
                    return Promise.resolve({ error: 'No AI API key configured. Set it in Settings.' });
                }
                return fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: data.messages || [{ role: 'user', content: data.prompt || '' }]
                    })
                }).then(function (r) { return r.json(); })
                  .then(function (json) {
                      if (json.error) return { error: json.error.message };
                      var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
                      return { response: content || '' };
                  })
                  .catch(function (e) { return { error: e.message }; });
            }
        }
    };

    window.electronAPI = api;

    // Clipboard polyfill using the Web Clipboard API
    if (!window.clipboard) {
        window.clipboard = {
            readText: function () {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    return navigator.clipboard.readText().catch(function () { return ''; });
                }
                return Promise.resolve('');
            },
            writeText: function (text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).catch(function () {});
                }
            }
        };
    }
})();
