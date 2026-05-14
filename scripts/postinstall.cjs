const { spawnSync } = require("node:child_process");

const hasBin = (cmd) =>
  spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
    timeout: 3000,
  }).status === 0;

if (!hasBin("logosdb-mcp-server") && !hasBin("npx")) {
  process.stderr.write(
    "pi-semantic-memory: Node.js/npx not found.\n" +
    "Install Node.js (https://nodejs.org) then: npm i -g logosdb-mcp-server\n"
  );
}
