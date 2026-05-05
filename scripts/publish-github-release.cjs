const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
const releaseDir = path.join(projectDir, "release");
const publishConfig = packageJson.build?.publish?.[0] ?? {};
const repo = publishConfig.owner && publishConfig.repo
  ? `${publishConfig.owner}/${publishConfig.repo}`
  : packageJson.repository?.url?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");

if (!repo) {
  throw new Error("Unable to determine GitHub repository for release upload.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    windowsHide: true,
  });

  return result;
}

function requireSuccess(command, args) {
  const result = run(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function findReleaseTag() {
  const candidates = [`v${packageJson.version}`, packageJson.version];
  for (const candidate of candidates) {
    const result = run("gh", ["release", "view", candidate, "--repo", repo]);
    if (result.status === 0) {
      return candidate;
    }
  }
  return candidates[0];
}

function findArtifacts() {
  const allowed = [".exe", ".blockmap", ".deb", ".tar.gz", ".yml"];
  return fs.readdirSync(releaseDir)
    .filter((fileName) => allowed.some((extension) => fileName.endsWith(extension)))
    .map((fileName) => path.join(releaseDir, fileName));
}

const ghVersion = run("gh", ["--version"]);
if (ghVersion.status !== 0) {
  throw new Error("GitHub CLI is required to publish releases. Install gh or upload the files in release/ manually.");
}

const artifacts = findArtifacts();
if (artifacts.length === 0) {
  throw new Error("No release artifacts found. Run npm run dist:all first.");
}

const tag = findReleaseTag();
console.log(`Uploading ${artifacts.length} artifact(s) to ${repo} release ${tag}`);
requireSuccess("gh", ["release", "upload", tag, "--repo", repo, "--clobber", ...artifacts]);
