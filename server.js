// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const getIPAddress = require('./helpers/getIPAddress');

const app = express();
const port = 5000;

// In-memory store of rooms and their holding registers
// Example structure: roomsData = {
//    "RoomA": { holdingRegisters: Uint16Array(10) },
//    "RoomB": { holdingRegisters: Uint16Array(10) }
// }
const roomsData = {};
const MAX_UINT16 = 65535;

// Helper: get or initialize the holding registers for a given room
function getHoldingRegistersForRoom(roomName) {
  if (!roomsData[roomName]) {
    // Create a new room object with a fresh set of holding registers
    roomsData[roomName] = { holdingRegisters: new Uint16Array(10) };
  }
  return roomsData[roomName].holdingRegisters;
}

// Helper: broadcast updated holding registers to *just the given room*
function broadcastHoldingRegisters(roomName, io) {
  const registers = getHoldingRegistersForRoom(roomName);
  io.to(roomName).emit('holdingRegistersUpdate', Array.from(registers));
}

// Serve static files (index.html, roomSelection.html, etc.)
app.use(express.static(path.join(__dirname)));

// Endpoint to retrieve the list of existing rooms
app.get('/rooms', (req, res) => {
  res.json({ rooms: Object.keys(roomsData) });
});

// Create HTTP server and bind Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // The client can pass the room name as a query parameter: ?room=RoomA
  const roomName = socket.handshake.query.room;

  if (roomName) {
    // Join the Socket.IO "room"
    socket.join(roomName);

    // Make sure there's a holdingRegisters array for this room
    const registers = getHoldingRegistersForRoom(roomName);

    // Notify *only* others in the same room
    socket.broadcast.to(roomName).emit('newDeviceConnected', {
      message: `A new device has connected: ${socket.id}`,
      timestamp: new Date().toISOString(),
    });

    // Send this client the current holding registers for that room
    socket.emit('holdingRegistersUpdate', Array.from(registers));

    // Listen for "write" events specific to this room
    socket.on('write', ({ address, value, roomName }) => {
      try {
        const roomRegisters = getHoldingRegistersForRoom(roomName);

        if (address < 0 || address >= roomRegisters.length) {
          throw new Error(
            `Invalid address: ${address}. Must be between 0 and ${
              roomRegisters.length - 1
            }`
          );
        }
        if (value < 0 || value > MAX_UINT16) {
          throw new Error(
            `Invalid value: ${value}. Must be between 0 and ${MAX_UINT16}`
          );
        }

        roomRegisters[address] = value;
        console.log(
          `Room "${roomName}" registers updated: `,
          Array.from(roomRegisters)
        );

        // Broadcast the update to everyone in the same room
        broadcastHoldingRegisters(roomName, io);
      } catch (error) {
        console.error(`Write failed: ${error.message}`);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      // Notify only the same room
      socket.broadcast.to(roomName).emit('deviceDisconnected', {
        message: `A device has disconnected: ${socket.id}`,
        timestamp: new Date().toISOString(),
      });
    });
  } else {
    console.log('No room specified by client:', socket.id);

    // If a client connects without specifying a room, you could optionally disconnect them
    // or handle it however you wish. We'll just log a warning.
    socket.on('disconnect', () => {
      console.log('Client (no-room) disconnected:', socket.id);
    });
  }
});

// Start the server with the local IP address
getIPAddress((ip) => {
  if (ip) {
    server.listen(port, () => {
      console.log(`Server listening on http://${ip}:${port}`);
    });
  } else {
    console.error('Could not determine IP address. Server not started.');
  }
});
