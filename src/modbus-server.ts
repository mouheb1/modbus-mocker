// // modbus-server.js
// const ModbusRTU = require('modbus-serial');
// const http = require('http');
// const { Server } = require('socket.io');
// const getIPAddress = require('./helpers/getIPAddress');

// const holdingRegisters = new Uint16Array(10);
// console.log('Initialized holdingRegisters:', holdingRegisters);

// const httpServer = http.createServer();
// const io = new Server(httpServer, {
//     cors: {
//         origin: '*',
//         methods: ['GET', 'POST'],
//     },
// });

// const broadcastHoldingRegisters = () => {
//     io.emit('holdingRegistersUpdate', Array.from(holdingRegisters));
// };

// io.on('connection', (socket) => {
//     console.log('New WebSocket client connected:', socket.id);

//     socket.broadcast.emit('newDeviceConnected', {
//         message: `A new device has connected: ${socket.id}`,
//         timestamp: new Date().toISOString(),
//     });

//     socket.emit('holdingRegistersUpdate', Array.from(holdingRegisters));

//     socket.on('write', ({ address, value }) => {
//         if (address < 0 || address >= holdingRegisters.length) {
//             socket.emit('error', 'Invalid address');
//             return;
//         }
//         holdingRegisters[address] = value;
//         broadcastHoldingRegisters();
//     });

//     socket.on('disconnect', () => {
//         console.log('WebSocket client disconnected:', socket.id);
//         socket.broadcast.emit('deviceDisconnected', {
//             message: `A device has disconnected: ${socket.id}`,
//             timestamp: new Date().toISOString(),
//         });
//     });
// });

// getIPAddress((ip) => {
//     if (ip) {
//         httpServer.listen(5001, () => {
//             console.log(`WebSocket server is running at http://${ip}:5001`);
//         });

//         new ModbusRTU.ServerTCP({
//             holdingRegisters: holdingRegisters,
//         }, {
//             host: ip,
//             port: 502,
//             debug: true,
//         });

//         console.log(`Modbus server is running on http://${ip}:502`);
//     } else {
//         console.error('Could not determine IP address. Servers not started.');
//     }
// });
