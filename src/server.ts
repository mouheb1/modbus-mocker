//server.ts
import express from "express";
import path from "path";
import http, { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import getIPAddress from "./helpers/getIPAddress";
import { createModbusServer } from "./modbusServer";


export const app = express();
export const server: HTTPServer = http.createServer(app);

export const io: SocketIOServer = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

import "./socket-io";

const HTTP_PORT = 5000;    // HTTP + Socket.IO
export const MODBUS_PORT = 502;   // Modbus TCP

interface RoomsData {
  [roomName: string]: number;  // maps roomName to unitID
}

// Each unitID has a separate Uint16Array of holding registers
interface HoldingRegistersMap {
  [unitID: number]: Uint16Array;
}

export const roomUnitMap: RoomsData = {};      // e.g. { "RoomA": 1, "RoomB": 2 }
export const holdingRegisters: HoldingRegistersMap = {};

// Helper: get or initialize holding registers for a given unit ID
export function getOrInitRegisters(unitID: number): Uint16Array {
  if (!holdingRegisters[unitID]) {
    holdingRegisters[unitID] = new Uint16Array(10);
  }
  return holdingRegisters[unitID];
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/rooms", (req, res) => {
  res.json({ rooms: Object.keys(roomUnitMap) });
});


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
