"""One-shot macOS bundle installer; armed only by an explicit update click."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import select
import subprocess
import sys
from contextlib import closing


def digest(file):
    result = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def verify(app, expected):
    if digest(app / "Contents/Resources/app.asar") != expected:
        raise RuntimeError("Application content changed: " + str(app))
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], check=True, capture_output=True)


def install(manifest_path, pids, reopen=True):
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    live, staged, backup = (Path(manifest[key]) for key in ("installedPath", "stagedPath", "backupPath"))

    def save(phase, **details):
        manifest.update(phase=phase, updatedAt=datetime.datetime.now().astimezone().isoformat(), **details)
        temporary = manifest_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(manifest_path)

    try:
        if manifest["phase"] != "prepared":
            raise RuntimeError("Update is no longer prepared")
        verify(live, manifest["previousAsarSha256"])
        verify(staged, manifest["asarSha256"])
        with open(staged / "Contents/Info.plist", "rb") as stream:
            if plistlib.load(stream)["CFBundleShortVersionString"] != manifest["version"]:
                raise RuntimeError("Candidate version changed")
        if backup.exists():
            raise RuntimeError("Backup destination already exists")
        backup.parent.mkdir(parents=True, exist_ok=True)
        with closing(select.kqueue()) as queue:
            waiting = set()
            for pid in pids:
                event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT)
                try:
                    queue.control([event], 0, 0)
                    waiting.add(pid)
                except ProcessLookupError:
                    pass
            print("ready", flush=True)
            while waiting:
                for event in queue.control(None, len(waiting), None):
                    if event.flags & select.KQ_EV_ERROR:
                        raise RuntimeError("Could not observe application shutdown")
                    waiting.discard(event.ident)
        executable = str(live / "Contents/MacOS/T3 Code (Beta)")
        processes = subprocess.check_output(["/bin/ps", "-axo", "comm="], text=True)
        if executable in processes.splitlines():
            raise RuntimeError("Application reopened before installation")
        verify(live, manifest["previousAsarSha256"])
        verify(staged, manifest["asarSha256"])
        if manifest.get("databasePath"):
            database = Path(manifest["databasePath"])
            files = [Path(str(database) + suffix) for suffix in ("", "-wal", "-shm")]
            users = subprocess.run(["/usr/sbin/lsof", "-t", "--"] + [str(file) for file in files], capture_output=True, text=True)
            if users.returncode not in (0, 1) or users.stdout.strip():
                raise RuntimeError("Database still has open users; leaving both apps intact")
            space = os.statvfs(live.parent)
            if space.f_bavail * space.f_frsize < 2 * 1024 ** 3:
                raise RuntimeError("Insufficient migration headroom; leaving both apps intact")
            destination = Path(manifest["databaseBackupPath"])
            destination.mkdir(parents=True, exist_ok=False)
            for file in files:
                if file.exists():
                    subprocess.run(["/bin/cp", "-c", str(file), str(destination / file.name)], check=True)
            save("database-backed-up")
        save("swapping")
        live.rename(backup)
        try:
            staged.rename(live)
        except Exception:
            backup.rename(live)
            raise
        save("installed-pending-verification")
        if reopen:
            subprocess.run(["/usr/bin/open", str(live)], check=True)
    except Exception as error:
        save("failed", error=str(error))
        raise


if __name__ == "__main__":
    install(sys.argv[1], [int(pid) for pid in sys.argv[2:]])
