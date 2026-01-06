const { SerialPort } = require('serialport');

module.exports = async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer,
            serialNumber: port.serialNumber,
            vendorId: port.vendorId,
            productId: port.productId
        }));
    } catch (err) {
        console.error('Error listing serial ports:', err);
        return [];
    }
};
