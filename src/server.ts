import express from "express";
import http, { Server as HTTPServer } from "http";
import path from "path";
import { Server as SocketIOServer, Socket } from "socket.io";
import ModbusRTU from "modbus-serial";

import getIPAddress from "./helpers/getIPAddress";

const app = express();

const HTTP_PORT = 5000;    // HTTP + Socket.IO
const MODBUS_PORT = 502;   // Modbus TCP

interface RoomsData {
  [roomName: string]: number;  // maps roomName to unitID
}

// Each unitID has a separate Uint16Array of holding registers
interface HoldingRegistersMap {
  [unitID: number]: Uint16Array;
}

let nextUnitID = 1;
const roomUnitMap: RoomsData = {};      // e.g. { "RoomA": 1, "RoomB": 2 }
const holdingRegisters: HoldingRegistersMap = {};

// Helper: get or initialize holding registers for a given unit ID
function getOrInitRegisters(unitID: number): Uint16Array {
  if (!holdingRegisters[unitID]) {
    holdingRegisters[unitID] = new Uint16Array(10);
  }
  return holdingRegisters[unitID];
}

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Endpoint to return known rooms
app.get("/rooms", (req, res) => {
  res.json({ rooms: Object.keys(roomUnitMap) });
});

////////////////////////////////////////////////////////////////////////////////
// Create HTTP server + Socket.IO
////////////////////////////////////////////////////////////////////////////////

const server: HTTPServer = http.createServer(app);
const io: SocketIOServer = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket: Socket) => {
  console.log("New client connected:", socket.id);

  // The client can pass a room name via handshake query: e.g. `?room=RoomA`
  const roomName = socket.handshake.query.room as string | undefined;

  if (roomName) {
    // If this room doesn’t exist yet, assign a new unit ID
    if (!roomUnitMap[roomName]) {
      roomUnitMap[roomName] = nextUnitID++;
    }
    const unitID = roomUnitMap[roomName];

    // Join Socket.IO "room"
    socket.join(roomName);

    // Notify others in that room
    socket.broadcast.to(roomName).emit("newDeviceConnected", {
      message: `A new device has connected: ${socket.id}`,
      timestamp: new Date().toISOString(),
    });

    // Emit current holding registers for that room
    const regs = getOrInitRegisters(unitID);
    socket.emit("holdingRegistersUpdate", Array.from(regs));

    // Listen for "write" events
    socket.on("write", (data: { address: number; value: number; roomName: string }) => {
      const { address, value, roomName: rName } = data;
      const unitId = roomUnitMap[rName];
      if (!unitId) {
        socket.emit("error", { message: `Unknown room: ${rName}` });
        return;
      }
      const regs = getOrInitRegisters(unitId);
      try {
        if (address < 0 || address >= regs.length) {
          throw new Error(
            `Invalid address: ${address}. Must be between 0 and ${regs.length - 1}`
          );
        }
        if (value < 0 || value > 65535) {
          throw new Error(`Invalid value: ${value}. Must be between 0 and 65535`);
        }
        regs[address] = value;
        console.log(
          `Room "${rName}" (unitID=${unitId}) updated regs: `,
          Array.from(regs)
        );
        // Notify everyone in the same room
        io.to(rName).emit("holdingRegistersUpdate", Array.from(regs));
      } catch (error: any) {
        console.error(`Write failed: ${error.message}`);
        socket.emit("error", { message: error.message });
      }
    });

    // On disconnect
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      socket.broadcast.to(roomName).emit("deviceDisconnected", {
        message: `A device has disconnected: ${socket.id}`,
        timestamp: new Date().toISOString(),
      });
    });
  } else {
    // If no room specified, just log
    console.log("Client connected with no specified room:", socket.id);
    socket.on("disconnect", () => {
      console.log("Client (no-room) disconnected:", socket.id);
    });
  }
});

////////////////////////////////////////////////////////////////////////////////
// Create Modbus TCP server (via modbus-serial)
////////////////////////////////////////////////////////////////////////////////

function createModbusServer(ip: string) {
  // The "vector" defines how we handle read/write requests
  // from Modbus clients. The `unitID` param is crucial for
  // separating data by "room".
  const vector = {
    getHoldingRegister: (
      addr: number,
      unitID: number,
      callback: (err: Error | null, value?: number) => void
    ) => {
      // Typically, Modbus addresses are 0-based or 1-based
      // Adjust as you see fit; here we treat `addr` as 0-based
      const regs = getOrInitRegisters(unitID);
      const val = regs[addr] ?? 0;
      callback(null, val);
    },

    setRegister: (addr: number, value: number, unitID: number) => {
      const regs = getOrInitRegisters(unitID);
      if (addr >= 0 && addr < regs.length) {
        regs[addr] = value;
        console.log(
          `Modbus setRegister(unitID=${unitID}, addr=${addr}, value=${value})`
        );
        // Also broadcast updates to any socket room that uses this unitID
        const roomName = Object.keys(roomUnitMap).find(
          (r) => roomUnitMap[r] === unitID
        );
        if (roomName) {
          io.to(roomName).emit("holdingRegistersUpdate", Array.from(regs));
        }
      } else {
        console.warn(`Invalid register address ${addr} for unitID=${unitID}`);
      }
    },

    // You could also implement "getInputRegister", "getCoil", "setCoil", etc.
  };

  // Create the Modbus TCP server
  // @ts-ignore until we have proper types for modbus-serial
  const serverTCP = new ModbusRTU.ServerTCP(vector, {
    host: ip,
    port: MODBUS_PORT,
    debug: false,
  });

  serverTCP.on("socketError", (err: Error) => {
    console.error("Modbus Socket Error:", err.message);
  });

  console.log(`Modbus TCP server listening on modbus://${ip}:${MODBUS_PORT}`);
}

////////////////////////////////////////////////////////////////////////////////
// Start everything after we get the machine's IP
////////////////////////////////////////////////////////////////////////////////
getIPAddress((ip) => {
  if (ip) {
    // Start HTTP + Socket.IO
    server.listen(HTTP_PORT, () => {
      console.log(`HTTP+Socket.IO server on http://${ip}:${HTTP_PORT}`);
    });
    // Start Modbus TCP server
    createModbusServer(ip);
  } else {
    console.error("Could not determine IP address. Servers not started.");
  }
});
