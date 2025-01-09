// getIPAddress.ts

import { exec, ExecException } from "child_process";

/**
 * Fetches the IP address of a specific network interface, then passes it to the callback.
 * If the IP cannot be found or there's an error, it passes `null`.
 *
 * @param callback A function to receive the IP address (string) or null if not found.
 */
export default function getIPAddress(callback: (ip: string | null) => void): void {
  exec("ifconfig", (err: ExecException | null, stdout: string, stderr: string) => {
    if (err) {
      console.error("Error fetching IP address:", err);
      callback(null);
      return;
    }

    // Replace with your actual interface name
    const interfaceName = "wlp67s0";
    const interfaceRegex = new RegExp(`${interfaceName}.*?inet (\\d+\\.\\d+\\.\\d+\\.\\d+)`, "s");

    const match = stdout.match(interfaceRegex);
    if (match && match[1]) {
      // Return the IP address
      callback(match[1]);
    } else {
      console.error(`No IP address found for interface ${interfaceName}.`);
      callback(null);
    }
  });
}
