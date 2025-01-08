const { exec } = require('child_process');

function getIPAddress(callback) {
    exec('ifconfig', (err, stdout, stderr) => {
        if (err) {
            console.error('Error fetching IP address:', err);
            callback(null);
            return;
        }

        // Find the specific interface block (e.g., wlx1cbfcedf49c2)
        const interfaceName = 'wlx1cbfcedf49c2'; // Replace with your desired interface
        const interfaceRegex = new RegExp(`${interfaceName}.*?inet (\\d+\\.\\d+\\.\\d+\\.\\d+)`, 's');

        const match = stdout.match(interfaceRegex);
        if (match && match[1]) {
            callback(match[1]); // Return the IP address of the specific interface
        } else {
            console.error(`No IP address found for interface ${interfaceName}.`);
            callback(null);
        }
    });
}

module.exports = getIPAddress;
