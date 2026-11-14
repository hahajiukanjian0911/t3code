// @effect-diagnostics nodeBuiltinImport:off -- The detached installer handshake owns native streams beyond the desktop scope.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { compareSemverVersions } from "@t3tools/shared/semver";

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.String,
    commit: Schema.String,
    installedPath: Schema.String,
    stagedPath: Schema.String,
    backupPath: Schema.String,
    asarSha256: Schema.String,
    previousAsarSha256: Schema.String,
    installerPath: Schema.String,
    databasePath: Schema.optionalKey(Schema.String),
    databaseBackupPath: Schema.optionalKey(Schema.String),
    phase: Schema.Literal("prepared"),
  }),
);

type LocalUpdate = typeof Manifest.Type;
const decodeManifest = Schema.decodeSync(Manifest);

export function parseLocalUpdate(
  contents: string,
  installedPath: string,
  currentVersion: string,
): LocalUpdate | undefined {
  try {
    const update = decodeManifest(contents);
    if (
      !/^\d+\.\d+\.\d+-fork\.\d{8}\.\d+$/.test(update.version) ||
      compareSemverVersions(update.version, currentVersion) <= 0 ||
      !/^[a-f0-9]{40}$/.test(update.commit) ||
      ![update.asarSha256, update.previousAsarSha256].every((hash) =>
        /^[a-f0-9]{64}$/.test(hash),
      ) ||
      update.installedPath !== installedPath ||
      NodePath.dirname(update.stagedPath) !== NodePath.dirname(installedPath) ||
      !NodePath.basename(update.stagedPath).startsWith(".T3-Code-update-") ||
      update.stagedPath === installedPath ||
      !NodePath.isAbsolute(update.backupPath) ||
      !NodePath.isAbsolute(update.installerPath) ||
      Boolean(update.databasePath) !== Boolean(update.databaseBackupPath) ||
      (update.databasePath !== undefined && !NodePath.isAbsolute(update.databasePath)) ||
      (update.databaseBackupPath !== undefined && !NodePath.isAbsolute(update.databaseBackupPath))
    )
      return undefined;
    return update;
  } catch {
    return undefined;
  }
}

async function asarHash(app: string) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(
    NodePath.join(app, "Contents/Resources/app.asar"),
  ))
    hash.update(chunk);
  return hash.digest("hex");
}

export async function startLocalUpdateInstaller(
  manifestPath: string,
  update: LocalUpdate,
  signal: AbortSignal,
): Promise<() => void> {
  // Recheck the exact offer before arming a helper that survives the app's normal shutdown.
  const current = parseLocalUpdate(
    await NodeFSP.readFile(manifestPath, "utf8"),
    update.installedPath,
    "0.0.0",
  );
  if (!current || JSON.stringify(current) !== JSON.stringify(update))
    throw new Error("The prepared update changed. Check for updates again.");
  const [previousHash, nextHash] = await Promise.all([
    asarHash(update.installedPath),
    asarHash(update.stagedPath),
  ]);
  if (previousHash !== update.previousAsarSha256 || nextHash !== update.asarSha256)
    throw new Error("The prepared application changed. Prepare the update again.");
  return await new Promise<() => void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "/usr/bin/python3",
      [update.installerPath, manifestPath, String(process.pid)],
      {
        signal,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let ready = false;
    let output = "";
    child.once("error", (error) => {
      reject(error);
    });
    child.once("exit", (code) => {
      if (!ready)
        reject(new Error(`The local update installer exited (${code}): ${output.slice(-512)}`));
    });
    child.stderr?.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-2048);
    });
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (!ready && output.includes("ready\n")) {
        ready = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        resolve(() => {
          child.kill();
        });
      }
    });
  });
}
