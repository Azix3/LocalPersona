const fs = require("node:fs");
const path = require("node:path");

async function afterPack(context) {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const executableName = packageJson.name;
  const appOutDir = context.appOutDir;
  const launcherPath = path.join(appOutDir, executableName);
  const binaryPath = path.join(appOutDir, `${executableName}-bin`);

  if (!fs.existsSync(launcherPath) || fs.existsSync(binaryPath)) {
    return;
  }

  fs.renameSync(launcherPath, binaryPath);
  fs.writeFileSync(launcherPath, buildLauncher(executableName), { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);
  fs.chmodSync(binaryPath, 0o755);
}

function buildLauncher(executableName) {
  return `#!/bin/sh
set -e

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$APP_DIR/${executableName}-bin"

case "$APP_DIR" in
  /opt/LocalPersona|/opt/LocalPersona/*)
    exec "$BIN" "$@"
    ;;
  *)
    exec "$BIN" --no-sandbox "$@"
    ;;
esac
`;
}

module.exports = afterPack;
module.exports.default = afterPack;
