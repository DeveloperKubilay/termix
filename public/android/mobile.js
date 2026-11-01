/* Touch affordances over the existing vanilla UI; never enabled by UA/viewport. */
(function () {
    'use strict';
    if (!window.TermixAndroid) return;
    const mobile = {
        initialized: false,
        toolbarCleanup: null,
        init() {
            if (this.initialized) return;
            this.initialized = true;
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.id = sidebar.id || 'android-navigation';
                sidebar.setAttribute('aria-label', 'Main navigation');
                sidebar.classList.add('collapsed');
            }
            const toggle = document.getElementById('sidebar-toggle');
            if (toggle) {
                this.makeButton(toggle, 'Open navigation');
                toggle.setAttribute('aria-controls', sidebar.id);
                toggle.setAttribute('aria-expanded', 'false');
            }
            const backdrop = document.createElement('button');
            backdrop.id = 'android-nav-backdrop';
            backdrop.type = 'button';
            backdrop.setAttribute('aria-label', 'Close navigation');
            backdrop.addEventListener('click', () => this.closeNavigation());
            document.body.appendChild(backdrop);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'android-nav-close';
            close.textContent = 'Close';
            close.addEventListener('click', () => this.closeNavigation());
            document.querySelector('.sidebar-header')?.appendChild(close);
            document.querySelectorAll('.sidebar-menu li').forEach(item => {
                this.makeButton(item, item.textContent.trim());
                item.addEventListener('click', () => this.closeNavigation());
            });
            document.getElementById('create-user-btn')?.addEventListener('click', () => this.closeNavigation());
            this.makeButton(document.getElementById('profile-btn'), 'Switch profile');
            this.makeButton(document.getElementById('create-user-btn'), 'Create local profile');
            this.makeButton(document.getElementById('close-drawer'), 'Close form');
            this.makeButton(document.getElementById('drawer-check'), 'Save form');
            this.applyCapabilities();
            this.updateViewport();
            window.addEventListener('resize', () => this.updateViewport());
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', () => this.updateViewport());
                window.visualViewport.addEventListener('scroll', () => this.updateViewport());
            }
            this.installTrustPrompt();
            this.installConnectionStopHandler();
        },
        makeButton(element, label) {
            if (!element || element.tagName === 'BUTTON') return;
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.setAttribute('aria-label', label);
            element.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    element.click();
                }
            });
        },
        setNavigation(open) {
            document.querySelector('.sidebar')?.classList.toggle('collapsed', !open);
            document.body.classList.toggle('android-nav-open', open);
            const toggle = document.getElementById('sidebar-toggle');
            toggle?.setAttribute('aria-expanded', String(open));
            toggle?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
            if (open) document.querySelector('.sidebar-menu li:not([hidden])')?.focus();
        },
        closeNavigation() { this.setNavigation(false); },
        updateViewport() {
            const viewport = window.visualViewport;
            document.documentElement.style.setProperty('--android-height', `${Math.round(viewport ? viewport.height : window.innerHeight)}px`);
            document.documentElement.style.setProperty('--android-top', `${Math.round(viewport ? viewport.offsetTop : 0)}px`);
            // ResizeObserver in ConnectionModule owns terminal fitting and backend resize.
        },
        applyCapabilities(root = document) {
            const has = name => window.TermixAndroid.hasCapability(name);
            const hide = selector => root.querySelectorAll(selector).forEach(element => {
                element.hidden = true;
                element.classList.add('android-unsupported');
            });
            const modules = { ai: 'ai', 'port-forwarding': 'portForwarding', sftp: 'sftp', keychain: 'keychain', 'known-hosts': 'knownHosts', snippets: 'snippets' };
            Object.entries(modules).forEach(([module, capability]) => {
                if (!has(capability)) hide(`[data-module="${module}"]`);
            });
            if (!has('cloud')) hide('#type-firebase-label, #type-qmm-label, #firebase-section, #qmm-section, #firebase-sync-options, #profile-sync-icon');
            if (!has('updater')) hide('.update-card');
            if (!has('ai') && !has('mcp')) {
                const card = root.querySelector('#ai-url')?.closest('.settings-card');
                if (card) { card.hidden = true; card.classList.add('android-unsupported'); }
            }
            hide('#btn-open-config-file, #btn-open-profile-folder');
            if (!has('local')) root.querySelector('button i.fa-terminal')?.closest('button')?.classList.add('android-unsupported');
            if (!has('serial')) root.querySelector('button i.fa-microchip')?.closest('button')?.classList.add('android-unsupported');
            const searchInput = root.querySelector('.search-bar input');
            if (searchInput) searchInput.placeholder = 'Search hosts or ssh...';
            root.querySelectorAll('input[type="text"], textarea').forEach(input => {
                if (input.classList.contains('xterm-helper-textarea')) return;
                input.setAttribute('autocapitalize', 'off');
                input.setAttribute('spellcheck', 'false');
                input.setAttribute('autocorrect', 'off');
                if (!input.hasAttribute('aria-label') && input.placeholder) input.setAttribute('aria-label', input.placeholder);
            });
        },
        installTrustPrompt() {
            window.electronAPI.on('android:host-key', async (_event, payload) => {
                if (!payload?.changed) return;
                window.notifyUser?.(`SSH host key changed for ${payload.address}:${payload.port}. Connection blocked. Verify the server before removing its Known Hosts entry.`, 'error');
            });
        },
        installConnectionStopHandler() {
            if (!window.electronAPI || typeof window.electronAPI.on !== 'function') return;
            window.electronAPI.on('android:all-connections-stopped', () => {
                if (window.TabManager && Array.isArray(window.TabManager.tabs)) {
                    const tabsToClose = window.TabManager.tabs.filter(t => t.id !== 'dashboard');
                    for (const tab of tabsToClose) {
                        try { window.TabManager.closeTab(tab.id); } catch (_) {}
                    }
                    if (typeof window.TabManager.activateTab === 'function') {
                        window.TabManager.activateTab('dashboard');
                    }
                }
                if (window.ModuleLoader && window.ModuleLoader.currentModule === 'sftp') {
                    try {
                        const hostsItem = document.querySelector('.sidebar-menu li[data-module="hosts"]');
                        if (hostsItem) {
                            document.querySelectorAll('.sidebar-menu li').forEach(i => i.classList.remove('active'));
                            hostsItem.classList.add('active');
                        }
                        window.ModuleLoader.loadModule('hosts');
                    } catch (_) {}
                }
            });
        },
        attachTerminal(container, term, sendInput, resizeTerminal, terminalSettings = {}) {
            const bar = document.createElement('div');
            bar.className = 'android-terminal-toolbar';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Terminal keys');

            const modifiers = ['Ctrl', 'Alt'].map(name => ({ name, held: false, latched: false, used: false, pointer: null, button: null }));
            const updateModifiers = () => modifiers.forEach(m => m.button.setAttribute('aria-pressed', String(m.held || m.latched)));
            const consumeModifiers = () => {
                const active = modifiers.map(m => m.held || m.latched);
                modifiers.forEach(m => { if (m.held) m.used = true; m.latched = false; });
                updateModifiers();
                return active;
            };
            const resetModifiers = () => {
                modifiers.forEach(m => { m.held = false; m.latched = false; m.pointer = null; });
                updateModifiers();
            };
            const stop = event => { event.preventDefault(); event.stopPropagation(); };
            const makeButton = (text, label) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = text;
                button.setAttribute('aria-label', label);
                bar.appendChild(button);
                return button;
            };
            // Keep the IME's textarea focused; don't let legacy touch/mouse handlers
            // on the terminal container interfere with a held modifier.
            bar.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
            bar.addEventListener('mousedown', stop);
            bar.addEventListener('contextmenu', stop);
            modifiers.forEach(m => {
                const button = m.button = makeButton(m.name, `${m.name} modifier (hold or tap)`);
                button.addEventListener('pointerdown', event => {
                    stop(event);
                    if (m.pointer !== null) return;
                    m.pointer = event.pointerId;
                    m.held = true;
                    m.used = false;
                    try { button.setPointerCapture(event.pointerId); } catch (_) {}
                    updateModifiers();
                });
                button.addEventListener('pointerup', event => {
                    stop(event);
                    if (m.pointer !== event.pointerId) return;
                    m.pointer = null;
                    m.held = false;
                    m.latched = m.used ? false : !m.latched;
                    updateModifiers();
                });
                const cancel = () => {
                    if (m.pointer === null) return;
                    m.pointer = null;
                    m.held = false;
                    m.latched = false;
                    updateModifiers();
                };
                button.addEventListener('pointercancel', cancel);
                button.addEventListener('lostpointercapture', cancel);
                button.addEventListener('click', event => {
                    stop(event);
                    // Pointer clicks have already been handled, regardless of delay.
                    if (event.detail !== 0) return;
                    m.latched = !m.latched;
                    updateModifiers();
                });
            });
            updateModifiers();
            window.addEventListener('blur', resetModifiers);

            const add = (text, label, action) => {
                const button = makeButton(text, label);
                const run = () => Promise.resolve().then(action).catch(error => window.notifyUser?.(error.message, 'error'));
                button.addEventListener('pointerdown', event => { stop(event); run(); });
                button.addEventListener('click', event => { stop(event); if (event.detail === 0) run(); });
                return button;
            };
            const arrow = (code, ctrl, alt) => {
                const modifier = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
                if (modifier !== 1) return `\x1b[1;${modifier}${code}`;
                return `\x1b${term.modes?.applicationCursorKeysMode ? 'O' : '['}${code}`;
            };
            let isBeforeInputHandling = false;
            let lastBeforeInput = { text: '', time: 0 };
            let lastTerminalData = { text: '', time: 0 };
            const DEDUP_WINDOW_MS = 80;

            const filterInput = data => {
                if (!data) return data;
                const now = Date.now();
                if (isBeforeInputHandling) {
                    // Sourced from beforeinput: deduplicate if term.onData already dispatched this within window
                    if (lastTerminalData.text && data === lastTerminalData.text && (now - lastTerminalData.time) < DEDUP_WINDOW_MS) {
                        lastTerminalData = { text: '', time: 0 };
                        return '';
                    }
                    lastBeforeInput = { text: data, time: now };
                } else {
                    // Sourced from term.onData: deduplicate if beforeinput already dispatched this within window
                    if (lastBeforeInput.text && data === lastBeforeInput.text && (now - lastBeforeInput.time) < DEDUP_WINDOW_MS) {
                        lastBeforeInput = { text: '', time: 0 };
                        return '';
                    }
                    lastTerminalData = { text: data, time: now };
                }
                const [ctrl, alt] = consumeModifiers();
                const cursor = /^\x1b(?:\[|O)([ABCD])$/.exec(data);
                if (cursor) return arrow(cursor[1], ctrl, alt);
                // Never mutate escape sequences or bracketed paste payloads.
                if (data.startsWith('\x1b')) return data;
                let result = data;
                if (ctrl && data.length === 1) {
                    const code = data.toUpperCase().charCodeAt(0);
                    if (code >= 64 && code <= 95) result = String.fromCharCode(code - 64);
                    else if (data === ' ') result = '\x00';
                    else if (data === '?') result = '\x7f';
                }
                return alt ? '\x1b' + result : result;
            };
            [['Esc', 'Escape', '\x1b'], ['Tab', 'Tab', '\t']].forEach(([text, label, data]) => {
                add(text, label, () => sendInput(filterInput(data)));
            });
            [['↑', 'Arrow up', 'A'], ['↓', 'Arrow down', 'B'], ['←', 'Arrow left', 'D'], ['→', 'Arrow right', 'C']].forEach(([text, label, code]) => {
                add(text, label, () => {
                    const [ctrl, alt] = consumeModifiers();
                    sendInput(arrow(code, ctrl, alt));
                });
            });

            add('Copy', 'Copy terminal text', async () => {
                let text = '';
                const domSel = typeof window.getSelection === 'function' ? window.getSelection() : null;
                if (domSel && !domSel.isCollapsed) {
                    text = domSel.toString();
                }
                if (!text && typeof term.getSelection === 'function') {
                    text = term.getSelection();
                }
                if (!text && term.buffer && term.buffer.active) {
                    const buffer = term.buffer.active;
                    const lines = [];
                    const start = Math.max(0, buffer.viewportY);
                    const end = Math.min(buffer.length, start + term.rows);
                    for (let i = start; i < end; i++) {
                        const line = buffer.getLine(i);
                        if (line) lines.push(line.translateToString(true));
                    }
                    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                        lines.pop();
                    }
                    text = lines.join('\n');
                }
                if (!text) {
                    return;
                }
                if (window.clipboard && typeof window.clipboard.writeText === 'function') {
                    await window.clipboard.writeText(text);
                }
            });

            add('Paste', 'Paste clipboard into terminal', async () => {
                if (window.clipboard && typeof window.clipboard.readText === 'function') {
                    const text = await window.clipboard.readText();
                    if (typeof text === 'string' && text) {
                        if (typeof term.paste === 'function') {
                            term.paste(text);
                        } else {
                            sendInput(text);
                        }
                    }
                }
                term.focus();
                try { term.scrollToBottom(); } catch (_) {}
            });

            add('Clear', 'Clear terminal screen', () => sendInput('\x0c'));
            add('Kbd', 'Show terminal keyboard', async () => {
                term.focus();
                await window.TermixAndroid.showKeyboard();
            });

            // Reuse the buttons and their modifier handlers in the mobile grid order.
            const buttonOrder = ['Tab', 'Esc', 'Copy', 'Clear', '↑', '↓', 'Ctrl', 'Paste', 'Alt', '←', '→', 'Kbd'];
            const buttons = new Map(Array.from(bar.querySelectorAll('button'), button => [button.textContent, button]));
            buttonOrder.forEach(label => bar.appendChild(buttons.get(label)));

            let copySelection = terminalSettings.rightClickCopyPaste === true;
            const onTerminalSettingsChanged = event => {
                if (typeof event.detail?.rightClickCopyPaste === 'boolean') copySelection = event.detail.rightClickCopyPaste;
            };
            window.addEventListener('termix:terminal-settings-changed', onTerminalSettingsChanged);
            const copyCompletedSelection = () => {
                const text = term.getSelection?.();
                if (copySelection && text) {
                    Promise.resolve(window.clipboard?.writeText(text)).catch(() => window.notifyUser?.('Could not copy selection.', 'error'));
                }
            };

            const body = document.createElement('div');
            body.className = 'android-terminal-body';
            body.appendChild(term.element);
            container.classList.add('android-terminal');
            container.appendChild(body);
            container.appendChild(bar);

            const textarea = term.textarea || (term.element && term.element.querySelector ? term.element.querySelector('.xterm-helper-textarea') : null) || (container.querySelector ? container.querySelector('.xterm-helper-textarea') : null);

            // Fast typing input interception for Android software keyboards
            const handleBeforeInput = event => {
                const type = event.inputType;
                const data = event.data;
                if (type === 'insertText' || type === 'insertReplacementText') {
                    if (typeof data === 'string' && data.length > 0) {
                        event.preventDefault();
                        isBeforeInputHandling = true;
                        const filtered = filterInput(data);
                        isBeforeInputHandling = false;
                        if (filtered) sendInput(filtered);
                    }
                } else if (type === 'insertLineBreak' || type === 'insertParagraph') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    const filtered = filterInput('\r');
                    isBeforeInputHandling = false;
                    if (filtered) sendInput(filtered);
                } else if (type === 'deleteContentBackward') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    const filtered = filterInput('\x7f');
                    isBeforeInputHandling = false;
                    if (filtered) sendInput(filtered);
                } else if (type === 'deleteWordBackward') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    const filtered = filterInput('\x17');
                    isBeforeInputHandling = false;
                    if (filtered) sendInput(filtered);
                }
            };

            const handleCompositionEnd = event => {
                if (event.data) {
                    isBeforeInputHandling = true;
                    const filtered = filterInput(event.data);
                    isBeforeInputHandling = false;
                    if (filtered) sendInput(filtered);
                }
                try { if (textarea) textarea.value = ''; } catch (_) {}
            };

            if (textarea && typeof textarea.addEventListener === 'function') {
                textarea.addEventListener('beforeinput', handleBeforeInput);
                textarea.addEventListener('compositionend', handleCompositionEnd);
            }

            // Own touch gestures before xterm's bubbling viewport handlers run.
            const TOUCH_SLOP = 12;
            const LONG_PRESS_MS = 450;
            const now = () => performance.now();
            let gesture = 'idle';
            let touchId = null;
            let startX = 0;
            let startY = 0;
            let lastY = 0;
            let pointX = 0;
            let pointY = 0;
            let startedWithSelection = false;
            let longPressTimer = null;
            let edgeTimer = null;
            let edgeDirection = 0;
            let motionFrame = null;
            let scrollRemainder = 0;
            let velocity = 0;
            let samples = [];
            let selectionAnchor = null;
            let fixedEndpoint = null;
            let draggingEndpoint = null;
            let handleOffsetX = 0;
            let handleOffsetY = 0;
            let disposed = false;

            const hasSelection = () => Boolean(term.hasSelection?.());
            const geometry = () => {
                const screen = container.querySelector?.('.xterm-screen') || body;
                const rect = screen.getBoundingClientRect();
                const cellW = rect.width / (term.cols || 80);
                const cellH = rect.height / (term.rows || 24);
                return cellW > 0 && cellH > 0 ? { rect, cellW, cellH } : null;
            };
            const getTouchCoords = (clientX, clientY) => {
                const dimensions = geometry();
                const buffer = term.buffer?.active;
                if (!dimensions || !buffer) return null;
                const { rect, cellW, cellH } = dimensions;
                const col = Math.max(0, Math.min(term.cols - 1, Math.floor((clientX - rect.left) / cellW)));
                const row = Math.max(0, Math.min(term.rows - 1, Math.floor((clientY - rect.top) / cellH)));
                return { col, lineIndex: buffer.viewportY + row, buffer };
            };
            const indexOf = point => point.y * term.cols + point.x;
            const pointAt = index => ({ x: index % term.cols, y: Math.floor(index / term.cols) });
            const selectRange = (start, end) => {
                if (end <= start) return;
                const point = pointAt(start);
                term.select?.(point.x, point.y, end - start);
            };

            // Endpoints are buffer-cell positions, not JavaScript string indices.
            const handles = ['start', 'end'].map(endpoint => {
                const handle = document.createElement('div');
                handle.className = `android-selection-handle android-selection-handle-${endpoint}`;
                handle.dataset.endpoint = endpoint;
                handle.setAttribute('aria-label', `${endpoint === 'start' ? 'Start' : 'End'} of terminal selection`);
                handle.hidden = true;
                body.appendChild(handle);
                return handle;
            });
            const updateHandles = () => {
                const range = hasSelection() ? term.getSelectionPosition?.() : null;
                const dimensions = geometry();
                const buffer = term.buffer?.active;
                const bounds = body.getBoundingClientRect();
                handles.forEach((handle, i) => {
                    const endpoint = range && (i === 0 ? range.start : range.end);
                    const row = endpoint && buffer ? endpoint.y - buffer.viewportY : -1;
                    const visible = dimensions && endpoint && row >= 0 && row < term.rows;
                    handle.hidden = !visible;
                    if (!visible) return;
                    const left = dimensions.rect.left - bounds.left + endpoint.x * dimensions.cellW;
                    // Keep the full hit target reachable at the first/last column.
                    const minLeft = i === 0 ? 44 : 0;
                    const maxLeft = Math.max(minLeft, bounds.width - (i === 0 ? 0 : 44));
                    handle.style.left = `${Math.max(minLeft, Math.min(maxLeft, left))}px`;
                    const top = dimensions.rect.top - bounds.top + (row + 1) * dimensions.cellH;
                    handle.style.top = `${Math.min(top, Math.max(0, bounds.height - 32))}px`;
                });
            };
            const clearSelection = () => {
                term.clearSelection?.();
                selectionAnchor = null;
                updateHandles();
            };
            const selectAt = (clientX, clientY) => {
                const pos = getTouchCoords(clientX, clientY);
                if (!pos) return false;
                const line = pos.buffer.getLine?.(pos.lineIndex);
                if (!line) return false;
                // xterm cells account for wide glyphs and combining characters.
                const cellAt = col => line.getCell?.(col);
                let startCol = pos.col;
                if (cellAt(startCol)?.getWidth() === 0 && startCol > 0) startCol--;
                const charsAt = col => cellAt(col)?.getChars() || ' ';
                let endCol = startCol + Math.max(1, cellAt(startCol)?.getWidth() || 1);
                if (/\S/.test(charsAt(startCol))) {
                    while (startCol > 0) {
                        let previous = startCol - 1;
                        if (cellAt(previous)?.getWidth() === 0 && previous > 0) previous--;
                        if (!/\S/.test(charsAt(previous))) break;
                        startCol = previous;
                    }
                    while (endCol < term.cols && /\S/.test(charsAt(endCol))) {
                        endCol += Math.max(1, cellAt(endCol)?.getWidth() || 1);
                    }
                }
                selectionAnchor = {
                    start: pos.lineIndex * term.cols + startCol,
                    end: pos.lineIndex * term.cols + Math.min(term.cols, endCol)
                };
                selectRange(selectionAnchor.start, selectionAnchor.end);
                updateHandles();
                return true;
            };
            const updateSelection = () => {
                const pos = getTouchCoords(pointX, pointY);
                if (!pos) return;
                const line = pos.buffer.getLine?.(pos.lineIndex);
                const col = line?.getCell?.(pos.col)?.getWidth() === 0 ? Math.max(0, pos.col - 1) : pos.col;
                const start = pos.lineIndex * term.cols + col;
                const end = start + Math.max(1, line?.getCell?.(col)?.getWidth() || 1);
                if (draggingEndpoint) {
                    const dimensions = geometry();
                    let boundary = Math.max(0, Math.min(term.cols, Math.round((pointX - dimensions.rect.left) / dimensions.cellW)));
                    if (line?.getCell?.(boundary)?.getWidth() === 0) boundary += draggingEndpoint === 'start' ? -1 : 1;
                    const moving = pos.lineIndex * term.cols + boundary;
                    selectRange(Math.min(moving, fixedEndpoint), Math.max(moving, fixedEndpoint));
                } else if (selectionAnchor) {
                    selectRange(Math.min(selectionAnchor.start, start), Math.max(selectionAnchor.end, end));
                }
                updateHandles();
            };

            const cancelLongPress = () => {
                if (longPressTimer !== null) clearTimeout(longPressTimer);
                longPressTimer = null;
            };
            const stopEdgeScroll = () => {
                if (edgeTimer !== null) clearTimeout(edgeTimer);
                edgeTimer = null;
                edgeDirection = 0;
            };
            const stopMotion = () => {
                if (motionFrame !== null) cancelAnimationFrame(motionFrame);
                motionFrame = null;
                velocity = 0;
                scrollRemainder = 0;
            };
            const cancelGesture = () => {
                cancelLongPress();
                stopEdgeScroll();
                stopMotion();
                gesture = touchId === null ? 'idle' : 'cancelled';
                selectionAnchor = null;
                draggingEndpoint = null;
                fixedEndpoint = null;
                samples = [];
            };
            const scrollPixels = pixels => {
                const dimensions = geometry();
                const buffer = term.buffer?.active;
                if (!dimensions || !buffer) return false;
                const direction = Math.sign(pixels);
                if ((direction < 0 && buffer.viewportY <= 0) || (direction > 0 && buffer.viewportY >= buffer.baseY)) {
                    scrollRemainder = 0;
                    return false;
                }
                scrollRemainder += pixels;
                const lines = Math.trunc(scrollRemainder / dimensions.cellH);
                if (lines) {
                    const target = Math.max(0, Math.min(buffer.baseY, buffer.viewportY + lines));
                    const amount = target - buffer.viewportY;
                    scrollRemainder -= lines * dimensions.cellH;
                    if (amount) term.scrollLines(amount);
                    updateHandles();
                }
                return true;
            };
            const rememberMovement = y => {
                const time = now();
                samples.push({ y, time });
                samples = samples.filter(sample => time - sample.time <= 100);
            };
            const startInertia = () => {
                const recent = samples.filter(sample => now() - sample.time <= 100);
                const first = recent[0];
                const last = recent[recent.length - 1];
                const elapsed = first && last ? last.time - first.time : 0;
                velocity = elapsed > 0 ? Math.max(-3, Math.min(3, (first.y - last.y) / elapsed)) : 0;
                if (Math.abs(velocity) < 0.12) { gesture = 'idle'; return; }
                gesture = 'inertia';
                let previous = now();
                const tick = () => {
                    motionFrame = null;
                    if (disposed || gesture !== 'inertia') return;
                    const time = now();
                    const dt = Math.min(32, time - previous);
                    previous = time;
                    const decay = Math.exp(-dt / 240);
                    const moved = scrollPixels(velocity * 240 * (1 - decay));
                    velocity *= decay;
                    if (!moved || Math.abs(velocity) < 0.04) {
                        gesture = 'idle';
                        stopMotion();
                        return;
                    }
                    motionFrame = requestAnimationFrame(tick);
                };
                motionFrame = requestAnimationFrame(tick);
            };
            const checkEdgeScroll = () => {
                const dimensions = geometry();
                if (!dimensions) return;
                const { rect } = dimensions;
                const bottom = rect.top + rect.height;
                // No interior hot zone: reaching the first/last row must not scroll.
                const direction = pointY < rect.top - 8 ? -1 : pointY > bottom + 8 ? 1 : 0;
                if (direction === edgeDirection) return;
                stopEdgeScroll();
                if (!direction) return;
                edgeDirection = direction;
                const tick = () => {
                    edgeTimer = null;
                    if (disposed || gesture !== 'selecting') { stopEdgeScroll(); return; }
                    const buffer = term.buffer?.active;
                    if (!buffer || (direction < 0 ? buffer.viewportY <= 0 : buffer.viewportY >= buffer.baseY)) {
                        stopEdgeScroll();
                        return;
                    }
                    term.scrollLines(direction);
                    updateSelection();
                    edgeTimer = setTimeout(tick, 120);
                };
                edgeTimer = setTimeout(tick, 250);
            };
            const ownTouch = event => {
                if (event.cancelable) event.preventDefault();
                event.stopPropagation();
            };
            const findTouch = list => Array.from(list || []).find(touch => touch.identifier === touchId);
            const onTouchStart = event => {
                ownTouch(event);
                if (gesture === 'cancelled' || event.touches.length !== 1 || touchId !== null) {
                    cancelGesture();
                    gesture = 'cancelled';
                    return;
                }
                stopMotion();
                const touch = event.touches[0];
                touchId = touch.identifier;
                startX = pointX = touch.clientX;
                startY = lastY = pointY = touch.clientY;
                samples = [];
                rememberMovement(lastY);
                startedWithSelection = hasSelection();
                gesture = 'pending';
                const handle = event.target.closest?.('.android-selection-handle');
                const range = startedWithSelection ? term.getSelectionPosition?.() : null;
                if (handle && range) {
                    draggingEndpoint = handle.dataset.endpoint;
                    fixedEndpoint = indexOf(draggingEndpoint === 'start' ? range.end : range.start);
                    const endpoint = draggingEndpoint === 'start' ? range.start : range.end;
                    const dimensions = geometry();
                    handleOffsetX = dimensions ? touch.clientX - (dimensions.rect.left + endpoint.x * dimensions.cellW) : 0;
                    handleOffsetY = dimensions ? touch.clientY - (dimensions.rect.top + (endpoint.y - term.buffer.active.viewportY + 0.5) * dimensions.cellH) : 0;
                    gesture = 'selecting';
                    return;
                }
                draggingEndpoint = null;
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    if (gesture !== 'pending' || disposed) return;
                    if (selectAt(pointX, pointY)) {
                        gesture = 'selecting';
                        try { window.navigator?.vibrate?.(25); } catch (_) {}
                    }
                }, LONG_PRESS_MS);
            };
            const onTouchMove = event => {
                ownTouch(event);
                if (event.touches.length !== 1) { cancelGesture(); gesture = 'cancelled'; return; }
                const touch = findTouch(event.touches);
                if (!touch || gesture === 'cancelled' || gesture === 'idle') return;
                pointX = touch.clientX;
                pointY = touch.clientY;
                if (gesture === 'selecting') {
                    if (draggingEndpoint) {
                        pointX -= handleOffsetX;
                        pointY -= handleOffsetY;
                    }
                    updateSelection();
                    checkEdgeScroll();
                    return;
                }
                if (gesture === 'pending' && Math.hypot(pointX - startX, pointY - startY) > TOUCH_SLOP) {
                    cancelLongPress();
                    clearSelection();
                    gesture = 'scrolling';
                    // Consume the recognition slop instead of jumping on the first frame.
                    lastY = startY + Math.sign(pointY - startY) * Math.min(TOUCH_SLOP, Math.abs(pointY - startY));
                }
                if (gesture === 'scrolling') {
                    scrollPixels(lastY - pointY);
                    lastY = pointY;
                    rememberMovement(lastY);
                }
            };
            const onTouchEnd = event => {
                ownTouch(event);
                if (event.touches?.length) {
                    if (gesture !== 'cancelled') cancelGesture();
                    gesture = 'cancelled';
                    return;
                }
                cancelLongPress();
                stopEdgeScroll();
                const previous = gesture;
                const touch = findTouch(event.changedTouches);
                const isTap = !touch || Math.hypot(touch.clientX - startX, touch.clientY - startY) <= TOUCH_SLOP;
                touchId = null;
                gesture = 'idle';
                draggingEndpoint = null;
                fixedEndpoint = null;
                if (previous === 'selecting') {
                    copyCompletedSelection();
                } else if (previous === 'scrolling') {
                    startInertia();
                } else if (previous === 'pending' && isTap) {
                    if (startedWithSelection || hasSelection()) {
                        clearSelection();
                    } else {
                        term.focus();
                        window.TermixAndroid.showKeyboard?.().catch(() => {});
                    }
                }
                updateHandles();
            };
            const onTouchCancel = event => {
                ownTouch(event);
                cancelGesture();
                if (!event.touches?.length) { touchId = null; gesture = 'idle'; }
            };
            const resetGesture = () => {
                cancelGesture();
                // Blur/resize may swallow touchend; a future touch must not stay cancelled.
                touchId = null;
                gesture = 'idle';
            };
            const onVisibilityChange = () => { if (document.hidden) resetGesture(); };
            const onCompatibilityMouse = event => {
                if (event.sourceCapabilities?.firesTouchEvents) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            };
            const onContextMenu = event => {
                event.preventDefault();
                event.stopPropagation();
            };
            const touchOptions = { capture: true, passive: false };
            body.addEventListener('touchstart', onTouchStart, touchOptions);
            body.addEventListener('touchmove', onTouchMove, touchOptions);
            body.addEventListener('touchend', onTouchEnd, touchOptions);
            body.addEventListener('touchcancel', onTouchCancel, touchOptions);
            body.addEventListener('mousedown', onCompatibilityMouse, true);
            body.addEventListener('mouseup', onCompatibilityMouse, true);
            body.addEventListener('click', onCompatibilityMouse, true);
            body.addEventListener('contextmenu', onContextMenu, true);
            window.addEventListener('blur', resetGesture);
            document.addEventListener('visibilitychange', onVisibilityChange);
            const selectionListener = term.onSelectionChange?.(updateHandles);
            const scrollListener = term.onScroll?.(updateHandles);

            let frame = null;
            let resizeSnapshot = null;
            const onViewportResize = () => {
                resetGesture();
                // Capture before ConnectionModule's already-queued fit runs. xterm
                // may change viewportY while shrinking rows for the software keyboard.
                if (!resizeSnapshot) {
                    const buffer = term.buffer?.active;
                    resizeSnapshot = {
                        viewportY: buffer?.viewportY,
                        followBottom: buffer && buffer.viewportY >= buffer.baseY && !hasSelection()
                    };
                }
                if (frame !== null) cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => {
                    frame = null;
                    const snapshot = resizeSnapshot;
                    resizeSnapshot = null;
                    if (disposed || !container.isConnected || !container.clientHeight) return;
                    resizeTerminal?.();
                    if (snapshot.followBottom) term.scrollToBottom();
                    else if (typeof snapshot.viewportY === 'number') term.scrollToLine?.(Math.min(snapshot.viewportY, term.buffer.active.baseY));
                    updateHandles();
                });
            };
            window.visualViewport?.addEventListener('resize', onViewportResize);
            const observer = new ResizeObserver(onViewportResize);
            observer.observe(body);
            onViewportResize();
            return {
                filterInput,
                dispose() {
                    disposed = true;
                    cancelGesture();
                    selectionListener?.dispose();
                    scrollListener?.dispose();
                    handles.forEach(handle => handle.remove());
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                    window.removeEventListener('blur', resetGesture);
                    if (textarea && typeof textarea.removeEventListener === 'function') {
                        textarea.removeEventListener('beforeinput', handleBeforeInput);
                        textarea.removeEventListener('compositionend', handleCompositionEnd);
                    }
                    body.removeEventListener('touchstart', onTouchStart, true);
                    body.removeEventListener('touchmove', onTouchMove, true);
                    body.removeEventListener('touchend', onTouchEnd, true);
                    body.removeEventListener('touchcancel', onTouchCancel, true);
                    body.removeEventListener('mousedown', onCompatibilityMouse, true);
                    body.removeEventListener('mouseup', onCompatibilityMouse, true);
                    body.removeEventListener('click', onCompatibilityMouse, true);
                    body.removeEventListener('contextmenu', onContextMenu, true);
                    observer.disconnect();
                    if (frame !== null) cancelAnimationFrame(frame);
                    window.removeEventListener('blur', resetModifiers);
                    window.removeEventListener('termix:terminal-settings-changed', onTerminalSettingsChanged);
                    window.visualViewport?.removeEventListener('resize', onViewportResize);
                    bar.remove();
                }
            };
        }
    };
    window.TermixMobile = mobile;
})();
