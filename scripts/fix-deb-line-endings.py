from __future__ import annotations

import base64
import gzip
import hashlib
import io
import lzma
import re
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path


AR_MAGIC = b"!<arch>\n"
AR_TRAILER = b"`\n"
CONTROL_TEXT_FILES = {
    "conffiles",
    "control",
    "md5sums",
    "postinst",
    "postrm",
    "preinst",
    "prerm",
    "shlibs",
    "symbols",
    "triggers",
}
MAINTAINER_SCRIPTS = {"postinst", "postrm", "preinst", "prerm"}
EXECUTABLE_FILE_NAMES = {
    "chrome-sandbox",
    "chrome_crashpad_handler",
    "localpersona",
    "localpersona-bin",
}


@dataclass
class ArMember:
    name: str
    data: bytes
    timestamp: bytes = b"0"
    owner: bytes = b"0"
    group: bytes = b"0"
    mode: bytes = b"100644"


def parse_ar(blob: bytes) -> list[ArMember]:
    if not blob.startswith(AR_MAGIC):
        raise ValueError("not an ar/deb archive")

    members: list[ArMember] = []
    pos = len(AR_MAGIC)
    while pos < len(blob):
        header = blob[pos : pos + 60]
        if len(header) != 60 or header[58:60] != AR_TRAILER:
            raise ValueError(f"bad ar header at offset {pos}")

        raw_name = header[0:16].decode("ascii").strip()
        name = raw_name[:-1] if raw_name.endswith("/") else raw_name
        size = int(header[48:58].decode("ascii").strip())
        start = pos + 60
        end = start + size
        members.append(
            ArMember(
                name=name,
                data=blob[start:end],
                timestamp=header[16:28].strip() or b"0",
                owner=header[28:34].strip() or b"0",
                group=header[34:40].strip() or b"0",
                mode=header[40:48].strip() or b"100644",
            )
        )
        pos = end + (size % 2)

    return members


def write_ar(members: list[ArMember]) -> bytes:
    out = bytearray(AR_MAGIC)
    for member in members:
        name = f"{member.name}/".encode("ascii")
        if len(name) > 16:
            raise ValueError(f"ar member name is too long: {member.name}")

        header = (
            name.ljust(16, b" ")
            + member.timestamp[:12].rjust(12, b" ")
            + member.owner[:6].rjust(6, b" ")
            + member.group[:6].rjust(6, b" ")
            + member.mode[:8].rjust(8, b" ")
            + str(len(member.data)).encode("ascii").rjust(10, b" ")
            + AR_TRAILER
        )
        out.extend(header)
        out.extend(member.data)
        if len(member.data) % 2:
            out.extend(b"\n")
    return bytes(out)


def normalize_newlines(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def copy_tar_info(member: tarfile.TarInfo, data: bytes | None) -> tarfile.TarInfo:
    copied = tarfile.TarInfo(member.name)
    copied.mtime = member.mtime
    copied.uid = member.uid
    copied.gid = member.gid
    copied.uname = member.uname
    copied.gname = member.gname
    copied.type = member.type
    copied.linkname = member.linkname
    copied.mode = member.mode
    copied.size = len(data) if data is not None and member.isfile() else member.size
    return copied


def normalize_data_member_mode(member: tarfile.TarInfo) -> int:
    if member.isdir():
        return 0o755
    if member.isfile():
        return 0o755 if Path(member.name).name in EXECUTABLE_FILE_NAMES else 0o644
    if member.issym() or member.islnk():
        return 0o777
    return member.mode


def rewrite_tar(raw_tar: bytes, normalize_control_text: bool) -> bytes:
    source = tarfile.open(fileobj=io.BytesIO(raw_tar), mode="r:")
    repaired_tar = io.BytesIO()

    with tarfile.open(fileobj=repaired_tar, mode="w:", format=tarfile.GNU_FORMAT) as target:
        for member in source.getmembers():
            data = None
            if member.isfile():
                extracted = source.extractfile(member)
                data = extracted.read() if extracted else b""
                if normalize_control_text and Path(member.name).name in CONTROL_TEXT_FILES:
                    data = normalize_newlines(data)

            copied = copy_tar_info(member, data)
            base_name = Path(member.name).name
            if normalize_control_text and member.isfile():
                copied.mode = 0o755 if base_name in MAINTAINER_SCRIPTS else 0o644
            else:
                copied.mode = normalize_data_member_mode(member)

            target.addfile(copied, io.BytesIO(data) if data is not None else None)

    return repaired_tar.getvalue()


def repair_control_tar(control_tar_xz: bytes) -> bytes:
    return lzma.compress(rewrite_tar(lzma.decompress(control_tar_xz), normalize_control_text=True), preset=6, check=lzma.CHECK_CRC64)


def repair_data_tar(data_tar_xz: bytes) -> bytes:
    return lzma.compress(rewrite_tar(lzma.decompress(data_tar_xz), normalize_control_text=False), preset=6, check=lzma.CHECK_CRC64)


def update_latest_linux_yml(deb_path: Path) -> None:
    latest_path = deb_path.parent / "latest-linux.yml"
    if not latest_path.exists():
        return

    sha512 = base64.b64encode(hashlib.sha512(deb_path.read_bytes()).digest()).decode("ascii")
    size = deb_path.stat().st_size
    text = latest_path.read_text(encoding="utf-8")
    text = re.sub(r"(sha512:\s*)[A-Za-z0-9+/=]+", rf"\g<1>{sha512}", text)
    text = re.sub(r"(size:\s*)\d+", rf"\g<1>{size}", text)
    latest_path.write_text(text, encoding="utf-8", newline="\n")


def repair_deb(deb_path: Path) -> None:
    members = parse_ar(deb_path.read_bytes())
    repaired: list[ArMember] = []

    for member in members:
        if member.name == "debian-binary":
            member.data = b"2.0\n"
        elif member.name == "control.tar.xz":
            member.data = repair_control_tar(member.data)
        elif member.name == "data.tar.xz":
            member.data = repair_data_tar(member.data)
        repaired.append(member)

    temp_path = deb_path.with_suffix(deb_path.suffix + ".tmp")
    temp_path.write_bytes(write_ar(repaired))
    temp_path.replace(deb_path)
    update_latest_linux_yml(deb_path)
    print(f"repaired {deb_path}")


def repair_tar_gz(archive_path: Path) -> None:
    with gzip.GzipFile(filename=str(archive_path), mode="rb") as gzip_file:
        raw_tar = gzip_file.read()

    repaired = rewrite_tar(raw_tar, normalize_control_text=False)
    temp_path = archive_path.with_suffix(archive_path.suffix + ".tmp")
    with temp_path.open("wb") as output_file:
        with gzip.GzipFile(fileobj=output_file, mode="wb", mtime=0) as gzip_file:
            gzip_file.write(repaired)
    temp_path.replace(archive_path)
    print(f"repaired {archive_path}")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: fix-deb-line-endings.py <package.deb|package.tar.gz> [...]", file=sys.stderr)
        return 2

    for arg in sys.argv[1:]:
        artifact_path = Path(arg)
        if artifact_path.name.endswith(".deb"):
            repair_deb(artifact_path)
        elif artifact_path.name.endswith(".tar.gz"):
            repair_tar_gz(artifact_path)
        else:
            print(f"skipping unsupported artifact: {artifact_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
