"""Build the MIT braces 3.0.3 lint dependency with a bounded parser depth."""

import argparse
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

UPSTREAM_SHA256 = "1cd18e862c8640b4568b1425a7df4ee030ff201d45b2da8f9f222d2987494ffc"


def build(source: Path, output: Path) -> None:
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != UPSTREAM_SHA256:
        raise ValueError("Upstream braces package checksum mismatch")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for entry in archive.getmembers():
            if not entry.isfile():
                continue
            stream = archive.extractfile(entry)
            assert stream is not None
            files[entry.name] = stream.read()
    parser = files["package/lib/parse.js"].decode()
    assert parser.count("      stack.push(block);") == 2
    parser = parser.replace("      stack.push(block);", "      stack.push(block);\n"
                            "      if (stack.length > 65) throw new SyntaxError('Pattern nesting exceeds 64');")
    files["package/lib/parse.js"] = parser.encode()
    package = json.loads(files["package/package.json"])
    package.update(name="@option-analytics/braces", version="3.0.3-oap.1", private=True)
    files["package/package.json"] = (json.dumps(package, indent=2) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as destination:
        with gzip.GzipFile(fileobj=destination, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for name, value in sorted(files.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode = len(value), 0o644
                    archive.addfile(entry, io.BytesIO(value))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
