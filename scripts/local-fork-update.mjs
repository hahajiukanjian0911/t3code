import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { extractFile } from "@electron/asar";
import { selectSigningIdentity } from "./local-update/signing.mjs";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const baseDir = process.env.T3CODE_HOME || NodePath.join(NodeOS.homedir(), ".t3");
const pending = NodePath.join(baseDir, "local-updates/pending.json");
const installed = "/Applications/T3 Code (Beta).app";
const run = (command, args, options = {}) => {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout?.trim() ?? "";
};
const git = (...args) => run("git", args, { stdio: "pipe" });
const exists = async (file) =>
  NodeFSP.access(file).then(
    () => true,
    () => false,
  );
async function hash(app) {
  const result = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(
    NodePath.join(app, "Contents/Resources/app.asar"),
  ))
    result.update(chunk);
  return result.digest("hex");
}
async function save(file, value) {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  await NodeFSP.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await NodeFSP.rename(`${file}.tmp`, file);
}
async function findApp(directory) {
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
    const file = NodePath.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return file;
    if (entry.isDirectory()) {
      const nested = await findApp(file);
      if (nested) return nested;
    }
  }
}
async function prepare(version) {
  if (
    Effect.runSync(HostProcess.Platform) !== "darwin" ||
    Effect.runSync(HostProcess.Architecture) !== "arm64"
  )
    throw new Error("This local workflow targets this Apple Silicon Mac.");
  if (!/^\d+\.\d+\.\d+-fork\.\d{8}\.\d+$/.test(version ?? ""))
    throw new Error("Use X.Y.Z-fork.YYYYMMDD.N");
  if (git("branch", "--show-current") !== "main" || git("status", "--porcelain"))
    throw new Error("Commit reviewed changes on a clean main first.");
  let previousSigningIdentity;
  if (await exists(pending)) {
    const previous = JSON.parse(await NodeFSP.readFile(pending, "utf8"));
    previousSigningIdentity = previous.signingIdentity?.hash;
    if (
      ["prepared", "swapping", "database-backed-up", "installed-pending-verification"].includes(
        previous.phase,
      )
    )
      throw new Error("Resolve the existing pending update before preparing another.");
  }
  const signingIdentity = selectSigningIdentity(
    run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { stdio: "pipe" }),
    process.env.T3CODE_LOCAL_SIGNING_IDENTITY,
    previousSigningIdentity,
  );
  const current = run(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", NodePath.join(installed, "Contents/Info.plist")],
    { stdio: "pipe" },
  );
  const { compareSemverVersions } = await import("@t3tools/shared/semver");
  if (compareSemverVersions(version, current) <= 0) throw new Error("Version must increase.");
  const free = await NodeFSP.statfs(root);
  if (free.bavail * free.bsize < 5 * 1024 ** 3)
    throw new Error("At least 5 GiB free space is required before packaging.");
  const commit = git("rev-parse", "HEAD");
  const output = NodePath.join(root, "release/local-stable", version);
  if (await exists(output))
    throw new Error("Candidate directory already exists; choose a new version.");
  await NodeFSP.mkdir(output, { recursive: true });
  run("vp", ["run", "check:changed", "--concurrency", "1"], {
    env: { ...process.env, VITEST_MAX_WORKERS: "1" },
  });
  run("/usr/bin/python3", ["-B", "scripts/local-update/install_test.py"]);
  run(Effect.runSync(HostProcess.ExecutablePath), [
    "--test",
    "scripts/local-update/signing.test.mjs",
  ]);
  if (git("status", "--porcelain"))
    throw new Error("Checks changed tracked sources; review and commit first.");
  run("git", ["push", "origin", "main"]);
  if (git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0] !== commit)
    throw new Error("Remote main does not match candidate.");
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;
  delete env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
  delete env.T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR;
  if (
    !git("diff", "fork/stable", commit, "--", "native/resource-monitor") &&
    (await exists(
      NodePath.join(
        root,
        "native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor",
      ),
    ))
  )
    env.T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR = "true";
  run(
    "vp",
    [
      "run",
      "dist:desktop:artifact",
      "--platform",
      "mac",
      "--target",
      "dir",
      "--arch",
      "arm64",
      "--build-version",
      version,
      "--output-dir",
      NodePath.join(output, "artifact"),
    ],
    { env },
  );
  if (git("rev-parse", "HEAD") !== commit || git("status", "--porcelain"))
    throw new Error("Sources changed during build.");
  const candidate = await findApp(NodePath.join(output, "artifact"));
  if (!candidate) throw new Error("Built application missing.");
  const archive = NodePath.join(candidate, "Contents/Resources/app.asar");
  const metadata = JSON.parse(extractFile(archive, "package.json").toString());
  if (metadata.version !== version || metadata.t3codeCommitHash !== commit.slice(0, 12))
    throw new Error("Packaged version or source commit mismatch.");
  if (await exists(NodePath.join(candidate, "Contents/Resources/app-update.yml")))
    throw new Error("Unexpected upstream update feed.");
  run("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    signingIdentity.hash,
    "--preserve-metadata=entitlements,flags",
    candidate,
  ]);
  const signedMetadata = NodeChildProcess.spawnSync(
    "/usr/bin/codesign",
    ["-d", "-r-", "--verbose=4", candidate],
    { encoding: "utf8" },
  );
  const signature = signedMetadata.stdout + signedMetadata.stderr;
  if (
    signedMetadata.status !== 0 ||
    signature.includes("Signature=adhoc") ||
    !/TeamIdentifier=(?!not set)[A-Z0-9]+/.test(signature)
  )
    throw new Error("Candidate must carry the selected certificate signature.");
  const requirement = signature.match(/designated => (.+)/)?.[1];
  if (!requirement || /cdhash\s/.test(requirement))
    throw new Error("Candidate needs a version-independent designated requirement.");
  if (previousSigningIdentity) {
    run("/usr/bin/codesign", ["--verify", "--strict", "-R", requirement, installed]);
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", candidate]);
  const cliVersion = run(
    NodePath.join(candidate, "Contents/MacOS/T3 Code (Beta)"),
    [NodePath.join(archive, "apps/server/dist/bin.mjs"), "--version"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        T3CODE_HOME: NodePath.join(output, "cli-check"),
      },
    },
  );
  if (!cliVersion.includes(version)) throw new Error("Packaged backend version mismatch.");
  const staged = `/Applications/.T3-Code-update-${version}.app`;
  if (await exists(staged)) throw new Error("Staged bundle already exists.");
  run("/usr/bin/ditto", [candidate, staged]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
  const installer = NodePath.join(output, "install.py");
  await NodeFSP.copyFile(NodePath.join(root, "scripts/local-update/install.py"), installer);
  const migrations = git(
    "diff",
    "--name-only",
    "fork/stable",
    commit,
    "--",
    "apps/server/src/persistence",
  )
    .split("\n")
    .filter((file) => file && !file.includes(".test."));
  const manifest = {
    version,
    commit,
    installedPath: installed,
    stagedPath: staged,
    backupPath: NodePath.join(output, "rollback", `T3 Code (Beta) ${current}.app`),
    previousVersion: current,
    signingIdentity,
    signingRequirement: requirement,
    previousAsarSha256: await hash(installed),
    asarSha256: await hash(staged),
    installerPath: installer,
    phase: "prepared",
    preparedAt: new Date().toISOString(),
    migrations,
    ...(migrations.length
      ? {
          databasePath: NodePath.join(baseDir, "userdata/statev2.sqlite"),
          databaseBackupPath: NodePath.join(output, "database-before-update"),
        }
      : {}),
  };
  await save(NodePath.join(output, "manifest.json"), manifest);
  await save(pending, manifest);
  run("git", ["tag", `local-candidate/${version}`, commit]);
  console.log(
    `Update prepared: ${version}\nManifest: ${pending}\nClick 更新 in the running app. First-time enablement requires update:local bootstrap <main-pid> <backend-pid>.`,
  );
}
async function bootstrap(pids) {
  if (!pids.length || pids.some((pid) => !/^\d+$/.test(pid)))
    throw new Error("Provide the observed main and backend PIDs.");
  const manifest = JSON.parse(await NodeFSP.readFile(pending, "utf8"));
  if (manifest.phase !== "prepared") throw new Error("No prepared update.");
  for (const pid of pids) {
    if (
      run("/bin/ps", ["-p", pid, "-o", "comm="], { stdio: "pipe" }) !==
      NodePath.join(installed, "Contents/MacOS/T3 Code (Beta)")
    )
      throw new Error(`PID ${pid} is not this installed application.`);
  }
  await new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "/usr/bin/python3",
      [manifest.installerPath, pending, ...pids],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Installer exited before ready (${code}).`)));
    let output = "";
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("ready\n")) {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve();
      }
    });
  });
  console.log(
    "首次启用已准备好：正常退出 T3 Code 后会替换并自动重新打开。请勿在替换期间手动重复打开。",
  );
}
async function verifyRuntime(pids) {
  if (pids.length !== 2 || pids.some((pid) => !/^\d+$/.test(pid)))
    throw new Error("Provide the observed main and backend PIDs.");
  const manifest = JSON.parse(await NodeFSP.readFile(pending, "utf8"));
  if (manifest.phase !== "installed-pending-verification")
    throw new Error("No installed candidate awaiting verification.");
  if ((await hash(installed)) !== manifest.asarSha256)
    throw new Error("Installed archive does not match candidate.");
  for (const pid of pids) {
    const executable = run("/bin/ps", ["-p", pid, "-o", "comm="], { stdio: "pipe" });
    const started = Date.parse(run("/bin/ps", ["-p", pid, "-o", "lstart="], { stdio: "pipe" }));
    if (
      executable !== NodePath.join(installed, "Contents/MacOS/T3 Code (Beta)") ||
      !Number.isFinite(started) ||
      started < Math.floor(Date.parse(manifest.updatedAt) / 1000) * 1000
    )
      throw new Error(`PID ${pid} is not a post-install process.`);
  }
  const backendArgs = run("/bin/ps", ["-p", pids[1], "-o", "args="], { stdio: "pipe" });
  if (
    !backendArgs.includes(
      NodePath.join(installed, "Contents/Resources/app.asar/apps/server/dist/bin.mjs"),
    )
  )
    throw new Error("Backend is not running from the installed app.");
  run("git", ["merge-base", "--is-ancestor", "fork/stable", manifest.commit]);
  run("git", ["branch", "-f", "fork/stable", manifest.commit]);
  const verified = {
    ...manifest,
    phase: "installed-runtime-verified",
    runtimePids: pids.map(Number),
    verifiedAt: new Date().toISOString(),
  };
  await save(pending, verified);
  await save(NodePath.join(NodePath.dirname(manifest.installerPath), "manifest.json"), verified);
  console.log(
    `已核对实际 App、后端和候选一致，fork/stable 已快进到 ${manifest.commit.slice(0, 12)}。功能和数据仍需用户上手确认。`,
  );
}
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "prepare") await prepare(args[0]);
  else if (command === "bootstrap") await bootstrap(args);
  else if (command === "verify") await verifyRuntime(args);
  else if (command === "status") console.log(await NodeFSP.readFile(pending, "utf8"));
  else
    throw new Error(
      "Usage: vp run update:local <prepare VERSION | status | bootstrap MAIN_PID BACKEND_PID | verify MAIN_PID BACKEND_PID>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
