// socker-io.ts
import { Socket } from "socket.io";
import { getOrInitRegisters, io, roomUnitMap } from "./server";


////////////////////////////////////////////////////////////////////////////////
// Create HTTP server + Socket.IO
////////////////////////////////////////////////////////////////////////////////

let nextUnitID = 1;

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