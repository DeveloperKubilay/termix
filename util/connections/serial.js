const { EventEmitter } = require('events');

module.exports = (data) => {
    return new Promise((resolve, reject) => {
        // Dependencies check
        try {
            require.resolve('serialport');
        } catch (e) {
            return reject(new Error('SerialPort module not found. Please install it with: npm install serialport'));
        }

        const { SerialPort } = require('serialport');
        
        const sessionId = Date.now();
        const emitter = new EventEmitter();

        const sendToFrontend = (msg) => {
            emitter.emit('data', msg);
        };

        // Example options: path needs to be provided (e.g. COM5, /dev/ttyUSB0)
        // baudRate defaults to 9600 if not provided
        const port = new SerialPort({
            path: data.address || data.path, // 'address' field reused for COM port path often
            baudRate: parseInt(data.baudRate) || 9600,
            autoOpen: false
        });

        port.open((err) => {
            if (err) {
                sendToFrontend({ type: "error", message: err.message });
                return reject(err);
            }

            sendToFrontend({ type: "connected" });

            const writeToStream = (msg) => {
                if (msg.type === "input") {
                    try {
                        if (port.isOpen) port.write(msg.message);
                    } catch (_) {}
                }
                // Serial usually doesn't handle resize events like PTY/SSH
            };

            port.on('data', (d) => {
                try {
                    sendToFrontend({ type: "data", data: d.toString() });
                } catch (_) {}
            });

            port.on('close', () => {
                try {
                    sendToFrontend({ type: "disconnected" });
                } catch (_) {}
            });

            port.on('error', (err) => {
                try {
                    sendToFrontend({ type: "error", message: err.message });
                } catch (_) {}
            });

            resolve({
                sessionId: sessionId,
                on: (evt, cb) => emitter.on(evt, cb),
                write: writeToStream,
                end: () => {
                    try {
                        if (port.isOpen) {
                            port.close(() => {});
                        }
                    } catch (_) {}
                }
            });
        });
    });
};
