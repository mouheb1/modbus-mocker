// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ModbusRTU = require('modbus-serial');
const getIPAddress = require('./helpers/getIPAddress');

const app = express();
const HTTP_PORT = 5000;     // Express + Socket.IO port
const MODBUS_PORT = 502;    // Modbus TCP port

// In-memory mapping: room (string) => unitID (number)
// We’ll assign each newly created "room" a unique Modbus unit ID
let nextUnitID = 1; // Start assigning from 1, 2, 3...
const roomUnitMap = {}; // e.g. { "RoomA": 1, "RoomB": 2 }

// In-memory store of the actual Modbus data per unit ID
// Example: holdingRegisters[1] = Uint16Array(10) for unitID=1
const holdingRegisters = {};

// Helper: get or initialize holding registers for a given unit ID
function getOrInitRegisters(unitID) {
  if (!holdingRegisters[unitID]) {
    holdingRegisters[unitID] = new Uint16Array(10);
  }
  return holdingRegisters[unitID];
}

// Serve static files
app.use(express.static(path.join(__dirname)));

// We also track a list of "rooms" for the HTML dropdown
app.get('/rooms', (req, res) => {
  // Return an array of the known rooms
  res.json({ rooms: Object.keys(roomUnitMap) });
});

// Create HTTP server and bind Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // The client can pass the room name in query: e.g. ?room=RoomA
  const roomName = socket.handshake.query.room;

  if (roomName) {
    // If this room doesn’t exist yet, assign a new unit ID
    if (!roomUnitMap[roomName]) {
      roomUnitMap[roomName] = nextUnitID++;
    }
    const unitID = roomUnitMap[roomName];

    // Join the Socket.IO room
    socket.join(roomName);

    // Broadcast "new device" only to the same room
    socket.broadcast.to(roomName).emit('newDeviceConnected', {
      message: `A new device has connected: ${socket.id}`,
      timestamp: new Date().toISOString(),
    });

    // Send the current holding registers for that room’s unit ID
    const regs = getOrInitRegisters(unitID);
    socket.emit('holdingRegistersUpdate', Array.from(regs));

    // On write, update the correct unit ID
    socket.on('write', ({ address, value, roomName }) => {
      const unitID = roomUnitMap[roomName];
      if (!unitID) {
        socket.emit('error', { message: `Unknown room: ${roomName}` });
        return;
      }
      const regs = getOrInitRegisters(unitID);
      try {
        if (address < 0 || address >= regs.length) {
          throw new Error(
            `Invalid address: ${address}. Must be between 0 and ${regs.length - 1}`
          );
        }
        if (value < 0 || value > 65535) {
          throw new Error(
            `Invalid value: ${value}. Must be between 0 and 65535`
          );
        }
        regs[address] = value;
        console.log(
          `Room "${roomName}" (unitID=${unitID}) updated regs: `,
          Array.from(regs)
        );
        // Notify everyone *in the same room*
        io.to(roomName).emit('holdingRegistersUpdate', Array.from(regs));
      } catch (error) {
        console.error(`Write failed: ${error.message}`);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      socket.broadcast.to(roomName).emit('deviceDisconnected', {
        message: `A device has disconnected: ${socket.id}`,
        timestamp: new Date().toISOString(),
      });
    });
  } else {
    console.log('Client connected without a room:', socket.id);
    // If no room specified, do nothing special
    socket.on('disconnect', () => {
      console.log('Client (no-room) disconnected:', socket.id);
    });
  }
});

// ----------------------------------------------------------------------------
//  Create a Modbus TCP server that references the same data as the rooms
// ----------------------------------------------------------------------------
function createModbusServer(ip) {
  // We'll define a "vector" object telling how to handle read/write requests.
  // The "unitID" parameter is how we distinguish different rooms.
  const vector = {
    getHoldingRegister: (addr, unitID, cb) => {
      // Asynchronous usage with callback
      const regs = getOrInitRegisters(unitID);
      // Address is 1-based in typical Modbus. Adjust if you want 0-based
      const value = regs[addr] || 0;
      // done
      cb(null, value);
    },

    setRegister: (addr, value, unitID) => {
      const regs = getOrInitRegisters(unitID);
      if (addr >= 0 && addr < regs.length) {
        regs[addr] = value;
        // Log it
        console.log(
          `Modbus setRegister(unitID=${unitID}, addr=${addr}, value=${value})`
        );
        // Also broadcast to any Socket.IO "room" that uses this unitID
        const roomName = Object.keys(roomUnitMap).find(
          (r) => roomUnitMap[r] === unitID
        );
        if (roomName) {
          io.to(roomName).emit('holdingRegistersUpdate', Array.from(regs));
        }
      } else {
        console.log(`Invalid register address ${addr} for unitID=${unitID}`);
      }
    },

    // Optionally, implement getInputRegister, getCoil, setCoil, etc.
    // For brevity, we'll just handle Holding Registers.
  };

  // Create the Modbus TCP server
  const serverTCP = new ModbusRTU.ServerTCP(vector, {
    host: ip,       // use our detected IP
    port: MODBUS_PORT,
    debug: false,   // set to true to see debug logs
  });

  serverTCP.on('socketError', (err) => {
    console.error('Modbus Socket Error:', err);
  });

  console.log(
    `Modbus TCP server listening on modbus://${ip}:${MODBUS_PORT}`
  );
}

// Start everything with the local IP address
getIPAddress((ip) => {
  if (ip) {
    // Start HTTP + Socket.IO
    server.listen(HTTP_PORT, () => {
      console.log(`HTTP+Socket.IO server on http://${ip}:${HTTP_PORT}`);
    });
    // Start the Modbus TCP server
    createModbusServer(ip);
  } else {
    console.error('Could not determine IP address. Servers not started.');
  }
});
