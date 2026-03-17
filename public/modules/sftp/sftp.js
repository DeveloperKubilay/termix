(function () {
    const sftpApi = window.electronAPI && window.electronAPI.sftp;
    const hostsApi = window.electronAPI && window.electronAPI.hosts;
    const settingsApi = window.electronAPI && window.electronAPI.settings;
    const keychainApi = window.electronAPI && window.electronAPI.keychain;

    if (!sftpApi || !hostsApi) {
        return;
    }

    const paneKeys = ['left', 'right'];
    const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
    const EDITOR_STYLE_ID = 'sftp-editor-style';
    const MONACO_LOADER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js';

    const ui = {
        status: document.getElementById('sftp-global-status'),
        transferProgress: {
            upload: {
                root: document.getElementById('sftp-transfer-progress-upload'),
                label: document.getElementById('sftp-transfer-progress-label-upload'),
                text: document.getElementById('sftp-transfer-progress-text-upload'),
                fill: document.getElementById('sftp-transfer-progress-fill-upload')
            },
            download: {
                root: document.getElementById('sftp-transfer-progress-download'),
                label: document.getElementById('sftp-transfer-progress-label-download'),
                text: document.getElementById('sftp-transfer-progress-text-download'),
                fill: document.getElementById('sftp-transfer-progress-fill-download')
            }
        },
        contextMenu: document.getElementById('sftp-context-menu'),
        renameOverlay: document.getElementById('sftp-rename-overlay'),
        renameTitle: document.getElementById('sftp-rename-title'),
        renamePath: document.getElementById('sftp-rename-path'),
        renameInput: document.getElementById('sftp-rename-input'),
        renameConfirmBtn: document.getElementById('sftp-rename-confirm'),
        renameCancelBtn: document.getElementById('sftp-rename-cancel'),
        panes: {
            left: {
                root: document.getElementById('sftp-pane-left'),
                modeSwitch: document.getElementById('sftp-mode-left'),
                connText: document.getElementById('sftp-conn-left'),
                openFolderBtn: document.getElementById('sftp-open-folder-left'),
                disconnectBtn: document.getElementById('sftp-disconnect-left'),
                breadcrumbs: document.getElementById('sftp-breadcrumbs-left'),
                pathInput: document.getElementById('sftp-path-left'),
                goBtn: document.getElementById('sftp-go-left'),
                refreshBtn: document.getElementById('sftp-refresh-left'),
                list: document.getElementById('sftp-list-left'),
                hostOverlay: document.getElementById('sftp-overlay-left'),
                hostSearch: document.getElementById('sftp-host-search-left'),
                hostList: document.getElementById('sftp-host-list-left')
            },
            right: {
                root: document.getElementById('sftp-pane-right'),
                modeSwitch: document.getElementById('sftp-mode-right'),
                connText: document.getElementById('sftp-conn-right'),
                openFolderBtn: document.getElementById('sftp-open-folder-right'),
                disconnectBtn: document.getElementById('sftp-disconnect-right'),
                breadcrumbs: document.getElementById('sftp-breadcrumbs-right'),
                pathInput: document.getElementById('sftp-path-right'),
                goBtn: document.getElementById('sftp-go-right'),
                refreshBtn: document.getElementById('sftp-refresh-right'),
                list: document.getElementById('sftp-list-right'),
                hostOverlay: document.getElementById('sftp-overlay-right'),
                hostSearch: document.getElementById('sftp-host-search-right'),
                hostList: document.getElementById('sftp-host-list-right')
            }
        }
    };

    const state = {
        hosts: [],
        activePaneKey: 'left',
        clipboard: null,
        dragPayload: null,
        dragHoverRow: null,
        contextMenu: {
            paneKey: null,
            targetPath: null,
            directoryPath: null
        },
        transferQueues: {
            upload: {
                processing: false,
                resetToken: 0,
                activeOperationId: null,
                activeProgress: null,
                activeJob: null,
                pendingJobs: []
            },
            download: {
                processing: false,
                resetToken: 0,
                activeOperationId: null,
                activeProgress: null,
                activeJob: null,
                pendingJobs: []
            }
        },
        renamePrompt: {
            resolver: null,
            keyHandler: null
        },
        preferences: {
            confirmOverwriteOnConflict: true
        },
        monacoLoaderPromise: null,
        editorTabs: new Map(),
        panes: {
            left: {
                key: 'left',
                mode: 'local',
                selectedHostId: null,
                connectedHostId: null,
                sessionId: null,
                connectPromise: null,
                path: '',
                parentPath: null,
                entries: [],
                selected: new Set(),
                selectionAnchorPath: null,
                loading: false,
                requestId: 0
            },
            right: {
                key: 'right',
                mode: 'vds',
                selectedHostId: null,
                connectedHostId: null,
                sessionId: null,
                connectPromise: null,
                path: '',
                parentPath: null,
                entries: [],
                selected: new Set(),
                selectionAnchorPath: null,
                loading: false,
                requestId: 0
            }
        }
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function encodePathValue(value) {
        return encodeURIComponent(String(value || ''));
    }

    function decodePathValue(value) {
        try {
            return decodeURIComponent(String(value || ''));
        } catch (_) {
            return String(value || '');
        }
    }

    function formatSize(bytes) {
        if (bytes == null || Number.isNaN(Number(bytes))) return '-';

        const num = Number(bytes);
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
        if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
        return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(Number(value));
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    function clampPercent(value) {
        if (!Number.isFinite(Number(value))) return 0;
        return Math.max(0, Math.min(100, Number(value)));
    }

    function getTransferQueue(direction) {
        return state.transferQueues && state.transferQueues[direction]
            ? state.transferQueues[direction]
            : null;
    }

    function getTransferUi(direction) {
        return ui.transferProgress && ui.transferProgress[direction]
            ? ui.transferProgress[direction]
            : null;
    }

    function getTransferDirectionLabel(direction) {
        if (direction === 'upload') return 'Uploading';
        if (direction === 'download') return 'Downloading';
        return 'Transferring';
    }

    function shouldConfirmOverwrite(value) {
        return value !== false;
    }

    async function loadTransferPreferences() {
        if (!settingsApi || !settingsApi.getSettings) {
            state.preferences.confirmOverwriteOnConflict = true;
            return state.preferences;
        }

        try {
            const payload = await settingsApi.getSettings();
            const nextValue = payload && payload.sftpSettings
                ? payload.sftpSettings.confirmOverwriteOnConflict
                : true;
            state.preferences.confirmOverwriteOnConflict = shouldConfirmOverwrite(nextValue);
        } catch (err) {
            console.warn('Failed to load SFTP transfer settings:', err);
            state.preferences.confirmOverwriteOnConflict = true;
        }

        return state.preferences;
    }

    async function persistOverwritePromptPreference(confirmOverwriteOnConflict) {
        state.preferences.confirmOverwriteOnConflict = shouldConfirmOverwrite(confirmOverwriteOnConflict);
        if (!settingsApi || !settingsApi.saveSettings) {
            return false;
        }

        await settingsApi.saveSettings({
            sftpSettings: {
                confirmOverwriteOnConflict: state.preferences.confirmOverwriteOnConflict
            }
        });
        return true;
    }

    async function confirmOverwriteConflicts(conflicts = []) {
        const safeConflicts = Array.isArray(conflicts) ? conflicts : [];
        if (!safeConflicts.length) {
            return { confirmed: true, checked: false };
        }

        const firstConflict = safeConflicts[0] || {};
        const conflictCount = safeConflicts.length;
        const itemLabel = String(firstConflict.name || '').trim() || 'This item';
        const targetLabel = String(firstConflict.targetPath || '').trim();

        const message = conflictCount === 1
            ? `${itemLabel} already exists at the target.${targetLabel ? `\n${targetLabel}` : ''}\nOverwrite it?`
            : `${conflictCount} item(s) already exist at the target folder. Overwrite them?`;

        if (typeof window.confirmActionWithOption === 'function') {
            return window.confirmActionWithOption(message, {
                title: conflictCount === 1 ? 'Overwrite Existing Item' : 'Overwrite Existing Items',
                confirmText: conflictCount === 1 ? 'Overwrite' : 'Overwrite All',
                cancelText: 'Cancel',
                tone: 'danger',
                checkboxLabel: 'Do not ask again'
            });
        }

        const confirmed = await window.confirmAction(message, {
            title: conflictCount === 1 ? 'Overwrite Existing Item' : 'Overwrite Existing Items',
            confirmText: conflictCount === 1 ? 'Overwrite' : 'Overwrite All',
            cancelText: 'Cancel',
            tone: 'danger'
        });
        return { confirmed, checked: false };
    }

    function renderTransferQueue(direction) {
        const queue = getTransferQueue(direction);
        const transferUi = getTransferUi(direction);
        if (!queue || !transferUi || !transferUi.root) return;

        const pendingCount = queue.pendingJobs.length;
        const activeProgress = queue.activeProgress;
        const hasVisibleState = Boolean(activeProgress) || pendingCount > 0;

        transferUi.root.hidden = !hasVisibleState;
        if (!hasVisibleState) {
            if (transferUi.label) {
                transferUi.label.textContent = `${getTransferDirectionLabel(direction)}...`;
            }
            if (transferUi.text) {
                transferUi.text.textContent = '0%';
            }
            if (transferUi.fill) {
                transferUi.fill.style.width = '0%';
            }
            return;
        }

        const percent = clampPercent(activeProgress ? activeProgress.percent : 0);
        const currentItemName = String((activeProgress && activeProgress.currentItemName) || '').trim();
        const directionLabel = getTransferDirectionLabel(direction);
        const queueSuffix = pendingCount > 0 ? ` (${pendingCount} queued)` : '';

        if (transferUi.label) {
            transferUi.label.textContent = currentItemName
                ? `${directionLabel}: ${currentItemName}${queueSuffix}`
                : `${directionLabel}${queueSuffix}`;
        }
        if (transferUi.text) {
            transferUi.text.textContent = `${Math.round(percent)}%`;
        }
        if (transferUi.fill) {
            transferUi.fill.style.width = `${percent}%`;
        }
    }

    function createTransferOperationId(direction) {
        return `sftp-copy-${direction || 'transfer'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function buildTransferCancellationError(reason) {
        const error = new Error(reason || 'Transfer cancelled.');
        error.cancelled = true;
        return error;
    }

    function isTransferCancelled(error) {
        return Boolean(error && error.cancelled);
    }

    function getTransferErrorMessage(error, fallback) {
        if (error instanceof Error && error.message) {
            return error.message;
        }
        if (error && typeof error === 'object' && error.message) {
            return String(error.message);
        }
        if (typeof error === 'string' && error) {
            return error;
        }
        return fallback || 'Copy failed.';
    }

    function resolveTransferJob(job, result) {
        if (!job || job.settled) return;
        job.settled = true;
        job.resolve(result);
    }

    function rejectTransferJob(job, error) {
        if (!job || job.settled) return;
        job.settled = true;
        job.reject(error);
    }

    function clearTransferQueues(reason) {
        ['upload', 'download'].forEach((direction) => {
            const queue = getTransferQueue(direction);
            if (!queue) return;
            queue.resetToken += 1;

            queue.pendingJobs.forEach((job) => {
                rejectTransferJob(job, buildTransferCancellationError(reason));
            });
            queue.pendingJobs = [];

            if (queue.activeJob) {
                queue.activeJob.cancelled = true;
                rejectTransferJob(queue.activeJob, buildTransferCancellationError(reason));
            }

            queue.processing = false;
            queue.activeJob = null;
            queue.activeOperationId = null;
            queue.activeProgress = null;
            renderTransferQueue(direction);
        });
    }

    function enqueueTransferOperation(direction, runner) {
        const queue = getTransferQueue(direction);
        if (!queue) {
            return Promise.reject(new Error(`Unknown transfer direction: ${direction}`));
        }

        const operationId = createTransferOperationId(direction);

        return new Promise((resolve, reject) => {
            queue.pendingJobs.push({
                operationId,
                runner,
                resolve,
                reject,
                settled: false,
                cancelled: false
            });

            renderTransferQueue(direction);
            processTransferQueue(direction).catch((err) => {
                console.error(`Failed to process ${direction} transfer queue:`, err);
            });
        });
    }

    async function processTransferQueue(direction) {
        const queue = getTransferQueue(direction);
        if (!queue || queue.processing) return;

        const runToken = queue.resetToken;
        queue.processing = true;

        try {
            while (queue.pendingJobs.length && queue.resetToken === runToken) {
                const job = queue.pendingJobs.shift();
                queue.activeJob = job;
                queue.activeOperationId = job.operationId;
                queue.activeProgress = {
                    direction,
                    percent: 0,
                    currentItemName: ''
                };
                renderTransferQueue(direction);

                try {
                    const result = await job.runner(job.operationId);
                    if (!job.cancelled) {
                        resolveTransferJob(job, result);
                    }
                } catch (err) {
                    if (!job.cancelled) {
                        rejectTransferJob(
                            job,
                            err instanceof Error
                                ? err
                                : new Error(getTransferErrorMessage(err, 'Copy failed.'))
                        );
                    }
                } finally {
                    if (queue.resetToken === runToken) {
                        queue.activeJob = null;
                        queue.activeOperationId = null;
                        queue.activeProgress = null;
                        renderTransferQueue(direction);
                    }
                }
            }
        } finally {
            if (queue.resetToken === runToken) {
                queue.processing = false;
                renderTransferQueue(direction);
            }
        }
    }

    function getFileExtension(name) {
        const text = String(name || '').trim();
        if (!text) return '';
        const index = text.lastIndexOf('.');
        if (index <= 0 || index >= text.length - 1) return '';
        return text.slice(index + 1).toLowerCase();
    }

    function getFileTypeVisual(entry) {
        if (!entry || entry.isParent) {
            return {
                iconClass: 'fa-solid fa-arrow-up-from-bracket',
                iconColor: '#f9e2af'
            };
        }

        if (entry.isDirectory) {
            return {
                iconClass: 'fa-solid fa-folder',
                iconColor: '#89b4fa'
            };
        }

        const ext = getFileExtension(entry.name);
        const map = {
            js: { iconClass: 'fa-brands fa-js', color: '#f1e05a' },
            jsx: { iconClass: 'fa-brands fa-js', color: '#f1e05a' },
            ts: { iconClass: 'fa-solid fa-file-code', color: '#3178c6' },
            tsx: { iconClass: 'fa-solid fa-file-code', color: '#3178c6' },
            json: { iconClass: 'fa-solid fa-file-code', color: '#f1e05a' },
            yml: { iconClass: 'fa-solid fa-file-code', color: '#cb171e' },
            yaml: { iconClass: 'fa-solid fa-file-code', color: '#cb171e' },
            html: { iconClass: 'fa-brands fa-html5', color: '#e34c26' },
            css: { iconClass: 'fa-brands fa-css3-alt', color: '#1572b6' },
            scss: { iconClass: 'fa-solid fa-file-code', color: '#c6538c' },
            less: { iconClass: 'fa-solid fa-file-code', color: '#563d7c' },
            md: { iconClass: 'fa-brands fa-markdown', color: '#083fa1' },
            py: { iconClass: 'fa-brands fa-python', color: '#3572A5' },
            sh: { iconClass: 'fa-solid fa-terminal', color: '#89e051' },
            bash: { iconClass: 'fa-solid fa-terminal', color: '#89e051' },
            zsh: { iconClass: 'fa-solid fa-terminal', color: '#89e051' },
            sql: { iconClass: 'fa-solid fa-database', color: '#336791' },
            xml: { iconClass: 'fa-solid fa-file-code', color: '#e44d26' },
            env: { iconClass: 'fa-solid fa-sliders', color: '#6a737d' },
            ini: { iconClass: 'fa-solid fa-file-lines', color: '#6a737d' },
            toml: { iconClass: 'fa-solid fa-file-lines', color: '#6a737d' },
            txt: { iconClass: 'fa-regular fa-file-lines', color: '#9ca3af' }
        };

        const found = map[ext] || null;
        if (found) {
            return {
                iconClass: found.iconClass,
                iconColor: found.color
            };
        }

        return {
            iconClass: 'fa-regular fa-file-lines',
            iconColor: '#a6adc8'
        };
    }

    function resolveMonacoLanguage(fileName) {
        const ext = getFileExtension(fileName);
        const map = {
            js: 'javascript',
            jsx: 'javascript',
            mjs: 'javascript',
            cjs: 'javascript',
            ts: 'typescript',
            tsx: 'typescript',
            json: 'json',
            yml: 'yaml',
            yaml: 'yaml',
            html: 'html',
            css: 'css',
            scss: 'scss',
            less: 'less',
            md: 'markdown',
            py: 'python',
            sh: 'shell',
            bash: 'shell',
            zsh: 'shell',
            sql: 'sql',
            xml: 'xml',
            env: 'ini',
            ini: 'ini',
            toml: 'ini'
        };
        return map[ext] || 'plaintext';
    }

    function ensureMonacoTheme() {
        if (!window.monaco || !window.monaco.editor) return;
        if (window.__termixGithubDarkThemeDefined) return;

        window.monaco.editor.defineTheme('termix-github-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: '', foreground: 'c9d1d9', background: '0d1117' },
                { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
                { token: 'string', foreground: 'a5d6ff' },
                { token: 'keyword', foreground: 'ff7b72' },
                { token: 'keyword.control', foreground: 'ff7b72' },
                { token: 'keyword.operator', foreground: '79c0ff' },
                { token: 'storage', foreground: 'ff7b72' },
                { token: 'storage.type', foreground: 'ff7b72' },
                { token: 'constant', foreground: '79c0ff' },
                { token: 'constant.numeric', foreground: '79c0ff' },
                { token: 'constant.language', foreground: '79c0ff' },
                { token: 'number', foreground: '79c0ff' },
                { token: 'variable', foreground: 'ffa657' },
                { token: 'variable.parameter', foreground: 'ffa657' },
                { token: 'variable.other.constant', foreground: '79c0ff' },
                { token: 'entity.name.function', foreground: 'd2a8ff' },
                { token: 'entity.name.class', foreground: 'f0883e' },
                { token: 'entity.name.type', foreground: 'f0883e' },
                { token: 'entity.name.tag', foreground: '7ee787' },
                { token: 'entity.other.attribute-name', foreground: '79c0ff' },
                { token: 'support.function', foreground: '79c0ff' },
                { token: 'support.constant', foreground: '79c0ff' },
                { token: 'support.type', foreground: '79c0ff' },
                { token: 'support.class', foreground: 'f0883e' },
                { token: 'meta.tag', foreground: 'c9d1d9' },
                { token: 'meta.tag.attribute.name', foreground: '79c0ff' },
                { token: 'meta.tag.attribute.value', foreground: 'a5d6ff' },
                { token: 'invalid', foreground: 'f85149', fontStyle: 'italic underline' },
                { token: 'delimiter', foreground: 'c9d1d9' },
                { token: 'delimiter.html', foreground: 'c9d1d9' },
                { token: 'tag.html', foreground: '7ee787' },
                { token: 'tag.attribute.name.html', foreground: '79c0ff' },
                { token: 'tag.attribute.value.html', foreground: 'a5d6ff' }
            ],
            colors: {
                'editor.background': '#0d1117',
                'editor.foreground': '#c9d1d9',
                'editorCursor.foreground': '#58a6ff',
                'editor.lineHighlightBackground': '#6e76811a',
                'editor.selectionBackground': '#1f6feb40',
                'editor.inactiveSelectionBackground': '#3fb9500a',
                'editorLineNumber.foreground': '#6e7681',
                'editorLineNumber.activeForeground': '#c9d1d9',
                'editorIndentGuide.background': '#c9d1d91a',
                'editorIndentGuide.activeBackground': '#c9d1d940',
                'editorWhitespace.foreground': '#484f58',
                'editorWidget.background': '#161b22',
                'editorWidget.border': '#30363d',
                'editorSuggestWidget.background': '#161b22',
                'editorSuggestWidget.border': '#30363d',
                'editorSuggestWidget.selectedBackground': '#6e768166'
            }
        });

        window.__termixGithubDarkThemeDefined = true;
    }

    async function ensureMonacoLoaded() {
        if (window.monaco && window.monaco.editor) {
            ensureMonacoTheme();
            return true;
        }

        if (state.monacoLoaderPromise) {
            return state.monacoLoaderPromise;
        }

        state.monacoLoaderPromise = new Promise((resolve) => {
            const finish = (value) => resolve(Boolean(value));

            const startMonaco = () => {
                if (!window.require || typeof window.require !== 'function') {
                    finish(false);
                    return;
                }

                try {
                    window.require.config({
                        paths: {
                            vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs'
                        }
                    });

                    window.require(['vs/editor/editor.main'], () => {
                        const ok = Boolean(window.monaco && window.monaco.editor);
                        if (ok) {
                            ensureMonacoTheme();
                        }
                        finish(ok);
                    }, () => finish(false));
                } catch (_) {
                    finish(false);
                }
            };

            const existing = document.querySelector('script[data-sftp-monaco-loader="1"]');
            if (existing) {
                if (window.monaco && window.monaco.editor) {
                    ensureMonacoTheme();
                    finish(true);
                    return;
                }
                existing.addEventListener('load', () => setTimeout(startMonaco, 0), { once: true });
                existing.addEventListener('error', () => finish(false), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = MONACO_LOADER_URL;
            script.async = true;
            script.dataset.sftpMonacoLoader = '1';
            script.onload = () => setTimeout(startMonaco, 0);
            script.onerror = () => finish(false);
            document.head.appendChild(script);
        });

        return state.monacoLoaderPromise;
    }

    function setStatus(message, type) {
        if (!ui.status) return;
        const nextType = type || 'info';
        ui.status.className = `sftp-status ${nextType}`;
        ui.status.textContent = message;
    }

    function getPaneState(key) {
        return state.panes[key];
    }

    function getPaneUi(key) {
        return ui.panes[key];
    }

    function getPaneSide(pane) {
        return pane.mode === 'local' ? 'local' : 'remote';
    }

    function getHostById(hostId) {
        const target = String(hostId || '');
        return state.hosts.find((host) => String(host.id) === target) || null;
    }

    function closeContextMenu() {
        if (ui.contextMenu) {
            ui.contextMenu.classList.remove('show');
            const itemActions = ui.contextMenu.querySelectorAll('button[data-action="rename"], button[data-action="delete"]');
            itemActions.forEach((action) => {
                action.disabled = false;
                action.style.opacity = '1';
                action.style.pointerEvents = 'auto';
            });
        }
        state.contextMenu.paneKey = null;
        state.contextMenu.targetPath = null;
        state.contextMenu.directoryPath = null;
    }

    function openContextMenu(paneKey, targetPath, directoryPath, clientX, clientY) {
        if (!ui.contextMenu) return;
        state.contextMenu.paneKey = paneKey;
        state.contextMenu.targetPath = targetPath;
        state.contextMenu.directoryPath = directoryPath;

        const itemActions = ui.contextMenu.querySelectorAll('button[data-action="rename"], button[data-action="delete"]');
        itemActions.forEach((action) => {
            action.disabled = !targetPath;
            action.style.opacity = targetPath ? '1' : '0.45';
            action.style.pointerEvents = targetPath ? 'auto' : 'none';
        });

        ui.contextMenu.style.left = `${Math.max(6, Number(clientX) || 0)}px`;
        ui.contextMenu.style.top = `${Math.max(6, Number(clientY) || 0)}px`;
        ui.contextMenu.classList.add('show');

        requestAnimationFrame(() => {
            if (!ui.contextMenu || !ui.contextMenu.classList.contains('show')) return;
            const rect = ui.contextMenu.getBoundingClientRect();
            const maxLeft = Math.max(6, window.innerWidth - rect.width - 6);
            const maxTop = Math.max(6, window.innerHeight - rect.height - 6);

            const safeLeft = Math.min(Math.max(6, Number(clientX) || 0), maxLeft);
            const safeTop = Math.min(Math.max(6, Number(clientY) || 0), maxTop);

            ui.contextMenu.style.left = `${safeLeft}px`;
            ui.contextMenu.style.top = `${safeTop}px`;
        });
    }

    function normalizeNameInput(value) {
        return String(value || '').trim();
    }

    function validateEntryName(nameValue) {
        const name = normalizeNameInput(nameValue);
        if (!name) return { valid: false, message: 'Name cannot be empty.' };
        if (name === '.' || name === '..') return { valid: false, message: 'Invalid name.' };
        if (/[\\/]/.test(name)) return { valid: false, message: 'Name cannot contain / or \\.' };
        return { valid: true, name };
    }

    function findEntryByPath(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane || !targetPath) return null;
        return (pane.entries || []).find((entry) => entry.path === targetPath) || null;
    }

    function getItemNameForPath(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane || !targetPath) return '';

        const matchedEntry = findEntryByPath(key, targetPath);
        if (matchedEntry && matchedEntry.name) {
            return String(matchedEntry.name);
        }

        const normalizedPath = String(targetPath || '');
        if (!normalizedPath) return '';

        if (getPaneSide(pane) === 'local') {
            const trimmed = normalizedPath.replace(/[\\/]+$/, '');
            const parts = trimmed.split(/[\\/]/).filter(Boolean);
            return parts.length ? parts[parts.length - 1] : trimmed;
        }

        const trimmed = normalizedPath.replace(/\/+$/, '');
        const parts = trimmed.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : trimmed;
    }

    function closeRenamePrompt(value) {
        if (state.renamePrompt.keyHandler) {
            document.removeEventListener('keydown', state.renamePrompt.keyHandler, true);
            state.renamePrompt.keyHandler = null;
        }

        if (ui.renameOverlay) {
            ui.renameOverlay.classList.remove('show');
        }

        const pendingResolver = state.renamePrompt.resolver;
        state.renamePrompt.resolver = null;

        if (pendingResolver) {
            pendingResolver(value);
        }
    }

    function requestTextValue(options = {}) {
        const title = String(options.title || 'Enter a name');
        const confirmText = String(options.confirmText || 'Save');
        const initialValue = String(options.initialValue || '');
        const targetPath = String(options.targetPath || '');
        const placeholder = String(options.placeholder || '');

        const fallbackPrompt = () => {
            const raw = window.prompt(`${title}:`, initialValue || '');
            if (raw == null) return null;
            return String(raw);
        };

        if (!ui.renameOverlay || !ui.renameInput || !ui.renameConfirmBtn || !ui.renameCancelBtn) {
            return Promise.resolve(fallbackPrompt());
        }

        if (state.renamePrompt.resolver) {
            closeRenamePrompt(null);
        }

        if (ui.renameTitle) {
            ui.renameTitle.textContent = title;
        }
        ui.renameConfirmBtn.textContent = confirmText;
        ui.renameInput.value = initialValue;
        ui.renameInput.placeholder = placeholder;
        if (ui.renamePath) {
            ui.renamePath.textContent = targetPath || '';
        }
        ui.renameOverlay.classList.add('show');

        return new Promise((resolve) => {
            state.renamePrompt.resolver = resolve;
            state.renamePrompt.keyHandler = (event) => {
                if (!state.renamePrompt.resolver) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeRenamePrompt(null);
                    return;
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    closeRenamePrompt(ui.renameInput ? ui.renameInput.value : '');
                }
            };

            document.addEventListener('keydown', state.renamePrompt.keyHandler, true);
            setTimeout(() => {
                if (!ui.renameInput) return;
                ui.renameInput.focus();
                ui.renameInput.select();
            }, 0);
        });
    }

    function activatePane(key, shouldFocus) {
        state.activePaneKey = key;
        paneKeys.forEach((paneKey) => {
            const paneUi = getPaneUi(paneKey);
            if (!paneUi || !paneUi.root) return;
            paneUi.root.classList.toggle('active', paneKey === key);
        });

        if (shouldFocus === false) return;
        const paneUi = getPaneUi(key);
        if (paneUi && paneUi.list) {
            try { paneUi.list.focus({ preventScroll: true }); } catch (_) {}
        }
    }

    function buildLocalBreadcrumbs(pathValue) {
        const value = String(pathValue || '').trim();
        if (!value) return [];

        const normalized = value.replace(/\//g, '\\');
        const driveMatch = normalized.match(/^([a-zA-Z]:)(\\.*)?$/);

        if (driveMatch) {
            const drive = driveMatch[1];
            const rest = (driveMatch[2] || '').split('\\').filter(Boolean);
            const crumbs = [{ label: drive, path: `${drive}\\` }];

            let current = `${drive}\\`;
            for (const part of rest) {
                current = current.endsWith('\\') ? `${current}${part}` : `${current}\\${part}`;
                crumbs.push({ label: part, path: current });
            }
            return crumbs;
        }

        const unixLike = value.replace(/\\/g, '/');
        const parts = unixLike.split('/').filter(Boolean);
        const crumbs = [{ label: '/', path: '/' }];

        let current = '';
        for (const part of parts) {
            current += `/${part}`;
            crumbs.push({ label: part, path: current });
        }

        return crumbs;
    }

    function buildRemoteBreadcrumbs(pathValue) {
        const value = String(pathValue || '/').trim() || '/';
        const normalized = value.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);

        const crumbs = [{ label: '/', path: '/' }];
        let current = '';

        for (const part of parts) {
            current += `/${part}`;
            crumbs.push({ label: part, path: current });
        }

        return crumbs;
    }

    function renderBreadcrumbs(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.breadcrumbs) return;

        const crumbs = pane.mode === 'local'
            ? buildLocalBreadcrumbs(pane.path)
            : buildRemoteBreadcrumbs(pane.path || '/');

        if (!crumbs.length) {
            paneUi.breadcrumbs.innerHTML = '<span class="sftp-file-meta">-</span>';
            return;
        }

        paneUi.breadcrumbs.innerHTML = crumbs.map((crumb) => {
            const encoded = encodePathValue(crumb.path);
            return `
                <button type="button" class="sftp-crumb-btn" data-pane="${key}" data-path="${encoded}">${escapeHtml(crumb.label)}</button>
                <span class="sftp-crumb-sep">&gt;</span>
            `;
        }).join('');
    }

    function renderHostList(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.hostList) return;

        const query = String(paneUi.hostSearch && paneUi.hostSearch.value ? paneUi.hostSearch.value : '')
            .toLowerCase()
            .trim();

        const filteredHosts = state.hosts.filter((host) => {
            if (!query) return true;
            const blob = `${host.name || ''} ${host.address || ''} ${host.username || ''}`.toLowerCase();
            return blob.includes(query);
        });

        if (!filteredHosts.length) {
            paneUi.hostList.innerHTML = '<div class="sftp-empty" style="padding: 10px;">SSH host not found.</div>';
            return;
        }

        paneUi.hostList.innerHTML = filteredHosts.map((host) => {
            const isSelected = String(pane.selectedHostId) === String(host.id);
            const classes = ['sftp-host-item', isSelected ? 'selected' : ''].filter(Boolean).join(' ');
            const icon = host.icon || 'fa-solid fa-server';
            const color = host.color || '#89b4fa';
            const title = host.name || host.address || 'Unnamed';
            const subtitle = `${host.username || 'root'}@${host.address || ''}`;

            return `
                <div class="${classes}" data-pane="${key}" data-host-id="${escapeHtml(String(host.id))}">
                    <div class="sftp-host-icon" style="background: ${escapeHtml(color)};">
                        <i class="${escapeHtml(icon)}"></i>
                    </div>
                    <div class="sftp-host-meta">
                        <div class="sftp-host-name">${escapeHtml(title)}</div>
                        <div class="sftp-host-sub">${escapeHtml(subtitle)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderPane(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi) return;

        closeContextMenu();

        const isRemoteMode = pane.mode === 'vds';
        const isConnected = isRemoteMode && Boolean(pane.sessionId);

        if (paneUi.root) {
            paneUi.root.classList.toggle('connected', isConnected);
            paneUi.root.classList.toggle('local-mode', pane.mode === 'local');
        }

        if (paneUi.modeSwitch) {
            const buttons = paneUi.modeSwitch.querySelectorAll('button[data-mode]');
            buttons.forEach((button) => {
                const mode = button.getAttribute('data-mode');
                button.classList.toggle('active', mode === pane.mode);
            });
        }

        if (paneUi.connText) {
            if (pane.mode === 'local') {
                paneUi.connText.textContent = 'Local';
            } else if (pane.sessionId) {
                const host = getHostById(pane.connectedHostId);
                const hostLabel = host ? (host.name || host.address || 'VDS') : 'VDS';
                paneUi.connText.textContent = `Connected: ${hostLabel}`;
            } else {
                paneUi.connText.textContent = 'Not connected';
            }
        }

        if (paneUi.pathInput) {
            paneUi.pathInput.value = pane.path || '';
            paneUi.pathInput.disabled = isRemoteMode && !isConnected;
        }
        if (paneUi.goBtn) {
            paneUi.goBtn.disabled = isRemoteMode && !isConnected;
        }
        if (paneUi.refreshBtn) {
            paneUi.refreshBtn.disabled = isRemoteMode && !isConnected;
        }

        if (paneUi.hostOverlay) {
            paneUi.hostOverlay.classList.toggle('show', isRemoteMode && !isConnected);
        }

        if (paneUi.list) {
            if (pane.loading) {
                paneUi.list.innerHTML = '<div class="sftp-empty">Loading...</div>';
            } else if (isRemoteMode && !isConnected) {
                paneUi.list.innerHTML = '<div class="sftp-empty">Waiting for VDS selection...</div>';
            } else {
                const rows = [];
                if (pane.parentPath) {
                    rows.push({
                        isParent: true,
                        isDirectory: true,
                        name: '..',
                        path: pane.parentPath,
                        size: null,
                        modifiedAt: null
                    });
                }

                pane.entries.forEach((entry) => rows.push({ ...entry, isParent: false }));

                if (!rows.length) {
                    paneUi.list.innerHTML = '<div class="sftp-empty">This folder is empty.</div>';
                } else {
                    paneUi.list.innerHTML = rows.map((item) => {
                        const selected = !item.isParent && pane.selected.has(item.path);
                        const rowClasses = [
                            'sftp-file-row',
                            selected ? 'selected' : '',
                            item.isParent ? 'up' : ''
                        ].filter(Boolean).join(' ');
                        const draggable = item.isParent ? 'false' : 'true';
                        const visual = getFileTypeVisual(item);

                        const encodedPath = encodePathValue(item.path);

                        return `
                            <div class="${rowClasses}" data-pane="${key}" data-path="${encodedPath}" data-parent="${item.isParent ? '1' : '0'}" data-directory="${item.isDirectory ? '1' : '0'}" draggable="${draggable}">
                                <div class="sftp-file-name">
                                    <i class="${escapeHtml(visual.iconClass)}" style="color: ${escapeHtml(visual.iconColor)};"></i>
                                    <span class="label">${escapeHtml(item.name)}</span>
                                </div>
                                <div class="sftp-file-meta">${item.isDirectory || item.isParent ? '-' : escapeHtml(formatSize(item.size))}</div>
                                <div class="sftp-file-time">${item.isParent ? '-' : escapeHtml(formatDate(item.modifiedAt))}</div>
                            </div>
                        `;
                    }).join('');
                }
            }
        }

        renderBreadcrumbs(key);
        renderHostList(key);
    }

    function renderAllPanes() {
        paneKeys.forEach((paneKey) => renderPane(paneKey));
        activatePane(state.activePaneKey, false);
    }

    async function refreshPane(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return false;

        const paneSide = getPaneSide(pane);
        const requestId = ++pane.requestId;
        pane.loading = true;
        renderPane(key);

        const payload = {
            side: paneSide,
            path: targetPath != null ? targetPath : pane.path
        };

        if (paneSide === 'remote') {
            if (!pane.sessionId) {
                pane.loading = false;
                renderPane(key);
                return false;
            }
            payload.sessionId = pane.sessionId;
        }

        const result = await sftpApi.listDirectory(payload);
        if (requestId !== pane.requestId) return false;

        pane.loading = false;

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Failed to list folder.', 'error');
            renderPane(key);
            return false;
        }

        pane.path = result.path || payload.path || pane.path;
        pane.parentPath = result.parentPath || null;
        pane.entries = Array.isArray(result.entries) ? result.entries : [];
        clearPaneSelection(pane);

        renderPane(key);
        return true;
    }

    async function disconnectPane(key, silent) {
        const pane = getPaneState(key);
        if (!pane) return false;

        if (!pane.sessionId) {
            return true;
        }

        const result = await sftpApi.disconnect(pane.sessionId);
        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Failed to close connection.', 'error');
            return false;
        }

        pane.sessionId = null;
        pane.connectedHostId = null;
        pane.path = '';
        pane.parentPath = null;
        pane.entries = [];
        clearPaneSelection(pane);
        pane.loading = false;
        clearTransferQueues('Transfers cancelled due to disconnect.');

        renderPane(key);

        if (!silent) {
            setStatus(`${key === 'left' ? 'Left' : 'Right'} pane disconnected.`, 'info');
        }

        return true;
    }

    async function connectPane(key, options) {
        const opts = options || {};
        const pane = getPaneState(key);
        if (!pane || pane.mode !== 'vds') {
            return false;
        }

        if (!pane.selectedHostId && state.hosts.length) {
            pane.selectedHostId = String(state.hosts[0].id);
        }

        if (!pane.selectedHostId) {
            if (!opts.silent) setStatus('SSH host not found.', 'error');
            renderPane(key);
            return false;
        }

        const sameHost = pane.sessionId && String(pane.connectedHostId) === String(pane.selectedHostId);
        if (sameHost && !opts.forceReconnect) {
            return true;
        }

        if (pane.connectPromise) {
            return pane.connectPromise;
        }

        const task = (async () => {
            if (pane.sessionId) {
                const disconnected = await disconnectPane(key, true);
                if (!disconnected) return false;
            }

            if (!opts.silent) {
                setStatus(`${key === 'left' ? 'Left' : 'Right'} pane connecting...`, 'info');
            }

            const result = await sftpApi.connect(pane.selectedHostId);
            if (!result || result.success === false) {
                if (!opts.silent) {
                    setStatus(result && result.message ? result.message : 'Connection failed.', 'error');
                }
                return false;
            }

            pane.sessionId = result.sessionId;
            pane.connectedHostId = pane.selectedHostId;
            pane.path = result.initialPath || result.homePath || '/';
            pane.parentPath = null;
            pane.entries = [];
            clearPaneSelection(pane);

            renderPane(key);
            const refreshed = await refreshPane(key, pane.path);
            if (!refreshed) return false;

            if (!opts.silent) {
                const host = getHostById(pane.selectedHostId);
                const hostLabel = host ? (host.name || host.address || 'VDS') : 'VDS';
                setStatus(`${key === 'left' ? 'Left' : 'Right'} pane connected: ${hostLabel}`, 'success');
            }

            return true;
        })();

        pane.connectPromise = task;
        try {
            return await task;
        } finally {
            if (pane.connectPromise === task) {
                pane.connectPromise = null;
            }
        }
    }

    async function ensurePaneConnected(key) {
        const pane = getPaneState(key);
        if (!pane) return false;

        if (pane.mode !== 'vds') return true;
        if (pane.sessionId) return true;
        return connectPane(key, { silent: false, forceReconnect: false });
    }

    async function switchPaneMode(key, mode) {
        const pane = getPaneState(key);
        if (!pane) return;

        if (pane.mode === mode) return;

        if (mode === 'local') {
            await disconnectPane(key, true);
            pane.mode = 'local';
            pane.path = '';
            pane.parentPath = null;
            pane.entries = [];
            clearPaneSelection(pane);
            renderPane(key);
            await refreshPane(key, '');
            setStatus(`${key === 'left' ? 'Left' : 'Right'} pane switched to Local mode.`, 'info');
            return;
        }

        pane.mode = 'vds';
        pane.path = '';
        pane.parentPath = null;
        pane.entries = [];
        clearPaneSelection(pane);
        renderPane(key);
        setStatus(`Select a VDS for the ${key === 'left' ? 'left' : 'right'} pane.`, 'info');
    }

    function getSelectedEntries(key) {
        const pane = getPaneState(key);
        if (!pane) return [];
        return pane.entries.filter((entry) => pane.selected.has(entry.path));
    }

    function clearPaneSelection(pane) {
        if (!pane) return;
        pane.selected.clear();
        pane.selectionAnchorPath = null;
    }

    function findEntryIndexByPath(pane, targetPath) {
        if (!pane || !targetPath) return -1;
        return (pane.entries || []).findIndex((entry) => entry && entry.path === targetPath);
    }

    function updateSelectionClasses(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi || !paneUi.list) return;

        const rows = paneUi.list.querySelectorAll('.sftp-file-row');
        rows.forEach((row) => {
            const isParent = row.dataset.parent === '1';
            if (isParent) {
                row.classList.remove('selected');
                return;
            }

            const rowPath = decodePathValue(row.dataset.path || '');
            row.classList.toggle('selected', pane.selected.has(rowPath));
        });
    }

    function clearDropIndicators() {
        paneKeys.forEach((paneKey) => {
            const paneUi = getPaneUi(paneKey);
            if (!paneUi || !paneUi.list) return;
            paneUi.list.classList.remove('drag-over');
            const highlightedRows = paneUi.list.querySelectorAll('.sftp-file-row.drop-target');
            highlightedRows.forEach((row) => row.classList.remove('drop-target'));
        });
        state.dragHoverRow = null;
    }

    function buildCopyPayload(sourcePaneKey, entries) {
        const pane = getPaneState(sourcePaneKey);
        if (!pane) return null;

        const sourceSide = getPaneSide(pane);
        const validEntries = Array.isArray(entries) ? entries : [];
        if (!validEntries.length) return null;

        return {
            sourcePaneKey,
            sourceSide,
            sourceSessionId: sourceSide === 'remote' ? pane.sessionId : null,
            items: validEntries.map((entry) => ({
                path: entry.path,
                isDirectory: Boolean(entry.isDirectory)
            }))
        };
    }

    function selectOnly(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return;
        pane.selected.clear();
        pane.selected.add(targetPath);
        pane.selectionAnchorPath = targetPath;
        updateSelectionClasses(key);
    }

    function toggleSelection(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane) return;
        if (pane.selected.has(targetPath)) {
            pane.selected.delete(targetPath);
        } else {
            pane.selected.add(targetPath);
        }
        pane.selectionAnchorPath = targetPath;
        updateSelectionClasses(key);
    }

    function selectRange(key, targetPath, additive) {
        const pane = getPaneState(key);
        if (!pane || !targetPath) return;

        const targetIndex = findEntryIndexByPath(pane, targetPath);
        if (targetIndex < 0) return;

        const anchorPath = pane.selectionAnchorPath;
        const anchorIndex = findEntryIndexByPath(pane, anchorPath);

        if (anchorIndex < 0) {
            if (!additive) {
                pane.selected.clear();
            }
            pane.selected.add(targetPath);
            pane.selectionAnchorPath = targetPath;
            updateSelectionClasses(key);
            return;
        }

        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);

        if (!additive) {
            pane.selected.clear();
        }

        for (let i = start; i <= end; i += 1) {
            const entry = pane.entries[i];
            if (!entry || !entry.path) continue;
            pane.selected.add(entry.path);
        }
        updateSelectionClasses(key);
    }

    function selectAll(key) {
        const pane = getPaneState(key);
        if (!pane) return;
        const allPaths = (pane.entries || []).map((entry) => entry && entry.path).filter(Boolean);
        pane.selected = new Set(allPaths);
        if (!allPaths.length) {
            pane.selectionAnchorPath = null;
        } else if (!pane.selectionAnchorPath || !pane.selected.has(pane.selectionAnchorPath)) {
            pane.selectionAnchorPath = allPaths[0];
        }
        updateSelectionClasses(key);
    }

    function copySelected(key) {
        const pane = getPaneState(key);
        if (!pane) return;

        const selected = getSelectedEntries(key);
        if (!selected.length) {
            setStatus('No selected item to copy.', 'error');
            return;
        }

        const payload = buildCopyPayload(key, selected);
        if (!payload) return;

        state.clipboard = payload;

        setStatus(`${selected.length} item(s) copied.`, 'success');
    }

    async function executeCopyToPane(copyPayload, destinationPaneKey, destinationPathOverride, successMessage) {
        const destinationPane = getPaneState(destinationPaneKey);
        if (!destinationPane) return false;

        if (!copyPayload || !Array.isArray(copyPayload.items) || !copyPayload.items.length) {
            setStatus('No item to paste.', 'error');
            return false;
        }

        const destinationSide = getPaneSide(destinationPane);
        if (destinationSide === 'remote') {
            const connected = await ensurePaneConnected(destinationPaneKey);
            if (!connected) return false;
        }

        const destinationPath = destinationPathOverride || destinationPane.path;
        if (!destinationPath) {
            setStatus('No target folder selected.', 'error');
            return false;
        }

        const sourcePane = getPaneState(copyPayload.sourcePaneKey);
        let sourceSessionId = copyPayload.sourceSessionId;
        if (copyPayload.sourceSide === 'remote' && sourcePane && sourcePane.sessionId) {
            sourceSessionId = sourcePane.sessionId;
        }

        const transferDirection = copyPayload.sourceSide === 'local' && destinationSide === 'remote'
            ? 'upload'
            : (copyPayload.sourceSide === 'remote' && destinationSide === 'local' ? 'download' : null);

        if (state.preferences.confirmOverwriteOnConflict) {
            let previewResult = null;
            try {
                previewResult = await sftpApi.copyItems({
                    sourceSide: copyPayload.sourceSide,
                    destinationSide,
                    sourceSessionId,
                    destinationSessionId: destinationSide === 'remote' ? destinationPane.sessionId : null,
                    destinationPath,
                    items: copyPayload.items,
                    dryRun: true,
                    conflictPolicy: 'error'
                });
            } catch (err) {
                setStatus(getTransferErrorMessage(err, 'Copy failed.'), 'error');
                return false;
            }

            if (!previewResult || previewResult.success === false) {
                setStatus(getTransferErrorMessage(previewResult, 'Copy failed.'), 'error');
                return false;
            }

            if (previewResult.hasConflicts) {
                let decision = null;
                try {
                    decision = await confirmOverwriteConflicts(previewResult.conflicts);
                } catch (err) {
                    setStatus(getTransferErrorMessage(err, 'Copy cancelled.'), 'error');
                    return false;
                }

                if (!decision || !decision.confirmed) {
                    setStatus('Copy cancelled.', 'info');
                    return false;
                }

                if (decision.checked) {
                    try {
                        await persistOverwritePromptPreference(false);
                    } catch (err) {
                        console.warn('Failed to persist overwrite prompt setting:', err);
                        if (window.notifyUser) {
                            window.notifyUser('Overwrite preference could not be saved.', 'warning');
                        }
                    }
                }
            }
        }

        const runCopy = async (operationId = null) => {
            return sftpApi.copyItems({
                sourceSide: copyPayload.sourceSide,
                destinationSide,
                sourceSessionId,
                destinationSessionId: destinationSide === 'remote' ? destinationPane.sessionId : null,
                destinationPath,
                items: copyPayload.items,
                operationId,
                conflictPolicy: 'overwrite'
            });
        };

        let result = null;
        try {
            result = transferDirection
                ? await enqueueTransferOperation(transferDirection, runCopy)
                : await runCopy(null);
        } catch (err) {
            if (isTransferCancelled(err)) {
                return false;
            }
            setStatus(getTransferErrorMessage(err, 'Copy failed.'), 'error');
            return false;
        }

        if (!result || result.success === false) {
            setStatus(getTransferErrorMessage(result, 'Copy failed.'), 'error');
            return false;
        }

        await refreshPane(destinationPaneKey);
        setStatus(successMessage || `${result.copiedCount || copyPayload.items.length} item(s) pasted.`, 'success');
        return true;
    }

    async function pasteToPane(key) {
        const destinationPane = getPaneState(key);
        if (!destinationPane) return;

        if (!state.clipboard || !Array.isArray(state.clipboard.items) || !state.clipboard.items.length) {
            setStatus('No item to paste.', 'error');
            return;
        }

        await executeCopyToPane(state.clipboard, key, null, `${state.clipboard.items.length} item(s) pasted.`);
    }

    async function deleteSelected(key) {
        const pane = getPaneState(key);
        if (!pane) return;

        const selected = getSelectedEntries(key);
        if (!selected.length) {
            setStatus('No item selected for deletion.', 'error');
            return;
        }

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const confirmed = await window.confirmAction(`Delete ${selected.length} item(s)?`, {
            title: 'Delete Confirmation',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            tone: 'danger'
        });
        if (!confirmed) return;

        const result = await sftpApi.deleteItems({
            side,
            sessionId: side === 'remote' ? pane.sessionId : null,
            items: selected.map((entry) => ({ path: entry.path }))
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Delete failed.', 'error');
            return;
        }

        await refreshPane(key);
        setStatus(`${selected.length} item(s) deleted.`, 'success');
    }

    async function renameItemInPane(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane || !targetPath) return;

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const currentName = getItemNameForPath(key, targetPath);
        if (!currentName) {
            setStatus('No item found to rename.', 'error');
            return;
        }

        const requestedName = await requestTextValue({
            title: 'Rename',
            confirmText: 'Save',
            initialValue: currentName,
            targetPath
        });
        if (requestedName == null) return;

        const nameCheck = validateEntryName(requestedName);
        if (!nameCheck.valid) {
            setStatus(nameCheck.message, 'error');
            return;
        }
        const nextName = nameCheck.name;

        if (nextName === currentName) {
            return;
        }

        const result = await sftpApi.renameItem({
            side,
            sessionId: side === 'remote' ? pane.sessionId : null,
            path: targetPath,
            newName: nextName
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Rename failed.', 'error');
            return;
        }

        if (result.renamed === false) {
            setStatus('Name unchanged.', 'info');
            return;
        }

        await refreshPane(key);
        setStatus(`'${currentName}' renamed.`, 'success');
    }

    function getFileNameBySide(side, targetPath) {
        const value = String(targetPath || '');
        if (!value) return 'file';

        if (side === 'local') {
            const normalized = value.replace(/[\\/]+$/, '');
            const parts = normalized.split(/[\\/]/).filter(Boolean);
            return parts.length ? parts[parts.length - 1] : normalized;
        }

        const normalized = value.replace(/\/+$/, '');
        const parts = normalized.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : normalized;
    }

    function buildEditorKey(side, hostId, targetPath) {
        if (side === 'local') {
            const normalized = String(targetPath || '');
            const lower = /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
            return `local:${lower}`;
        }
        return `remote:${String(hostId || 'unknown')}:${String(targetPath || '')}`;
    }

    function ensureEditorStyles() {
        let style = document.getElementById(EDITOR_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = EDITOR_STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = `
            .sftp-editor-tab { height: 100%; width: 100%; min-width: 0; display: flex; flex-direction: column; background: #0d1117; overflow: hidden; }
            .sftp-editor-bar { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: flex-start; border-bottom: 1px solid #30363d; padding: 10px 12px; background: #161b22; }
            .sftp-editor-meta { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
            .sftp-editor-path { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
            .sftp-editor-name { font-size: 13px; color: #e6edf3; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .sftp-editor-actions { flex: 0 1 auto; margin-left: auto; display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
            .sftp-editor-actions .btn { white-space: nowrap; }
            .sftp-editor-status { font-size: 11px; border: 1px solid #30363d; border-radius: 999px; padding: 4px 9px; color: #8b949e; }
            .sftp-editor-status.success { color: #3fb950; border-color: rgba(63, 185, 80, 0.55); background: rgba(63, 185, 80, 0.14); }
            .sftp-editor-status.error { color: #f85149; border-color: rgba(248, 81, 73, 0.55); background: rgba(248, 81, 73, 0.14); }
            .sftp-editor-status.warning { color: #d29922; border-color: rgba(210, 153, 34, 0.55); background: rgba(210, 153, 34, 0.14); }
            .sftp-editor-text { flex: 1 1 auto; min-height: 0; width: 100%; resize: none; border: none; outline: none; background: #0d1117; color: #e6edf3; caret-color: #58a6ff; font-family: "JetBrains Mono", monospace; font-size: 13px; line-height: 1.55; padding: 12px; tab-size: 4; font-variant-ligatures: none; white-space: pre; overflow: auto; }
            .sftp-editor-text::selection { background: #264f78; }
            .sftp-editor-monaco { flex: 1 1 auto; min-height: 0; width: 100%; background: #0d1117; overflow: hidden; }
            .sftp-editor-monaco .monaco-editor,
            .sftp-editor-monaco .overflow-guard {
                width: 100% !important;
                height: 100% !important;
                border-radius: 0;
            }
            @media (max-width: 860px) {
                .sftp-editor-actions {
                    width: 100%;
                    margin-left: 0;
                    justify-content: flex-end;
                }
            }
        `;
    }

    async function openEditorTab(payload) {
        if (!window.TabManager || !payload || !payload.path) return;

        const side = payload.side;
        const hostId = payload.hostId || null;
        const targetPath = payload.path;
        const fileName = payload.fileName || getFileNameBySide(side, targetPath);
        const editorKey = buildEditorKey(side, hostId, targetPath);

        const existingTabId = state.editorTabs.get(editorKey);
        if (existingTabId && Array.isArray(window.TabManager.tabs) && window.TabManager.tabs.some((tab) => tab.id === existingTabId)) {
            window.TabManager.activateTab(existingTabId);
            return;
        }

        state.editorTabs.delete(editorKey);
        ensureEditorStyles();

        const tabId = `sftp-editor-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const containerId = `sftp-editor-root-${tabId}`;
        const textId = `sftp-editor-text-${tabId}`;
        const saveId = `sftp-editor-save-${tabId}`;
        const reloadId = `sftp-editor-reload-${tabId}`;
        const statusId = `sftp-editor-status-${tabId}`;

        window.TabManager.addTab({
            id: tabId,
            title: fileName,
            icon: 'fa-regular fa-file-lines',
            contentHtml: `
                <div id="${containerId}" class="sftp-editor-tab">
                    <div class="sftp-editor-bar">
                        <div class="sftp-editor-meta">
                            <div class="sftp-editor-name">${escapeHtml(fileName)}</div>
                            <div class="sftp-editor-path">${escapeHtml(targetPath)}</div>
                        </div>
                        <div class="sftp-editor-actions">
                            <span id="${statusId}" class="sftp-editor-status">Ready</span>
                            <button id="${reloadId}" type="button" class="btn btn-primary">Reload</button>
                            <button id="${saveId}" type="button" class="btn btn-primary">Save</button>
                        </div>
                    </div>
                    <textarea id="${textId}" class="sftp-editor-text" spellcheck="false"></textarea>
                </div>
            `
        });

        state.editorTabs.set(editorKey, tabId);

        setTimeout(async () => {
            const textArea = document.getElementById(textId);
            const saveBtn = document.getElementById(saveId);
            const reloadBtn = document.getElementById(reloadId);
            const statusEl = document.getElementById(statusId);
            if (!textArea || !saveBtn || !reloadBtn || !statusEl) return;

            const tab = window.TabManager.tabs.find((item) => item.id === tabId);
            const tabTitleEl = document.querySelector(`.tab[data-id="${tabId}"] .tab-title`);
            const setTabTitle = (dirty) => {
                if (tab) tab.title = fileName;
                if (tabTitleEl) tabTitleEl.textContent = dirty ? `* ${fileName}` : fileName;
            };

            const setEditorStatus = (message, type = 'info') => {
                statusEl.textContent = String(message || '');
                statusEl.className = `sftp-editor-status ${type}`;
            };

            let dirty = false;
            let activeRemoteSessionId = payload.sessionId || null;
            let saveInFlight = false;
            let reloadInFlight = false;
            let skipDirtyMark = false;
            let monacoEditor = null;
            let monacoResizeObserver = null;
            let tabVisibilityObserver = null;
            let windowResizeHandler = null;
            let relayoutIntervalId = null;

            let getEditorValue = () => textArea.value;
            let setEditorValue = (value, silentSet) => {
                skipDirtyMark = Boolean(silentSet);
                textArea.value = String(value || '');
                skipDirtyMark = false;
            };
            let focusEditor = () => {
                try { textArea.focus(); } catch (_) {}
            };
            let bindEditorChange = (handler) => {
                textArea.addEventListener('input', handler);
            };

            try {
                const monacoReady = await ensureMonacoLoaded();
                if (monacoReady && window.monaco && window.monaco.editor) {
                    const monacoHost = document.createElement('div');
                    monacoHost.className = 'sftp-editor-monaco';
                    textArea.style.display = 'none';
                    textArea.insertAdjacentElement('afterend', monacoHost);

                    monacoEditor = window.monaco.editor.create(monacoHost, {
                        value: String(payload.content || ''),
                        language: resolveMonacoLanguage(fileName),
                        theme: 'termix-github-dark',
                        automaticLayout: false,
                        fontFamily: '"JetBrains Mono", "Cascadia Mono", "Consolas", "Courier New", monospace',
                        fontSize: 13,
                        lineHeight: 20,
                        lineNumbers: 'on',
                        minimap: { enabled: false },
                        wordWrap: 'off',
                        wordWrapOverride1: 'off',
                        wordWrapOverride2: 'off',
                        wrappingIndent: 'none',
                        smoothScrolling: true,
                        cursorBlinking: 'solid',
                        cursorSmoothCaretAnimation: 'off',
                        fontLigatures: false,
                        renderWhitespace: 'selection',
                        tabSize: 2,
                        insertSpaces: true,
                        scrollBeyondLastLine: false,
                        roundedSelection: false,
                        scrollbar: {
                            horizontal: 'auto',
                            vertical: 'auto',
                            horizontalScrollbarSize: 10,
                            verticalScrollbarSize: 10,
                            useShadows: false,
                            alwaysConsumeMouseWheel: false
                        },
                        stickyScroll: {
                            enabled: false
                        }
                    });

                    getEditorValue = () => monacoEditor.getValue();
                    setEditorValue = (value, silentSet) => {
                        skipDirtyMark = Boolean(silentSet);
                        monacoEditor.setValue(String(value || ''));
                        monacoEditor.setPosition({ lineNumber: 1, column: 1 });
                        monacoEditor.revealPositionInCenter({ lineNumber: 1, column: 1 });
                        monacoEditor.layout();
                        skipDirtyMark = false;
                    };
                    focusEditor = () => {
                        try { monacoEditor.focus(); } catch (_) {}
                    };
                    bindEditorChange = (handler) => {
                        monacoEditor.onDidChangeModelContent(handler);
                    };

                    const relayout = () => {
                        try { monacoEditor.layout(); } catch (_) {}
                    };

                    monacoResizeObserver = new ResizeObserver(() => relayout());
                    monacoResizeObserver.observe(monacoHost);

                    windowResizeHandler = () => relayout();
                    window.addEventListener('resize', windowResizeHandler);

                    const tabContent = document.getElementById(containerId)
                        ? document.getElementById(containerId).closest('.tab-content')
                        : null;
                    if (tabContent) {
                        tabVisibilityObserver = new MutationObserver(() => {
                            if (tabContent.classList.contains('active')) {
                                relayout();
                            }
                        });
                        tabVisibilityObserver.observe(tabContent, {
                            attributes: true,
                            attributeFilter: ['class']
                        });
                    }

                    setTimeout(relayout, 20);
                    setTimeout(relayout, 120);
                    setTimeout(relayout, 280);
                    relayoutIntervalId = setInterval(relayout, 120);
                    setTimeout(() => {
                        if (relayoutIntervalId) {
                            clearInterval(relayoutIntervalId);
                            relayoutIntervalId = null;
                        }
                    }, 1600);
                }
            } catch (_) {}

            setEditorValue(payload.content || '', true);

            const resolveCurrentSessionId = async () => {
                if (side !== 'remote') return null;
                const pane = getPaneState(payload.paneKey);
                if (pane && pane.mode === 'vds') {
                    if (!pane.sessionId) {
                        const connected = await ensurePaneConnected(payload.paneKey);
                        if (!connected) return null;
                    }
                    if (pane.sessionId) {
                        activeRemoteSessionId = pane.sessionId;
                    }
                }
                return activeRemoteSessionId;
            };

            const saveCurrent = async () => {
                if (saveInFlight) return;
                saveInFlight = true;
                saveBtn.disabled = true;
                setEditorStatus('Saving...', 'info');

                try {
                    const sessionId = await resolveCurrentSessionId();
                    if (side === 'remote' && !sessionId) {
                        setEditorStatus('No remote connection.', 'error');
                        return;
                    }

                    const result = await sftpApi.writeFile({
                        side,
                        sessionId: side === 'remote' ? sessionId : null,
                        path: targetPath,
                        content: getEditorValue()
                    });

                    if (!result || result.success === false) {
                        setEditorStatus(result && result.message ? result.message : 'Save failed.', 'error');
                        setStatus(result && result.message ? result.message : 'Save failed.', 'error');
                        return;
                    }

                    dirty = false;
                    setTabTitle(false);
                    setEditorStatus('Saved', 'success');
                    setStatus(`'${fileName}' saved.`, 'success');
                } catch (err) {
                    const message = err && err.message ? err.message : 'Save failed.';
                    setEditorStatus(message, 'error');
                    setStatus(message, 'error');
                } finally {
                    saveInFlight = false;
                    saveBtn.disabled = false;
                }
            };

            const reloadCurrent = async () => {
                if (reloadInFlight) return;
                if (dirty) {
                    const approved = await window.confirmAction('Discard unsaved changes?', {
                        title: 'File Reload',
                        confirmText: 'Reload',
                        cancelText: 'Cancel',
                        tone: 'danger'
                    });
                    if (!approved) return;
                }

                reloadInFlight = true;
                reloadBtn.disabled = true;
                setEditorStatus('Loading...', 'info');

                try {
                    const sessionId = await resolveCurrentSessionId();
                    if (side === 'remote' && !sessionId) {
                        setEditorStatus('No remote connection.', 'error');
                        return;
                    }

                    const result = await sftpApi.readFile({
                        side,
                        sessionId: side === 'remote' ? sessionId : null,
                        path: targetPath,
                        maxBytes: MAX_EDITABLE_FILE_BYTES
                    });

                    if (!result || result.success === false) {
                        setEditorStatus(result && result.message ? result.message : 'Reload failed.', 'error');
                        return;
                    }

                    setEditorValue(result.content || '', true);
                    dirty = false;
                    setTabTitle(false);
                    setEditorStatus('Reloaded', 'success');
                } catch (err) {
                    const message = err && err.message ? err.message : 'Reload failed.';
                    setEditorStatus(message, 'error');
                } finally {
                    reloadInFlight = false;
                    reloadBtn.disabled = false;
                }
            };

            setTabTitle(false);
            setEditorStatus('Ready', 'info');

            bindEditorChange(() => {
                if (skipDirtyMark) return;
                if (!dirty) {
                    dirty = true;
                    setTabTitle(true);
                    setEditorStatus('Not saved', 'warning');
                }
            });

            if (monacoEditor && window.monaco && window.monaco.KeyMod && window.monaco.KeyCode) {
                monacoEditor.addCommand(
                    window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
                    () => { saveCurrent().catch(() => {}); }
                );
            } else {
                textArea.addEventListener('keydown', async (event) => {
                    if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
                        event.preventDefault();
                        await saveCurrent();
                    }
                });
            }

            saveBtn.addEventListener('click', async () => {
                await saveCurrent();
            });

            reloadBtn.addEventListener('click', async () => {
                await reloadCurrent();
            });

            setTimeout(() => {
                focusEditor();
            }, 0);

            const currentTab = window.TabManager.tabs.find((item) => item.id === tabId);
            if (currentTab) {
                currentTab.sessionObj = {
                    dispose: () => {
                        if (tabVisibilityObserver) {
                            try { tabVisibilityObserver.disconnect(); } catch (_) {}
                        }
                        if (monacoResizeObserver) {
                            try { monacoResizeObserver.disconnect(); } catch (_) {}
                        }
                        if (windowResizeHandler) {
                            try { window.removeEventListener('resize', windowResizeHandler); } catch (_) {}
                        }
                        if (relayoutIntervalId) {
                            try { clearInterval(relayoutIntervalId); } catch (_) {}
                        }
                        if (monacoEditor) {
                            try { monacoEditor.dispose(); } catch (_) {}
                        }
                        state.editorTabs.delete(editorKey);
                    }
                };
            }
        }, 10);
    }

    async function openFileInEditor(key, targetPath) {
        const pane = getPaneState(key);
        if (!pane || !targetPath) return;

        const entry = findEntryByPath(key, targetPath);
        if (entry && entry.isDirectory) return;

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const knownSize = entry && Number.isFinite(Number(entry.size)) ? Number(entry.size) : null;
        if (knownSize != null && knownSize > MAX_EDITABLE_FILE_BYTES) {
            const message = `File could not be opened: ${formatSize(knownSize)} (limit ${formatSize(MAX_EDITABLE_FILE_BYTES)}).`;
            setStatus(message, 'error');
            if (window.notifyUser) window.notifyUser(message, 'warning');
            return;
        }

        let result = null;
        try {
            result = await sftpApi.readFile({
                side,
                sessionId: side === 'remote' ? pane.sessionId : null,
                path: targetPath,
                maxBytes: MAX_EDITABLE_FILE_BYTES
            });
        } catch (err) {
            const message = err && err.message ? err.message : 'File could not be read.';
            setStatus(message, 'error');
            return;
        }

        if (!result || result.success === false) {
            if (result && result.tooLarge) {
                const realSize = Number.isFinite(Number(result.size)) ? Number(result.size) : knownSize;
                const message = `File could not be opened: ${realSize != null ? formatSize(realSize) : 'Large file'} (limit ${formatSize(MAX_EDITABLE_FILE_BYTES)}).`;
                setStatus(message, 'error');
                if (window.notifyUser) window.notifyUser(message, 'warning');
                return;
            }

            setStatus(result && result.message ? result.message : 'File could not be read.', 'error');
            return;
        }

        await openEditorTab({
            paneKey: key,
            side,
            hostId: side === 'remote' ? pane.connectedHostId : null,
            sessionId: side === 'remote' ? pane.sessionId : null,
            path: result.path || targetPath,
            fileName: getItemNameForPath(key, result.path || targetPath),
            content: result.content || ''
        });
    }

    async function createDirectoryInPane(key, directoryPath) {
        const pane = getPaneState(key);
        if (!pane) return;

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const parentPath = String(directoryPath || pane.path || '').trim();
        if (!parentPath) {
            setStatus('Select a target path to create a folder.', 'error');
            return;
        }

        const rawName = await requestTextValue({
            title: 'Create new folder',
            confirmText: 'Create',
            initialValue: '',
            targetPath: parentPath,
            placeholder: 'folder_name'
        });
        if (rawName == null) return;

        const nameCheck = validateEntryName(rawName);
        if (!nameCheck.valid) {
            setStatus(nameCheck.message, 'error');
            return;
        }

        const result = await sftpApi.createDirectory({
            side,
            sessionId: side === 'remote' ? pane.sessionId : null,
            parentPath,
            name: nameCheck.name
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Failed to create folder.', 'error');
            return;
        }

        const refreshed = await refreshPane(key, parentPath);
        if (!refreshed) {
            await refreshPane(key, pane.path || parentPath);
        }
        setStatus(`Folder '${nameCheck.name}' created.`, 'success');
    }

    async function createFileInPane(key, directoryPath) {
        const pane = getPaneState(key);
        if (!pane) return;

        const side = getPaneSide(pane);
        if (side === 'remote') {
            const connected = await ensurePaneConnected(key);
            if (!connected) return;
        }

        const parentPath = String(directoryPath || pane.path || '').trim();
        if (!parentPath) {
            setStatus('Select a target path to create a file.', 'error');
            return;
        }

        const rawName = await requestTextValue({
            title: 'Create new file',
            confirmText: 'Create',
            initialValue: 'untitled.txt',
            targetPath: parentPath,
            placeholder: 'file_name.txt'
        });
        if (rawName == null) return;

        const nameCheck = validateEntryName(rawName);
        if (!nameCheck.valid) {
            setStatus(nameCheck.message, 'error');
            return;
        }

        const result = await sftpApi.createFile({
            side,
            sessionId: side === 'remote' ? pane.sessionId : null,
            parentPath,
            name: nameCheck.name,
            content: ''
        });

        if (!result || result.success === false) {
            setStatus(result && result.message ? result.message : 'Failed to create file.', 'error');
            return;
        }

        const refreshed = await refreshPane(key, parentPath);
        if (!refreshed) {
            await refreshPane(key, pane.path || parentPath);
        }
        setStatus(`File '${nameCheck.name}' created.`, 'success');

        if (result.path) {
            await openFileInEditor(key, result.path);
        }
    }

    async function loadHosts() {
        const allHosts = await hostsApi.getData();
        state.hosts = (Array.isArray(allHosts) ? allHosts : [])
            .filter((host) => String(host.protocol || 'SSH').toUpperCase() === 'SSH');

        paneKeys.forEach((key) => {
            const pane = getPaneState(key);
            if (!pane) return;
            if (!pane.selectedHostId && state.hosts.length) {
                pane.selectedHostId = String(state.hosts[0].id);
            }
        });

        renderAllPanes();
    }

    function bindContextMenuEvents() {
        if (ui.contextMenu) {
            ui.contextMenu.addEventListener('click', async (event) => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;
                event.preventDefault();

                const action = String(button.dataset.action || '');
                const paneKey = state.contextMenu.paneKey;
                const targetPath = state.contextMenu.targetPath;
                const directoryPath = state.contextMenu.directoryPath;

                closeContextMenu();

                if (!paneKey) return;
                if (action === 'create-directory') {
                    await createDirectoryInPane(paneKey, directoryPath);
                    return;
                }
                if (action === 'create-file') {
                    await createFileInPane(paneKey, directoryPath);
                    return;
                }

                if (!targetPath) {
                    setStatus('Select an item for this action.', 'error');
                    return;
                }

                if (action === 'rename') {
                    await renameItemInPane(paneKey, targetPath);
                    return;
                }
                if (action === 'delete') {
                    await deleteSelected(paneKey);
                }
            });
        }

        if (ui.renameConfirmBtn) {
            ui.renameConfirmBtn.addEventListener('click', () => {
                closeRenamePrompt(ui.renameInput ? ui.renameInput.value : '');
            });
        }

        if (ui.renameCancelBtn) {
            ui.renameCancelBtn.addEventListener('click', () => closeRenamePrompt(null));
        }

        if (ui.renameOverlay) {
            ui.renameOverlay.addEventListener('click', (event) => {
                if (event.target === ui.renameOverlay) {
                    closeRenamePrompt(null);
                }
            });
        }
    }

    function bindPaneEvents(key) {
        const pane = getPaneState(key);
        const paneUi = getPaneUi(key);
        if (!pane || !paneUi) return;

        if (paneUi.root) {
            paneUi.root.addEventListener('mousedown', () => activatePane(key, false));
        }

        if (paneUi.hostOverlay) {
            paneUi.hostOverlay.addEventListener('click', async (event) => {
                if (event.target !== paneUi.hostOverlay) return;
                activatePane(key, false);
                closeContextMenu();
                await switchPaneMode(key, 'local');
            });
        }

        if (paneUi.modeSwitch) {
            paneUi.modeSwitch.addEventListener('click', async (event) => {
                const button = event.target.closest('button[data-mode]');
                if (!button) return;
                const mode = button.dataset.mode;
                if (!mode) return;
                activatePane(key, false);
                closeContextMenu();
                await switchPaneMode(key, mode);
            });
        }

        if (paneUi.openFolderBtn) {
            paneUi.openFolderBtn.addEventListener('click', async () => {
                activatePane(key, false);
                closeContextMenu();
                if (keychainApi && pane.path) {
                    try {
                        await keychainApi.openFilesFolder(pane.path);
                    } catch (err) {
                        setStatus('Failed to open folder: ' + (err && err.message ? err.message : err), 'error');
                    }
                }
            });
        }

        if (paneUi.disconnectBtn) {
            paneUi.disconnectBtn.addEventListener('click', async () => {
                activatePane(key, false);
                closeContextMenu();
                await disconnectPane(key, false);
            });
        }

        if (paneUi.goBtn) {
            paneUi.goBtn.addEventListener('click', async () => {
                activatePane(key, false);
                closeContextMenu();
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key, paneUi.pathInput ? paneUi.pathInput.value : '');
            });
        }

        if (paneUi.refreshBtn) {
            paneUi.refreshBtn.addEventListener('click', async () => {
                activatePane(key, false);
                closeContextMenu();
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key);
            });
        }

        if (paneUi.pathInput) {
            paneUi.pathInput.addEventListener('keydown', async (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                activatePane(key, false);
                closeContextMenu();
                if (getPaneSide(pane) === 'remote') {
                    const connected = await ensurePaneConnected(key);
                    if (!connected) return;
                }
                await refreshPane(key, paneUi.pathInput.value);
            });
        }

        if (paneUi.list) {
            paneUi.list.addEventListener('focus', () => activatePane(key, false));

            paneUi.list.addEventListener('contextmenu', (event) => {
                if (pane.loading) return;
                if (getPaneSide(pane) === 'remote' && !pane.sessionId) return;

                const row = event.target.closest('.sftp-file-row');

                event.preventDefault();
                activatePane(key, false);

                let targetPath = null;
                if (row && row.dataset.parent !== '1') {
                    targetPath = decodePathValue(row.dataset.path || '');
                }

                if (targetPath) {
                    if (!pane.selected.has(targetPath)) {
                        selectOnly(key, targetPath);
                    }
                } else {
                    clearPaneSelection(pane);
                    updateSelectionClasses(key);
                }

                openContextMenu(key, targetPath, pane.path || '', event.clientX, event.clientY);
            });

            paneUi.list.addEventListener('click', async (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) return;

                activatePane(key, false);
                closeContextMenu();

                const targetPath = decodePathValue(row.dataset.path || '');
                if (!targetPath) return;

                const isParentRow = row.dataset.parent === '1';
                const withToggle = event.ctrlKey || event.metaKey;
                const withRange = event.shiftKey;

                if (isParentRow) {
                    await refreshPane(key, targetPath);
                    return;
                }

                if (withRange) {
                    selectRange(key, targetPath, withToggle);
                } else if (withToggle) {
                    toggleSelection(key, targetPath);
                } else {
                    selectOnly(key, targetPath);
                }
            });

            paneUi.list.addEventListener('dblclick', async (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) return;

                closeContextMenu();

                const targetPath = decodePathValue(row.dataset.path || '');
                if (!targetPath) return;

                const isParentRow = row.dataset.parent === '1';
                const isDirectory = row.dataset.directory === '1';

                if (isParentRow || isDirectory) {
                    await refreshPane(key, targetPath);
                    return;
                }

                await openFileInEditor(key, targetPath);
            });

            paneUi.list.addEventListener('dragstart', (event) => {
                const row = event.target.closest('.sftp-file-row');
                if (!row) {
                    event.preventDefault();
                    return;
                }

                closeContextMenu();

                const isParentRow = row.dataset.parent === '1';
                if (isParentRow) {
                    event.preventDefault();
                    return;
                }

                const sourcePath = decodePathValue(row.dataset.path || '');
                if (!sourcePath) {
                    event.preventDefault();
                    return;
                }

                activatePane(key, false);

                if (!pane.selected.has(sourcePath)) {
                    selectOnly(key, sourcePath);
                }

                const selectedEntries = getSelectedEntries(key);
                const payload = buildCopyPayload(key, selectedEntries);
                if (!payload) {
                    event.preventDefault();
                    return;
                }

                state.dragPayload = payload;

                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('text/plain', 'termix-sftp-drag');
                }
            });

            paneUi.list.addEventListener('dragover', (event) => {
                if (!state.dragPayload) return;
                event.preventDefault();
                paneUi.list.classList.add('drag-over');

                const candidateRow = event.target.closest('.sftp-file-row');
                const isDirectoryDropTarget = candidateRow
                    && candidateRow.dataset.parent !== '1'
                    && candidateRow.dataset.directory === '1';

                if (state.dragHoverRow && state.dragHoverRow !== candidateRow) {
                    state.dragHoverRow.classList.remove('drop-target');
                    state.dragHoverRow = null;
                }

                if (isDirectoryDropTarget) {
                    candidateRow.classList.add('drop-target');
                    state.dragHoverRow = candidateRow;
                } else if (state.dragHoverRow) {
                    state.dragHoverRow.classList.remove('drop-target');
                    state.dragHoverRow = null;
                }

                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy';
                }
            });

            paneUi.list.addEventListener('dragleave', (event) => {
                if (!paneUi.list.contains(event.relatedTarget)) {
                    paneUi.list.classList.remove('drag-over');
                    if (state.dragHoverRow) {
                        state.dragHoverRow.classList.remove('drop-target');
                        state.dragHoverRow = null;
                    }
                }
            });

            paneUi.list.addEventListener('drop', async (event) => {
                if (!state.dragPayload) return;
                event.preventDefault();
                activatePane(key, false);

                const payload = state.dragPayload;
                const targetRow = event.target.closest('.sftp-file-row');
                const canDropIntoRow = targetRow
                    && targetRow.dataset.parent !== '1'
                    && targetRow.dataset.directory === '1';

                let destinationPath = null;
                if (canDropIntoRow) {
                    destinationPath = decodePathValue(targetRow.dataset.path || '');
                }

                clearDropIndicators();
                state.dragPayload = null;

                await executeCopyToPane(payload, key, destinationPath, 'Copy completed.');
            });

            paneUi.list.addEventListener('dragend', () => {
                clearDropIndicators();
                state.dragPayload = null;
            });
        }

        if (paneUi.breadcrumbs) {
            paneUi.breadcrumbs.addEventListener('click', async (event) => {
                const button = event.target.closest('.sftp-crumb-btn');
                if (!button) return;

                const targetPath = decodePathValue(button.dataset.path || '');
                if (!targetPath) return;

                activatePane(key, false);
                closeContextMenu();
                await refreshPane(key, targetPath);
            });
        }

        if (paneUi.hostSearch) {
            paneUi.hostSearch.addEventListener('input', () => {
                renderHostList(key);
            });
        }

        if (paneUi.hostList) {
            paneUi.hostList.addEventListener('click', async (event) => {
                const hostItem = event.target.closest('.sftp-host-item');
                if (!hostItem) return;

                const hostId = hostItem.dataset.hostId;
                if (!hostId) return;

                pane.selectedHostId = hostId;
                renderPane(key);
                closeContextMenu();
                await connectPane(key, { silent: false, forceReconnect: false });
            });
        }
    }

    function bindGlobalShortcuts() {
        if (window.__sftpGlobalKeydownHandler) {
            document.removeEventListener('keydown', window.__sftpGlobalKeydownHandler);
        }
        if (window.__sftpGlobalPointerHandler) {
            document.removeEventListener('pointerdown', window.__sftpGlobalPointerHandler, true);
        }
        if (window.__sftpGlobalResizeHandler) {
            window.removeEventListener('resize', window.__sftpGlobalResizeHandler);
        }
        if (window.__sftpGlobalBlurHandler) {
            window.removeEventListener('blur', window.__sftpGlobalBlurHandler);
        }

        const handle = async (event) => {
            if (!document.getElementById('sftp-pane-left')) {
                document.removeEventListener('keydown', handle);
                closeContextMenu();
                closeRenamePrompt(null);
                return;
            }

            if (event.key === 'Escape' && ui.contextMenu && ui.contextMenu.classList.contains('show')) {
                event.preventDefault();
                closeContextMenu();
                return;
            }

            const activeTag = document.activeElement && document.activeElement.tagName
                ? document.activeElement.tagName.toLowerCase()
                : '';

            if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
                return;
            }

            const key = state.activePaneKey || 'left';

            if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
                event.preventDefault();
                selectAll(key);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
                event.preventDefault();
                copySelected(key);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
                event.preventDefault();
                await pasteToPane(key);
                return;
            }

            if (event.key === 'Delete') {
                event.preventDefault();
                await deleteSelected(key);
            }
        };

        const pointerHandle = (event) => {
            if (!document.getElementById('sftp-pane-left')) {
                document.removeEventListener('pointerdown', pointerHandle, true);
                closeContextMenu();
                closeRenamePrompt(null);
                return;
            }

            if (!ui.contextMenu || !ui.contextMenu.classList.contains('show')) return;
            if (event.target && event.target.closest && event.target.closest('#sftp-context-menu')) return;
            closeContextMenu();
        };

        const resizeHandle = () => {
            if (!document.getElementById('sftp-pane-left')) {
                window.removeEventListener('resize', resizeHandle);
                closeContextMenu();
                closeRenamePrompt(null);
                return;
            }
            closeContextMenu();
        };

        const blurHandle = () => {
            if (!document.getElementById('sftp-pane-left')) {
                window.removeEventListener('blur', blurHandle);
                closeContextMenu();
                closeRenamePrompt(null);
                return;
            }
            closeContextMenu();
        };

        window.__sftpGlobalKeydownHandler = handle;
        window.__sftpGlobalPointerHandler = pointerHandle;
        window.__sftpGlobalResizeHandler = resizeHandle;
        window.__sftpGlobalBlurHandler = blurHandle;

        document.addEventListener('keydown', handle);
        document.addEventListener('pointerdown', pointerHandle, true);
        window.addEventListener('resize', resizeHandle);
        window.addEventListener('blur', blurHandle);
    }

    function setupCopyProgressBridge() {
        if (!window.__termixSftpCopyProgressBridgeReady) {
            window.__termixSftpCopyProgressBridgeReady = true;
            window.electronAPI.on('sftp:copy-progress', (event, payload) => {
                if (typeof window.__termixSftpCopyProgressHandler === 'function') {
                    window.__termixSftpCopyProgressHandler(payload);
                }
            });
        }

        window.__termixSftpCopyProgressHandler = (payload) => {
            if (!payload || !payload.operationId || !payload.direction) return;
            const queue = getTransferQueue(payload.direction);
            if (!queue || payload.operationId !== queue.activeOperationId) return;
            queue.activeProgress = {
                ...payload
            };
            renderTransferQueue(payload.direction);
        };
    }

    async function init() {
        paneKeys.forEach((key) => bindPaneEvents(key));
        bindContextMenuEvents();
        setupCopyProgressBridge();
        bindGlobalShortcuts();

        activatePane('left', false);
        renderAllPanes();

        await loadTransferPreferences();
        await loadHosts();
        await refreshPane('left', '');

        setStatus('Ready', 'info');
    }

    init().catch((err) => {
        setStatus(`SFTP startup error: ${err.message || err}`, 'error');
    });
})();
