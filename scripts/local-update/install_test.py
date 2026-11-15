import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_wait_swap_backup_and_failures(self):
        for failure in (None, "hash", "old-hash", "backup", "rename"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                live, staged, backup = (root / name for name in ("old.app", "new.app", "backup.app"))
                for app, content in ((live, b"old"), (staged, b"new")):
                    resources = app / "Contents/Resources"
                    resources.mkdir(parents=True)
                    (resources / "app.asar").write_bytes(content)
                    with open(app / "Contents/Info.plist", "wb") as stream:
                        plistlib.dump({"CFBundleShortVersionString": "0.1.9-fork.20261115.1"}, stream)
                database = root / "state.sqlite"
                database.write_bytes(b"migration-before")
                manifest = root / "pending.json"
                manifest.write_text(json.dumps({
                    "phase": "prepared", "version": "0.1.9-fork.20261115.1",
                    "installedPath": str(live), "stagedPath": str(staged), "backupPath": str(backup),
                    "asarSha256": "wrong" if failure == "hash" else installer.digest(staged / "Contents/Resources/app.asar"),
                    "previousAsarSha256": "wrong" if failure == "old-hash" else installer.digest(live / "Contents/Resources/app.asar"),
                    "databasePath": str(database), "databaseBackupPath": str(root / "database-backup"),
                }))
                real_rename = Path.rename
                events = []

                class Queue:
                    def control(queue, changes, count, timeout):
                        self.assertEqual((live / "Contents/Resources/app.asar").read_bytes(), b"old")
                        if changes is None:
                            events.append("exit")
                            return [SimpleNamespace(flags=0, ident=123)]
                        return []
                    def close(queue):
                        pass

                def command(args, **kwargs):
                    if args[0] == "/bin/cp":
                        events.append("backup")
                        if failure == "backup":
                            raise OSError("backup failed")
                        Path(args[-1]).write_bytes(Path(args[-2]).read_bytes())
                    if args[0] == "/usr/bin/open":
                        events.append("open")
                        self.assertEqual((live / "Contents/Resources/app.asar").read_bytes(), b"new")
                    return SimpleNamespace(returncode=1 if "lsof" in args[0] else 0, stdout="")

                def rename(source, target):
                    if source == staged and failure == "rename":
                        raise OSError("rename failed")
                    return real_rename(source, target)

                with patch.object(installer.select, "kqueue", Queue), patch.object(installer.subprocess, "run", command), patch.object(installer.subprocess, "check_output", return_value=""), patch.object(Path, "rename", rename):
                    if failure:
                        with self.assertRaises((RuntimeError, OSError)):
                            installer.install(manifest, [123])
                        self.assertEqual((live / "Contents/Resources/app.asar").read_bytes(), b"old")
                        self.assertNotIn("open", events)
                        self.assertEqual(json.loads(manifest.read_text())["phase"], "failed")
                    else:
                        installer.install(manifest, [123])
                        self.assertEqual(events, ["exit", "backup", "open"])
                        self.assertEqual((backup / "Contents/Resources/app.asar").read_bytes(), b"old")
                        self.assertEqual(json.loads(manifest.read_text())["phase"], "installed-pending-verification")

    def test_real_exit_event_and_signed_bundle_swap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live, staged, backup = (root / name for name in ("old.app", "new.app", "backup.app"))
            for app, content in ((live, b"old"), (staged, b"new")):
                resources = app / "Contents/Resources"
                resources.mkdir(parents=True)
                executable = app / "Contents/MacOS/Fixture"
                executable.parent.mkdir()
                shutil.copyfile("/usr/bin/true", executable)
                executable.chmod(0o755)
                (resources / "app.asar").write_bytes(content)
                with open(app / "Contents/Info.plist", "wb") as stream:
                    plistlib.dump({"CFBundleExecutable": "Fixture", "CFBundleIdentifier": "local.t3-update-fixture", "CFBundleShortVersionString": "0.1.9-fork.20261115.1"}, stream)
                subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(app)], check=True, capture_output=True)
            manifest = root / "pending.json"
            manifest.write_text(json.dumps({
                "phase": "prepared", "version": "0.1.9-fork.20261115.1",
                "installedPath": str(live), "stagedPath": str(staged), "backupPath": str(backup),
                "asarSha256": installer.digest(staged / "Contents/Resources/app.asar"),
                "previousAsarSha256": installer.digest(live / "Contents/Resources/app.asar"),
            }))
            with subprocess.Popen(["/bin/cat"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL) as old_process:
                code = "import sys; sys.path.insert(0, sys.argv[1]); import install; install.install(sys.argv[2], [int(sys.argv[3])], reopen=False)"
                with subprocess.Popen([sys.executable, "-B", "-c", code, str(Path(__file__).parent), str(manifest), str(old_process.pid)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as helper:
                    self.assertEqual(helper.stdout.readline(), "ready\n")
                    self.assertEqual((live / "Contents/Resources/app.asar").read_bytes(), b"old")
                    old_process.stdin.close()
                    old_process.wait()
                    _, errors = helper.communicate()
                    self.assertEqual(helper.returncode, 0, errors)
            self.assertEqual((live / "Contents/Resources/app.asar").read_bytes(), b"new")
            self.assertEqual((backup / "Contents/Resources/app.asar").read_bytes(), b"old")
            self.assertEqual(json.loads(manifest.read_text())["phase"], "installed-pending-verification")


if __name__ == "__main__":
    unittest.main()
