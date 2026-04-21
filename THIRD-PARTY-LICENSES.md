# Third-Party Licenses

Termix uses the following open-source packages. Each package's license is listed below.

---

## Runtime Dependencies

### @fontsource/jetbrains-mono
- **Version:** 5.2.8
- **License:** SIL Open Font License 1.1 (OFL-1.1)
- **Homepage:** https://fontsource.org/fonts/jetbrains-mono
- **Notes:** JetBrains Mono typeface by JetBrains. The font files are distributed under OFL-1.1.

---

### @fortawesome/fontawesome-free
- **Version:** 7.2.0
- **License:** Icons: CC BY 4.0 · Fonts: SIL OFL 1.1 · Code: MIT
- **Homepage:** https://fontawesome.com
- **Notes:** Font Awesome Free is a mixed-license package. SVG/JS icons are CC BY 4.0, web font files are OFL-1.1, and all other code (CSS, JS utilities) is MIT.

---

### electron-updater
- **Version:** 6.8.3
- **License:** MIT
- **Homepage:** https://github.com/electron-userland/electron-builder
- **Notes:** Part of the electron-builder project.

---

### firebase
- **Version:** 12.11.0
- **License:** Apache-2.0
- **Homepage:** https://firebase.google.com/
- **Source:** https://github.com/firebase/firebase-js-sdk

---

### kubitdb
- **Version:** 1.5.5
- **License:** MIT
- **Homepage:** https://github.com/DeveloperKubilay/kubitdb

---

### markdown-it
- **Version:** 14.1.1
- **License:** MIT
- **Homepage:** https://github.com/markdown-it/markdown-it

---

### monaco-editor
- **Version:** 0.55.1
- **License:** MIT
- **Homepage:** https://github.com/microsoft/monaco-editor
- **Notes:** Code editor component developed by Microsoft. Previously loaded from cdnjs.cloudflare.com CDN; now bundled locally.

---

### node-machine-id
- **Version:** 1.1.12
- **License:** MIT
- **Homepage:** https://github.com/automation-stack/node-machine-id

---

### node-pty
- **Version:** 1.1.0
- **License:** MIT
- **Homepage:** https://github.com/microsoft/node-pty
- **Notes:** Developed by Microsoft.

---

### serialport
- **Version:** 13.0.0
- **License:** MIT
- **Homepage:** https://github.com/serialport/node-serialport

---

### ssh2
- **Version:** 1.17.0
- **License:** MIT
- **Author:** Brian White
- **Homepage:** https://github.com/mscdex/ssh2
- **Notes:** License field is absent from package.json but the MIT license text is present in the bundled LICENSE file.

---

### xterm
- **Version:** 5.3.0
- **License:** MIT
- **Homepage:** https://github.com/xtermjs/xterm.js

---

### xterm-addon-fit
- **Version:** 0.8.0
- **License:** MIT
- **Homepage:** https://github.com/xtermjs/xterm.js

---

### xterm-addon-unicode11
- **Version:** 0.6.0
- **License:** MIT
- **Homepage:** https://github.com/xtermjs/xterm.js

---

### xterm-addon-webgl
- **Version:** 0.16.0
- **License:** MIT
- **Homepage:** https://github.com/xtermjs/xterm.js

---

## Development Dependencies

### electron
- **Version:** 41.1.0
- **License:** MIT
- **Homepage:** https://github.com/electron/electron
- **Notes:** Used only during development and packaging; not shipped as a runtime dependency in the final build.

---

### electron-builder
- **Version:** 26.8.1
- **License:** MIT
- **Homepage:** https://github.com/electron-userland/electron-builder
- **Notes:** Build tooling only; not included in the packaged application.

---

## License Texts

### MIT License (applies to: electron-updater, kubitdb, markdown-it, monaco-editor, node-machine-id, node-pty, serialport, ssh2, xterm, xterm-addon-fit, xterm-addon-unicode11, xterm-addon-webgl, electron, electron-builder)

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Apache License 2.0 (applies to: firebase)

Full license text: https://www.apache.org/licenses/LICENSE-2.0

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

### SIL Open Font License 1.1 (applies to: @fontsource/jetbrains-mono font files, @fortawesome/fontawesome-free font files)

Full license text: https://openfontlicense.org/

Key terms:
- Fonts may be used, studied, modified and redistributed freely.
- Fonts may not be sold by themselves.
- Modified font files must be distributed under the OFL or a compatible license.
- The font name may not be used to promote modified versions without permission.

---

### Creative Commons Attribution 4.0 International (applies to: @fortawesome/fontawesome-free SVG/JS icons)

Full license text: https://creativecommons.org/licenses/by/4.0/

Key terms:
- You are free to share and adapt the material for any purpose, even commercially.
- You must give appropriate credit, provide a link to the license, and indicate if changes were made.
- No additional restrictions — you may not apply legal terms that legally restrict others from doing what the license permits.
