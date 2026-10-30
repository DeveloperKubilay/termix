/* Android-only boot: the actual application starts after the native runtime is ready. */
(() => {
    'use strict';

    function loadScript(source) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = source;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${source}`));
            document.head.appendChild(script);
        });
    }

    function showError(error) {
        const panel = document.createElement('section');
        panel.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#11111b;color:#cdd6f4;padding:32px 20px;overflow:auto;font:16px system-ui';
        const heading = document.createElement('h1');
        heading.textContent = 'Termix could not start';
        const message = document.createElement('p');
        message.textContent = error && error.message || String(error);
        const retry = document.createElement('button');
        retry.textContent = 'Try again';
        retry.style.cssText = 'padding:12px 20px;font:inherit';
        retry.addEventListener('click', () => location.reload());
        panel.append(heading, message, retry);
        document.body.appendChild(panel);
    }

    (async () => {
        if (!window.termixAndroidReady) throw new Error('Android bridge is not available.');
        await window.termixAndroidReady;
        await loadScript('public/android/mobile.js');
        await loadScript('public/app.js');
    })().catch(showError);
})();
