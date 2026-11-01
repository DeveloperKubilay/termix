'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MOBILE_JS_PATH = path.join(__dirname, '../../public/android/mobile.js');
const MOBILE_JS_CODE = fs.readFileSync(MOBILE_JS_PATH, 'utf8');

// Deterministic fake timer and requestAnimationFrame clock
function createClock(initialTime = 1000) {
    let now = initialTime;
    let timerSeq = 1;
    const timers = new Map();
    const rafs = new Map();

    function setTimeout(fn, delay = 0, ...args) {
        const id = timerSeq++;
        timers.set(id, { fn: () => fn(...args), time: now + Math.max(0, delay), interval: 0 });
        return id;
    }
    function clearTimeout(id) {
        timers.delete(id);
    }
    function setInterval(fn, delay = 0, ...args) {
        const id = timerSeq++;
        const interval = Math.max(1, delay);
        timers.set(id, { fn: () => fn(...args), time: now + interval, interval });
        return id;
    }
    function clearInterval(id) {
        timers.delete(id);
    }
    function requestAnimationFrame(fn) {
        const id = timerSeq++;
        rafs.set(id, fn);
        return id;
    }
    function cancelAnimationFrame(id) {
        rafs.delete(id);
    }

    function tick(ms = 0) {
        now += ms;
        while (true) {
            let nextId = null;
            let earliestTime = Infinity;
            for (const [id, t] of timers.entries()) {
                if (t.time <= now && t.time < earliestTime) {
                    earliestTime = t.time;
                    nextId = id;
                }
            }
            if (nextId === null) break;
            const t = timers.get(nextId);
            if (t.interval > 0) {
                t.time += t.interval;
            } else {
                timers.delete(nextId);
            }
            t.fn();
        }
    }

    function stepFrame(frameDelta = 16) {
        const entries = Array.from(rafs.entries());
        rafs.clear();
        now += frameDelta;
        for (const [, fn] of entries) {
            fn(now);
        }
    }

    function advance(ms, frameDelta = 16) {
        let remaining = ms;
        while (remaining > 0) {
            const step = Math.min(frameDelta, remaining);
            tick(step);
            stepFrame(0);
            remaining -= step;
        }
    }

    return {
        now: () => now,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame,
        cancelAnimationFrame,
        tick,
        stepFrame,
        advance,
        pendingTimersCount: () => timers.size,
        pendingRafsCount: () => rafs.size
    };
}

// Robust mock terminal buffer line with getCell / getChars / getWidth for Unicode support
function createMockLine(str, cols = 80) {
    const chars = Array.from(str);
    const cells = [];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cp = ch.codePointAt(0);
        const isWide = cp > 0x2000 && !ch.match(/[ -⁯←-⇿]/);
        if (isWide) {
            cells.push({ getChars: () => ch, getWidth: () => 2 });
            cells.push({ getChars: () => '', getWidth: () => 0 });
        } else {
            cells.push({ getChars: () => ch, getWidth: () => 1 });
        }
    }
    while (cells.length < cols) {
        cells.push({ getChars: () => ' ', getWidth: () => 1 });
    }
    return {
        translateToString: (trimRight = false) => {
            if (!trimRight) return str;
            return str.replace(/\s+$/, '');
        },
        length: cols,
        getCell: col => cells[col] || { getChars: () => ' ', getWidth: () => 1 }
    };
}

function createTermMock(options = {}) {
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const baseY = options.baseY !== undefined ? options.baseY : 10;
    const defaultText = options.defaultText || 'user@host:~$ ls -la /tmp';

    const lines = new Map();
    function getLine(idx) {
        if (!lines.has(idx)) {
            lines.set(idx, createMockLine(defaultText, cols));
        }
        return lines.get(idx);
    }

    const selectionListeners = new Set();
    const scrollListeners = new Set();

    const term = {
        cols,
        rows,
        modes: { applicationCursorKeysMode: false },
        buffer: {
            active: {
                viewportY: options.viewportY !== undefined ? options.viewportY : 0,
                baseY,
                length: baseY + rows,
                cursorX: 0,
                cursorY: 0,
                getLine
            }
        },
        selection: '',
        selectionRange: null,
        scrolledLines: 0,
        focused: false,
        scrollToBottomCalls: 0,
        scrollToLineCalls: [],

        scrollLines(n) {
            this.scrolledLines += n;
            const prev = this.buffer.active.viewportY;
            this.buffer.active.viewportY = Math.max(0, Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + n));
            if (this.buffer.active.viewportY !== prev) {
                for (const cb of scrollListeners) cb(this.buffer.active.viewportY);
            }
        },
        scrollToBottom() {
            this.scrollToBottomCalls++;
            const prev = this.buffer.active.viewportY;
            this.buffer.active.viewportY = this.buffer.active.baseY;
            if (this.buffer.active.viewportY !== prev) {
                for (const cb of scrollListeners) cb(this.buffer.active.viewportY);
            }
        },
        scrollToLine(line) {
            this.scrollToLineCalls.push(line);
            const prev = this.buffer.active.viewportY;
            this.buffer.active.viewportY = Math.max(0, Math.min(this.buffer.active.baseY, line));
            if (this.buffer.active.viewportY !== prev) {
                for (const cb of scrollListeners) cb(this.buffer.active.viewportY);
            }
        },
        select(col, row, len) {
            this.selection = `selected:${col}:${row}:${len}`;
            const endIdx = row * cols + col + len;
            this.selectionRange = {
                start: { x: col, y: row },
                end: { x: endIdx % cols, y: Math.floor(endIdx / cols) }
            };
            for (const cb of selectionListeners) cb();
        },
        getSelection() {
            return this.selection;
        },
        hasSelection() {
            return Boolean(this.selection);
        },
        clearSelection() {
            const had = Boolean(this.selection);
            this.selection = '';
            this.selectionRange = null;
            if (had) {
                for (const cb of selectionListeners) cb();
            }
        },
        getSelectionPosition() {
            return this.selectionRange;
        },
        onSelectionChange(cb) {
            selectionListeners.add(cb);
            return { dispose: () => selectionListeners.delete(cb) };
        },
        onScroll(cb) {
            scrollListeners.add(cb);
            return { dispose: () => scrollListeners.delete(cb) };
        },
        focus() {
            this.focused = true;
        },
        paste(text) {
            this.pastedText = text;
        },
        setLine(idx, text) {
            lines.set(idx, createMockLine(text, cols));
        }
    };
    return term;
}

function setupTerminal(options = {}) {
    const clock = createClock(options.initialTime || 1000);
    const dom = new JSDOM(
        '<!DOCTYPE html><html><head></head><body><div id="terminal-container"></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true }
    );
    const { window } = dom;
    const { document } = window;

    // Fake timers on window
    Object.defineProperty(window, 'performance', {
        value: { now: () => clock.now() },
        configurable: true
    });
    window.Date.now = () => Math.floor(clock.now());
    window.setTimeout = clock.setTimeout;
    window.clearTimeout = clock.clearTimeout;
    window.setInterval = clock.setInterval;
    window.clearInterval = clock.clearInterval;
    window.requestAnimationFrame = clock.requestAnimationFrame;
    window.cancelAnimationFrame = clock.cancelAnimationFrame;

    let keyboardShown = false;
    if (options.installAndroid !== false) {
        window.TermixAndroid = {
            showKeyboard: async () => { keyboardShown = true; },
            hasCapability: () => true,
            invoke: async () => {}
        };
    }

    let resizeObserverCallback = null;
    window.ResizeObserver = class {
        constructor(callback) { resizeObserverCallback = callback; }
        observe() {}
        unobserve() {}
        disconnect() {}
    };

    const container = document.getElementById('terminal-container');
    Object.defineProperty(container, 'clientHeight', { value: 520, configurable: true });
    container.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 800, height: 520, right: 800, bottom: 520
    });

    const term = createTermMock(options);

    const termElement = document.createElement('div');
    termElement.className = 'terminal xterm';
    termElement.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480
    });

    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    screen.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480
    });

    const textarea = document.createElement('textarea');
    textarea.className = 'xterm-helper-textarea';

    termElement.appendChild(screen);
    termElement.appendChild(textarea);
    term.element = termElement;
    term.textarea = textarea;

    let clipboardContent = '';
    let clipboardWrites = 0;
    window.clipboard = {
        writeText: async t => {
            clipboardContent = t;
            clipboardWrites++;
        },
        readText: async () => clipboardContent
    };

    // Load mobile.js
    window.eval(MOBILE_JS_CODE);

    let toolbar = null;
    const inputs = [];
    let resizeCount = 0;
    if (window.TermixMobile) {
        toolbar = window.TermixMobile.attachTerminal(
            container,
            term,
            data => inputs.push(data),
            () => { resizeCount++; },
            options.terminalSettings
        );
    }

    const body = container.querySelector('.android-terminal-body');
    if (body) {
        Object.defineProperty(body, 'clientHeight', { value: 480, configurable: true });
        body.getBoundingClientRect = () => ({
            left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480
        });
    }

    // Flush initial resize frame
    clock.advance(32);

    const button = name => {
        const bar = container.querySelector('.android-terminal-toolbar');
        if (!bar) return null;
        return Array.from(bar.querySelectorAll('button')).find(b => b.textContent === name);
    };

    const emitPointer = (target, type, properties = {}) => {
        const ev = new window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(ev, { pointerId: 1, detail: 1 }, properties);
        target.dispatchEvent(ev);
        return ev;
    };

    const tap = name => {
        const btn = button(name);
        assert.ok(btn, `Button '${name}' must exist in toolbar`);
        emitPointer(btn, 'pointerdown');
        emitPointer(btn, 'pointerup');
        emitPointer(btn, 'click');
    };

    const touchEvent = (target, type, touches = [], changedTouches = []) => {
        const ev = new window.Event(type, { bubbles: true, cancelable: true });
        ev.touches = touches;
        ev.changedTouches = changedTouches.length ? changedTouches : touches;
        target.dispatchEvent(ev);
        return ev;
    };

    const touchPoint = (x, y, id = 0) => ({
        identifier: id,
        clientX: x,
        clientY: y,
        pageX: x,
        pageY: y
    });

    return {
        dom,
        window,
        document,
        clock,
        container,
        term,
        screen,
        textarea,
        body,
        toolbar,
        inputs,
        button,
        tap,
        emitPointer,
        touchEvent,
        touchPoint,
        getClipboard: () => clipboardContent,
        getClipboardWrites: () => clipboardWrites,
        getKeyboardShown: () => keyboardShown,
        getResizeCount: () => resizeCount,
        triggerResize: () => {
            if (resizeObserverCallback) resizeObserverCallback();
        },
        getHandles: () => body ? Array.from(body.querySelectorAll('.android-selection-handle')) : []
    };
}

// --------------------------------------------------------------------------
// Existing Term Compatibility Tests (deterministic & preserved assertions)
// --------------------------------------------------------------------------

test('Android toolbar follows the requested two-row button order', () => {
    const h = setupTerminal();
    assert.deepEqual(Array.from(h.container.querySelectorAll('.android-terminal-toolbar button'), button => button.textContent),
        ['Tab', 'Esc', 'Copy', 'Clear', '↑', '↓', 'Ctrl', 'Paste', 'Alt', '←', '→', 'Kbd']);
    h.toolbar.dispose();
});

test('copy selection preference writes only at gesture completion and updates live', async () => {
    const h = setupTerminal({ terminalSettings: { rightClickCopyPaste: true } });
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(10, 10)]);
    h.clock.advance(460);
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 40)]);
    assert.equal(h.getClipboardWrites(), 0);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 40)]);
    assert.equal(h.getClipboardWrites(), 1);
    assert.equal(h.getClipboard(), h.term.getSelection());
    h.window.dispatchEvent(new h.window.CustomEvent('termix:terminal-settings-changed', { detail: { rightClickCopyPaste: false } }));
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(10, 10)]);
    h.clock.advance(460);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(10, 10)]);
    assert.equal(h.getClipboardWrites(), 1);
    h.tap('Copy');
    await Promise.resolve();
    assert.equal(h.getClipboardWrites(), 2);
    h.toolbar.dispose();
});

test('Ctrl tap/hold, Alt and cancellation preserve exact terminal bytes', () => {
    const h = setupTerminal();
    h.tap('Ctrl');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.emitPointer(h.button('Ctrl'), 'pointerdown');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    assert.equal(h.toolbar.filterInput('d'), '\x04');
    h.emitPointer(h.button('Ctrl'), 'pointerup');
    h.emitPointer(h.button('Ctrl'), 'click');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.tap('Alt');
    assert.equal(h.toolbar.filterInput('x'), '\x1bx');
    h.emitPointer(h.button('Ctrl'), 'pointerdown');
    h.emitPointer(h.button('Ctrl'), 'pointercancel');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.tap('Ctrl');
    h.window.dispatchEvent(new h.window.Event('blur'));
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.toolbar.dispose();
});

test('delayed pointer click cannot relatch a consumed modifier', () => {
    const h = setupTerminal();
    h.emitPointer(h.button('Ctrl'), 'pointerdown');
    h.emitPointer(h.button('Ctrl'), 'pointerup');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    h.emitPointer(h.button('Ctrl'), 'click');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.toolbar.dispose();
});

test('arrows follow cursor mode and modifiers without corrupting escape payloads', async () => {
    const h = setupTerminal();
    for (const [name, code] of [['↑', 'A'], ['↓', 'B'], ['←', 'D'], ['→', 'C']]) {
        h.tap(name);
        await Promise.resolve();
        assert.equal(h.inputs.pop(), '\x1b[' + code);
    }
    h.term.modes.applicationCursorKeysMode = true;
    h.tap('↑');
    await Promise.resolve();
    assert.equal(h.inputs.pop(), '\x1bOA');
    h.tap('Ctrl');
    h.tap('↑');
    await Promise.resolve();
    assert.equal(h.inputs.pop(), '\x1b[1;5A');
    h.tap('Alt');
    assert.equal(h.toolbar.filterInput('\x1b[D'), '\x1b[1;3D');
    h.tap('Ctrl');
    assert.equal(h.toolbar.filterInput('\x1b[200~hello\x1b[201~'), '\x1b[200~hello\x1b[201~');
    h.toolbar.dispose();
});

test('fast typing via beforeinput intercepts keystrokes, prevents default, and dispatches immediately', () => {
    const h = setupTerminal();
    const emitBeforeInput = (inputType, data) => {
        const ev = new h.window.Event('beforeinput', { cancelable: true });
        ev.inputType = inputType;
        ev.data = data;
        let defaultPrevented = false;
        ev.preventDefault = () => { defaultPrevented = true; };
        h.textarea.dispatchEvent(ev);
        return defaultPrevented;
    };

    // Fast sequence: 'h', 'e', 'l', 'l', 'o'
    for (const ch of ['h', 'e', 'l', 'l', 'o']) {
        const prevented = emitBeforeInput('insertText', ch);
        assert.equal(prevented, true, `beforeinput for '${ch}' should be prevented`);
        assert.equal(h.inputs.pop(), ch);
    }

    // Enter and Backspace
    assert.equal(emitBeforeInput('insertLineBreak', null), true);
    assert.equal(h.inputs.pop(), '\r');

    assert.equal(emitBeforeInput('deleteContentBackward', null), true);
    assert.equal(h.inputs.pop(), '\x7f');

    // Ctrl latch + beforeinput
    h.tap('Ctrl');
    assert.equal(emitBeforeInput('insertText', 'c'), true);
    assert.equal(h.inputs.pop(), '\x03'); // Ctrl+C byte

    // Bidirectional deduplication (e.g. Space handled by both xterm keypress and soft keyboard beforeinput)
    // Case 1: term.onData fires first -> beforeinput is swallowed
    const firstSpace = h.toolbar.filterInput(' ');
    assert.equal(firstSpace, ' ');
    emitBeforeInput('insertText', ' ');
    assert.equal(h.inputs.length, 0, 'Duplicate beforeinput within window should be swallowed');

    // Case 2: beforeinput fires first -> term.onData filterInput returns empty string
    h.clock.advance(150); // advance past 80ms window
    emitBeforeInput('insertText', ' ');
    assert.equal(h.inputs.pop(), ' ');
    const dupSpace = h.toolbar.filterInput(' ');
    assert.equal(dupSpace, '', 'Duplicate term.onData within window should return empty string');

    // Case 3: repeated characters after window are preserved (e.g. deliberate double spaces)
    h.clock.advance(150);
    assert.equal(h.toolbar.filterInput(' '), ' ');
    h.clock.advance(150);
    assert.equal(h.toolbar.filterInput(' '), ' ');

    h.toolbar.dispose();
});

test('touch text selection and Copy button integration', async () => {
    const h = setupTerminal();

    // Start touch at col 0, row 0 (x = 10, y = 10)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(10, 10)]);

    // Advance clock past long press threshold (~500ms)
    h.clock.advance(500);

    // Selection should be activated for first word 'user@host:~$' (12 characters)
    assert.ok(h.term.hasSelection(), 'Terminal should have selection after long press');
    assert.equal(h.term.getSelection(), 'selected:0:0:12');

    // Tap Copy button
    h.tap('Copy');
    await Promise.resolve();
    assert.equal(h.getClipboard(), 'selected:0:0:12', 'Copy should write selected text to clipboard');

    h.toolbar.dispose();
});

test('contextmenu event is defaultPrevented on body to stop accidental paste', () => {
    const h = setupTerminal();
    const cmEvent = new h.window.Event('contextmenu', { cancelable: true });
    h.body.dispatchEvent(cmEvent);
    assert.equal(cmEvent.defaultPrevented, true, 'contextmenu should be prevented on Android terminal body');
    h.toolbar.dispose();
});

test('swipe gestures scroll lines without triggering selection or keyboard focus', () => {
    const h = setupTerminal();

    // Start touch
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 200)]);

    // Swipe up by 50px (>12 CSS px threshold)
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 150)]);

    // Advance clock past long press time
    h.clock.advance(500);

    assert.equal(h.term.hasSelection(), false, 'Swipe should cancel long press and not select');
    assert.ok(h.term.scrolledLines > 0, 'Swipe should have scrolled terminal lines upward');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 150)]);

    assert.equal(h.term.focused, false, 'Swipe touch end should not trigger keyboard focus');
    h.toolbar.dispose();
});

test('touch drag expands selection across lines and isolates clipboard', async () => {
    const h = setupTerminal();

    // Touchstart at col 0, row 0
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(10, 10)]);

    // Long press
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());
    assert.equal(h.getClipboardWrites(), 0, 'Selection must not write to clipboard automatically');

    // Drag to col 20 on next row (x = 200, y = 30)
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(200, 30)]);

    assert.ok(h.term.getSelection().startsWith('selected:'), 'Selection should expand on move');
    assert.equal(h.getClipboardWrites(), 0, 'Moving selection must not pollute clipboard');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(200, 30)]);
    assert.equal(h.getClipboardWrites(), 0, 'Ending selection must still not touch clipboard');

    // Only tapping Copy button writes to clipboard
    h.tap('Copy');
    await Promise.resolve();
    assert.equal(h.getClipboardWrites(), 1, 'Copy button must explicitly write to clipboard');

    h.toolbar.dispose();
});

test('edge auto-scrolls terminal buffer lines when dragging near top or bottom boundary', () => {
    const h = setupTerminal({ baseY: 20 });

    // Touchstart and long press to select
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());

    const initialScrolled = h.term.scrolledLines;

    // Drag outside screen bottom boundary (height 480, pointY = 495 > 488) with dwell >=200ms
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 495)]);

    // Dwell for >= 200ms (advance 300ms)
    h.clock.advance(300);

    assert.ok(h.term.scrolledLines > initialScrolled, 'Edge auto-scroll should have scrolled buffer downward');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 495)]);
    h.toolbar.dispose();
});

test('dragging in middle while selecting adjusts selection and does NOT scroll terminal lines', () => {
    const h = setupTerminal();

    // Long press to enter selection mode
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());

    const initialScrolled = h.term.scrolledLines;

    // Drag in the middle of screen (Y = 240, far from edges)
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(200, 240)]);
    h.clock.advance(100);

    assert.equal(h.term.scrolledLines, initialScrolled, 'Moving in middle must never scroll viewport');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(200, 240)]);
    assert.ok(h.term.hasSelection(), 'Selection should remain active after drag ends');

    // Single tap with active selection dismisses selection
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(200, 240)]);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(200, 240)]);

    assert.equal(h.term.hasSelection(), false, 'Single tap with active selection must dismiss selection');
    h.toolbar.dispose();
});

// --------------------------------------------------------------------------
// New Regression Tests: Real Nested DOM, Capture, Gestures, & Edge Contracts
// --------------------------------------------------------------------------

test('Android body capture exclusive touch owner prevents simulated xterm and container handlers', () => {
    const h = setupTerminal();
    let containerTouchFired = false;
    let screenTouchFired = false;

    // Simulate legacy container listener
    h.container.addEventListener('touchstart', () => { containerTouchFired = true; });
    // Simulate xterm touch listener on .xterm-screen
    h.screen.addEventListener('touchstart', () => { screenTouchFired = true; });

    // Touch event originating on .xterm-screen
    const ev = h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100)]);

    assert.equal(screenTouchFired, false, 'Simulated xterm touch listener must never be reached');
    assert.equal(containerTouchFired, false, 'Container legacy handler must never be reached');
    assert.equal(ev.defaultPrevented, true, 'Touch event must be defaultPrevented by capture handler');
    h.toolbar.dispose();
});

test('touch identifiers are tracked and untracked touches do not disturb active gesture', () => {
    const h = setupTerminal();
    // Start gesture with specific touch identifier
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 200, 101)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection(), 'Touch 101 should trigger selection');

    const selectionBefore = h.term.getSelection();

    // Move with a different touch identifier (999) - should be ignored
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(250, 250, 999)]);
    assert.equal(h.term.getSelection(), selectionBefore, 'Untracked identifier must not update selection');

    // Move with the tracked touch identifier (101) - updates selection
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(250, 250, 101)]);
    assert.notEqual(h.term.getSelection(), selectionBefore, 'Tracked touch identifier should update selection');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(250, 250, 101)]);
    h.toolbar.dispose();
});

test('multi-touch cancels active gesture until all touches are released', () => {
    const h = setupTerminal();

    // First touch starts
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 200, 1)]);

    // Second touch arrives before long press finishes
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 200, 1), h.touchPoint(150, 250, 2)]);

    // Advance clock past 500ms
    h.clock.advance(550);
    assert.equal(h.term.hasSelection(), false, 'Multi-touch must cancel long press');

    // Move during multi-touch state does not scroll
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 150, 1), h.touchPoint(150, 200, 2)]);
    assert.equal(h.term.scrolledLines, 0, 'Multi-touch must not scroll terminal');

    // Release first touch, but second touch still held
    h.touchEvent(h.screen, 'touchend', [h.touchPoint(150, 200, 2)], [h.touchPoint(100, 150, 1)]);
    h.clock.advance(500);
    assert.equal(h.term.hasSelection(), false, 'Remaining touch from multi-touch must remain cancelled');

    // Release last touch
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(150, 200, 2)]);

    // Fresh single touch now works normally
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10, 3)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection(), 'New single touch after all touches released works normally');
    h.toolbar.dispose();
});

test('momentum scrolling via RAF after fast swipe release, new touch cancels, and bounds clamp', () => {
    const h = setupTerminal({ baseY: 20 });

    // Start fast swipe upward
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 300)]);
    h.clock.advance(20);
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 250)]);
    h.clock.advance(20);
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 150)]); // 100px move in 20ms -> high velocity
    h.clock.advance(10);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 150)]);

    const linesAfterRelease = h.term.scrolledLines;
    assert.ok(linesAfterRelease > 0, 'Direct swipe should have scrolled initial lines');

    // Step RAF animation frames to advance momentum
    h.clock.advance(60);
    assert.ok(h.term.scrolledLines > linesAfterRelease, 'Momentum via RAF should continue scrolling lines');

    const linesDuringMomentum = h.term.scrolledLines;

    // A new touchstart cancels momentum immediately
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 200)]);
    h.clock.advance(60);
    assert.equal(h.term.scrolledLines, linesDuringMomentum, 'New touch must cancel inertia momentum immediately');
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 200)]);
    h.toolbar.dispose();

    // Bounds clamp: controller inertia starts near bound, reaches bound, clamps, and stops pending RAF
    // 1. Bottom bound clamp (near baseY: 20)
    {
        const hBound = setupTerminal({ viewportY: 18, baseY: 20 });
        hBound.touchEvent(hBound.screen, 'touchstart', [hBound.touchPoint(100, 300)]);
        hBound.clock.advance(20);
        hBound.touchEvent(hBound.screen, 'touchmove', [hBound.touchPoint(100, 240)]);
        hBound.clock.advance(10);
        hBound.touchEvent(hBound.screen, 'touchend', [], [hBound.touchPoint(100, 240)]);

        assert.equal(hBound.clock.pendingRafsCount(), 1, 'Inertia should schedule RAF on release');
        // Advance clock across frames until bound is reached
        hBound.clock.advance(48);
        assert.equal(hBound.term.buffer.active.viewportY, 20, 'ViewportY should clamp to baseY');
        assert.equal(hBound.clock.pendingRafsCount(), 0, 'Inertia must stop pending RAF when bound is reached');
        hBound.toolbar.dispose();
    }

    // 2. Top bound clamp (near 0)
    {
        const hTop = setupTerminal({ viewportY: 2, baseY: 20 });
        hTop.touchEvent(hTop.screen, 'touchstart', [hTop.touchPoint(100, 100)]);
        hTop.clock.advance(20);
        hTop.touchEvent(hTop.screen, 'touchmove', [hTop.touchPoint(100, 180)]);
        hTop.clock.advance(10);
        hTop.touchEvent(hTop.screen, 'touchend', [], [hTop.touchPoint(100, 180)]);

        assert.equal(hTop.clock.pendingRafsCount(), 1, 'Inertia should schedule RAF on release');
        hTop.clock.advance(48);
        assert.equal(hTop.term.buffer.active.viewportY, 0, 'ViewportY should clamp to 0');
        assert.equal(hTop.clock.pendingRafsCount(), 0, 'Inertia must stop pending RAF when top bound is reached');
        hTop.toolbar.dispose();
    }
});

test('selection handles stay reachable at first and last terminal columns', () => {
    const h = setupTerminal();
    h.term.select(0, 1, 160);
    const handles = h.getHandles();
    const start = handles.find(el => el.dataset.endpoint === 'start');
    const end = handles.find(el => el.dataset.endpoint === 'end');
    assert.equal(start.hidden, false);
    assert.ok(parseFloat(start.style.left) >= 44, 'Start handle hit target must not extend left of body');
    h.term.select(0, 1, 79);
    assert.equal(end.hidden, false);
    assert.ok(parseFloat(end.style.left) <= 756, 'End handle hit target must fit inside 800px body');
    h.toolbar.dispose();
});

test('selection handles render with data-endpoint start/end and sync with terminal subscriptions', () => {
    const h = setupTerminal();

    // Select text via long press
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10, 1)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());
    assert.equal(h.term.getSelection(), 'selected:0:0:12');

    // Lift first touch to complete initial long press
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(15, 10, 1)]);

    // Verify handles exist in DOM with correct data attributes
    const handles = h.getHandles();
    assert.equal(handles.length, 2, 'Should create start and end selection handles');
    const startHandle = handles.find(el => el.dataset.endpoint === 'start');
    const endHandle = handles.find(el => el.dataset.endpoint === 'end');
    assert.ok(startHandle, 'Start handle with data-endpoint="start" must exist');
    assert.ok(endHandle, 'End handle with data-endpoint="end" must exist');
    assert.equal(startHandle.hidden, false, 'Start handle must be visible while selected');
    assert.equal(endHandle.hidden, false, 'End handle must be visible while selected');

    // Drag end handle to expand selection range
    const handleTouchStart = new h.window.Event('touchstart', { bubbles: true, cancelable: true });
    handleTouchStart.touches = [h.touchPoint(parseInt(endHandle.style.left, 10) || 120, parseInt(endHandle.style.top, 10) || 20, 2)];
    endHandle.dispatchEvent(handleTouchStart);

    // Drag handle to col 25 (x = 250, y = 10)
    h.touchEvent(h.body, 'touchmove', [h.touchPoint(250, 10, 2)]);
    assert.equal(h.term.getSelection(), 'selected:0:0:25', 'Dragging end handle must update selection range');

    h.touchEvent(h.body, 'touchend', [], [h.touchPoint(250, 10, 2)]);
    assert.equal(h.term.getSelection(), 'selected:0:0:25', 'Selection range must remain after handle release');

    // Clearing selection hides handles
    h.term.clearSelection();
    assert.equal(startHandle.hidden, true, 'Start handle must be hidden when selection cleared');
    assert.equal(endHandle.hidden, true, 'End handle must be hidden when selection cleared');

    h.toolbar.dispose();
});

test('outside swipe clears existing selection and scrolls terminal', () => {
    const h = setupTerminal();

    // Long press to create selection
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(15, 10)]);

    const initialScrolled = h.term.scrolledLines;

    // Start a new swipe outside selection (>12 CSS px)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(200, 300)]);
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(200, 240)]); // 60px swipe
    h.clock.advance(50);

    assert.equal(h.term.hasSelection(), false, 'Outside swipe must clear existing selection');
    assert.ok(h.term.scrolledLines > initialScrolled, 'Outside swipe must scroll terminal lines');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(200, 240)]);
    h.toolbar.dispose();
});

test('outside tap clears selection without keyboard, second tap opens keyboard', () => {
    const h = setupTerminal();

    // Create selection via long press
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(15, 10)]);

    // First tap outside selection (stationary tap <= 12px)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(300, 300)]);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(300, 300)]);

    assert.equal(h.term.hasSelection(), false, 'First tap must dismiss active selection');
    assert.equal(h.getKeyboardShown(), false, 'First tap dismissing selection must not open keyboard');

    // Second tap at same place (now with no active selection)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(300, 300)]);
    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(300, 300)]);

    assert.equal(h.getKeyboardShown(), true, 'Second tap without selection must open keyboard');
    assert.equal(h.term.focused, true, 'Second tap without selection must focus terminal');

    h.toolbar.dispose();
});

test('selection edge scroll only outside screen boundary with >=200ms dwell, not within 50px', () => {
    const h = setupTerminal({ baseY: 20 });

    // Select text via long press
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());

    const scrolledBefore = h.term.scrolledLines;

    // Move within 50px of bottom edge, but inside boundary (e.g. Y = 460 of height 480)
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 460)]);
    h.clock.advance(400);

    assert.equal(h.term.scrolledLines, scrolledBefore, 'Moving within 50px inside boundary must NOT edge scroll');

    // Move outside boundary (Y = 495 > 488 bottom + 8) but with dwell < 200ms
    h.touchEvent(h.screen, 'touchmove', [h.touchPoint(100, 495)]);
    h.clock.advance(150);
    assert.equal(h.term.scrolledLines, scrolledBefore, 'Dwell < 200ms outside boundary must not scroll yet');

    // Dwell reaches >= 200ms (advance another 150ms -> 300ms total dwell)
    h.clock.advance(150);
    assert.ok(h.term.scrolledLines > scrolledBefore, 'Dwell >= 200ms outside boundary must edge scroll');

    h.touchEvent(h.screen, 'touchend', [], [h.touchPoint(100, 495)]);
    h.toolbar.dispose();
});

test('touchcancel, blur, and dispose cancel active gestures with no late effects', () => {
    const h = setupTerminal();

    // Start touch
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);

    // Window blur cancels pending long press
    h.window.dispatchEvent(new h.window.Event('blur'));
    h.clock.advance(600);
    assert.equal(h.term.hasSelection(), false, 'Blur must cancel pending long press');

    // Start another touch and trigger touchcancel
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);
    h.touchEvent(h.screen, 'touchcancel', []);
    h.clock.advance(600);
    assert.equal(h.term.hasSelection(), false, 'touchcancel must cancel pending long press');

    // Dispose cleans up all handles, timers, and listeners
    h.toolbar.dispose();
    h.clock.advance(1000);
    assert.equal(h.clock.pendingTimersCount(), 0, 'No timers should remain pending after dispose');
    assert.equal(h.clock.pendingRafsCount(), 0, 'No RAFs should remain pending after dispose');
    assert.equal(h.getHandles().length, 0, 'Handles should be removed from DOM on dispose');
});

test('resize preserves history (scrollToLine) and follows bottom only when previously bottom without selection', () => {
    // Case 1: At bottom (viewportY == baseY) without selection -> follows bottom
    {
        const h = setupTerminal({ viewportY: 10, baseY: 10 });
        const callsBefore = h.term.scrollToBottomCalls;
        h.triggerResize();
        h.clock.advance(32);
        assert.equal(h.term.scrollToBottomCalls, callsBefore + 1, 'Should call scrollToBottom when previously at bottom without selection');
        h.toolbar.dispose();
    }

    // Case 2: Scrolled into history (viewportY < baseY) -> preserves history line
    {
        const h = setupTerminal({ viewportY: 3, baseY: 10 });
        h.triggerResize();
        h.clock.advance(32);
        assert.equal(h.term.scrollToBottomCalls, 0, 'Should NOT call scrollToBottom when scrolled into history');
        assert.ok(h.term.scrollToLineCalls.includes(3), 'Should call scrollToLine with preserved history index');
        h.toolbar.dispose();
    }

    // Case 3: At bottom (viewportY == baseY) but WITH active selection -> preserves position
    {
        const h = setupTerminal({ viewportY: 10, baseY: 10 });
        const callsBefore = h.term.scrollToBottomCalls;
        h.term.select(0, 0, 5);
        h.triggerResize();
        h.clock.advance(32);
        assert.equal(h.term.scrollToBottomCalls, callsBefore, 'Should NOT call scrollToBottom when active selection exists');
        h.toolbar.dispose();
    }
});

test('Android missing => no mobile installed', () => {
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div id="container"></div></body></html>',
        { runScripts: 'outside-only' }
    );
    // window.TermixAndroid is undefined
    dom.window.eval(MOBILE_JS_CODE);
    assert.equal(dom.window.TermixMobile, undefined, 'TermixMobile must not install when TermixAndroid is missing');
});

test('Unicode wide character cell based selection handles full glyphs without splitting', () => {
    // Line contains a wide character (emoji or CJK)
    const h = setupTerminal({ defaultText: 'hello 🚀 world' });
    // 'hello ' is 6 chars (cols 0-5)
    // '🚀' starts at col 6 (cell width 2: occupies col 6 and 7)
    // Touch on col 6 (x = 65, y = 10)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(65, 10)]);
    h.clock.advance(500);

    assert.ok(h.term.hasSelection(), 'Should select emoji word');
    // Start col 6, width 2 -> len 2
    assert.equal(h.term.getSelection(), 'selected:6:0:2', 'Wide character selection must span full cell width');
    h.toolbar.dispose();
});

test('resize restores saved pre-RAF viewport when external fit changes viewportY before RAF', () => {
    // Initial viewport is at line 85 of 135
    const h = setupTerminal({ viewportY: 85, baseY: 135 });
    // Active selection exists
    h.term.select(5, 85, 10);
    assert.ok(h.term.hasSelection());

    // Trigger viewport resize (e.g. keyboard opening shrinks container/body)
    h.triggerResize();

    // Simulate ConnectionModule or xterm fit synchronously altering viewportY
    // (e.g. keyboard open shrinking rows causes viewportY to shift to 74 and baseY to 151)
    h.term.buffer.active.viewportY = 74;
    h.term.buffer.active.baseY = 151;

    // RAF fires after the external mutation
    h.clock.advance(32);

    // Pre-RAF viewport (85) must be restored via scrollToLine(85)
    assert.equal(h.term.buffer.active.viewportY, 85, 'Saved pre-RAF viewportY must be restored');
    assert.ok(h.term.scrollToLineCalls.includes(85), 'scrollToLine should be called with pre-RAF viewport');
    h.toolbar.dispose();
});

test('touch on selection handle without move preserves handle range and does not dismiss selection', () => {
    const h = setupTerminal();
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection());
    const selBefore = h.term.getSelection();

    const handles = h.getHandles();
    const startHandle = handles.find(el => el.dataset.endpoint === 'start');
    assert.ok(startHandle);

    // Touch down on start handle
    const pt = h.touchPoint(20, 20);
    h.touchEvent(startHandle, 'touchstart', [pt]);

    // Touch up on start handle without moving
    h.touchEvent(startHandle, 'touchend', [], [pt]);

    assert.ok(h.term.hasSelection(), 'Selection should remain active after stationary tap on handle');
    assert.equal(h.term.getSelection(), selBefore, 'Selection range must be preserved');
    assert.equal(h.getKeyboardShown(), false, 'Tapping handle must not show keyboard');
    h.toolbar.dispose();
});

test('compatibility mouse events from touch are suppressed while hardware mouse events pass through', () => {
    const h = setupTerminal();

    // Synthetic mouse event generated by touch (sourceCapabilities.firesTouchEvents = true)
    const touchMouse = new h.window.Event('mousedown', { bubbles: true, cancelable: true });
    touchMouse.sourceCapabilities = { firesTouchEvents: true };
    h.body.dispatchEvent(touchMouse);
    assert.equal(touchMouse.defaultPrevented, true, 'Touch-generated mouse event must be defaultPrevented');

    // Hardware mouse event (sourceCapabilities.firesTouchEvents = false)
    const hardwareMouse = new h.window.Event('mousedown', { bubbles: true, cancelable: true });
    hardwareMouse.sourceCapabilities = { firesTouchEvents: false };
    h.body.dispatchEvent(hardwareMouse);
    assert.equal(hardwareMouse.defaultPrevented, false, 'Hardware mouse event must not be prevented');

    // Standard mouse event without sourceCapabilities
    const standardMouse = new h.window.Event('mousedown', { bubbles: true, cancelable: true });
    h.body.dispatchEvent(standardMouse);
    assert.equal(standardMouse.defaultPrevented, false, 'Standard mouse event without touch capabilities must not be prevented');

    h.toolbar.dispose();
});

test('dispose removes all capture touch listeners from body', () => {
    const h = setupTerminal();
    let containerTouchReceived = false;
    h.container.addEventListener('touchstart', () => { containerTouchReceived = true; });

    // While active, capture listener stops propagation
    const ev1 = h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100)]);
    assert.equal(containerTouchReceived, false, 'Capture listener stops propagation while active');
    assert.equal(ev1.defaultPrevented, true);

    // Dispose mobile toolbar and listeners
    h.toolbar.dispose();

    // Touch event after dispose should bubble up to container and not be defaultPrevented
    const ev2 = h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100)]);
    assert.equal(containerTouchReceived, true, 'Container should receive touch events after dispose');
    assert.equal(ev2.defaultPrevented, false, 'Touch event should not be prevented after dispose');
});

test('new touch after blur or resize without prior touchend successfully starts selecting', () => {
    const h = setupTerminal();

    // 1. Touch started, then blur occurs without touchend (app switch)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100, 1)]);
    h.window.dispatchEvent(new h.window.Event('blur'));

    // New touch starts without previous touchend ever having fired
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10, 2)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection(), 'New touch after blur without touchend must start selection');
    h.term.clearSelection();

    // 2. Touch started, then resize occurs without touchend (keyboard or orientation shift)
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(100, 100, 3)]);
    h.triggerResize();

    // New touch starts without previous touchend
    h.touchEvent(h.screen, 'touchstart', [h.touchPoint(15, 10, 4)]);
    h.clock.advance(500);
    assert.ok(h.term.hasSelection(), 'New touch after resize without touchend must start selection');

    h.toolbar.dispose();
});
