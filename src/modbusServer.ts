import ModbusRTU from "modbus-serial";

import { getOrInitRegisters, MODBUS_PORT, roomUnitMap } from "./server";
import { io } from "./socket-io";

////////////////////////////////////////////////////////////////////////////////
// Create Modbus TCP server (via modbus-serial)
////////////////////////////////////////////////////////////////////////////////

export function createModbusServer(ip: string) {
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