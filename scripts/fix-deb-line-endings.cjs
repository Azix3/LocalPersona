const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function findPython() {
  const candidates = [
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function findLinuxArtifacts(context) {
  const artifacts = (context?.artifactPaths ?? []).filter(isLinuxArtifact);
  if (artifacts.length > 0) {
    return artifacts;
  }

  const outputDir = context?.outDir ?? path.join(process.cwd(), "release");
  if (!fs.existsSync(outputDir)) {
    return [];
  }

  return fs.readdirSync(outputDir)
    .filter(isLinuxArtifact)
    .map((fileName) => path.join(outputDir, fileName));
}

function isLinuxArtifact(fileName) {
  return fileName.endsWith(".deb") || fileName.endsWith(".tar.gz");
}

function repairLinuxArtifacts(artifacts) {
  if (artifacts.length === 0 || process.platform !== "win32") {
    return;
  }

  const python = findPython();
  if (!python) {
    throw new Error("Python 3 is required to repair Windows-built Debian packages.");
  }

  const scriptPath = path.join(__dirname, "fix-deb-line-endings.py");
  const result = spawnSync(python.command, [...python.args, scriptPath, ...artifacts], {
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Debian package repair failed with exit code ${result.status}.`);
  }
}

async function afterAllArtifactBuild(context) {
  repairLinuxArtifacts(findLinuxArtifacts(context));
  return context.artifactPaths;
}

if (require.main === module) {
  const artifacts = process.argv.slice(2);
  repairLinuxArtifacts(artifacts.length > 0 ? artifacts : findLinuxArtifacts());
}

module.exports = afterAllArtifactBuild;
module.exports.default = afterAllArtifactBuild;
