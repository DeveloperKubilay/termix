"""Extract the pinned native runtime without executing archive contents."""
import pathlib
import shutil
import sys
import zipfile

archive = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
if target.exists() and any(target.iterdir()):
    raise RuntimeError("Extraction destination must be empty")
target.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as bundle:
    for item in bundle.infolist():
        name = item.filename
        destination = (target / name).resolve()
        if "\\" in name or not destination.is_relative_to(target):
            raise RuntimeError("Unsafe archive path")
        if (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise RuntimeError("Archive symlinks are not permitted")
        if not name.startswith(("bin/", "include/")):
            raise RuntimeError("Unexpected runtime archive entry")
        if item.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(item) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)
