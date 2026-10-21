"""Rebuild the hash-verified MIT Fyers SDK with secure dependency constraints."""

import argparse
import base64
import csv
import hashlib
import io
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

UPSTREAM_SHA256 = "fb1cb2b3f99d3f26111ef03cad8412bb7df33887827f7f97f7a503533dc22fb4"
VERSION = "3.1.14+oap.1"


def build(source: Path, output: Path) -> None:
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != UPSTREAM_SHA256:
        raise ValueError("Upstream SDK wheel checksum mismatch")
    files = {}
    with ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith("/RECORD"):
                continue
            value = archive.read(name)
            if name.endswith(("/data_ws.py", "/order_ws.py")):
                code = value.decode()
                assert "from pkg_resources import resource_filename" in code
                code = code.replace("from pkg_resources import resource_filename",
                                    "from importlib.resources import files")
                code = code.replace(
                    "resource_filename('fyers_apiv3.FyersWebsocket', 'map.json')",
                    "files('fyers_apiv3.FyersWebsocket').joinpath('map.json')",
                ).replace('open(file_path, "r")', 'file_path.open("r")')
                assert "resource_filename" not in code
                compile(code, name, "exec")
                value = code.encode()
            elif name.endswith("/tbt_ws.py"):
                value = value.replace(b"from pkg_resources import resource_filename\n", b"")
            elif name.endswith("/METADATA"):
                lines = value.decode().splitlines()
                replacements = {"requests": "requests>=2.34.2,<3", "aiohttp": "aiohttp>=3.14.5,<4"}
                updated = []
                changed = set()
                for line in lines:
                    if line == "Version: 3.1.14":
                        line = f"Version: {VERSION}"
                    if line.startswith("Requires-Dist:"):
                        dependency = line.split(":", 1)[1].strip().split()[0].split("=")[0]
                        if dependency in {"setuptools", "asyncio"}:
                            continue
                        if dependency in replacements:
                            line = "Requires-Dist: " + replacements[dependency]
                            changed.add(dependency)
                    updated.append(line)
                assert changed == set(replacements)
                value = ("\n".join(updated) + "\n").encode()
            files[name.replace("fyers_apiv3-3.1.14.dist-info", f"fyers_apiv3-{VERSION}.dist-info")] = value
    record_path = f"fyers_apiv3-{VERSION}.dist-info/RECORD"
    record = io.StringIO(newline="")
    writer = csv.writer(record)
    for name, value in sorted(files.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(value).digest()).rstrip(b"=").decode()
        writer.writerow((name, "sha256=" + digest, len(value)))
    writer.writerow((record_path, "", ""))
    files[record_path] = record.getvalue().encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, value in sorted(files.items()):
            entry = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, value)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
