#!/usr/bin/env python3
"""Safely extract ZIP archives without path traversal or silent overwrites."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024
MAX_FILE_SIZE = 512 * 1024 * 1024
MAX_ENTRIES = 100_000


def safe_member_path(name: str) -> PurePosixPath:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or any(part in ("..", "") for part in path.parts):
        raise ValueError(f"不安全的 ZIP 路径: {name!r}")
    if path.parts and ":" in path.parts[0]:
        raise ValueError(f"不允许 Windows 盘符路径: {name!r}")
    return path


def extract_one(archive: Path, output_root: Path) -> dict:
    if not archive.is_file():
        raise FileNotFoundError(archive)
    if not zipfile.is_zipfile(archive):
        raise ValueError(f"文件不是有效 ZIP，可能扩展名错误或文件不完整: {archive}")

    destination = output_root / archive.stem
    if destination.exists():
        raise FileExistsError(f"目标目录已存在，为防止覆盖已停止: {destination}")

    with zipfile.ZipFile(archive) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError(f"文件条目过多: {len(infos)}")
        total = sum(info.file_size for info in infos)
        if total > MAX_TOTAL_SIZE:
            raise ValueError(f"解压总大小超过限制: {total} bytes")
        for info in infos:
            member = safe_member_path(info.filename)
            if info.file_size > MAX_FILE_SIZE:
                raise ValueError(f"单个文件超过限制: {info.filename}")
            mode = (info.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise ValueError(f"不允许解压符号链接: {info.filename}")
            if info.flag_bits & 0x1:
                raise ValueError(f"不支持加密 ZIP 条目: {info.filename}")
            if info.file_size and info.compress_size == 0:
                raise ValueError(f"压缩数据异常: {info.filename}")
            if info.compress_size and info.file_size / info.compress_size > 1000:
                raise ValueError(f"压缩率异常，疑似 ZIP 炸弹: {info.filename}")

        bad_member = zf.testzip()
        if bad_member:
            raise ValueError(f"CRC 校验失败，损坏条目: {bad_member}")

        destination.mkdir(parents=True, exist_ok=False)
        extracted_files = 0
        try:
            for info in infos:
                relative = safe_member_path(info.filename)
                target = destination.joinpath(*relative.parts)
                resolved = target.resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise ValueError(f"目标路径越界: {info.filename}")
                if info.is_dir() or info.filename.endswith("/"):
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as source, target.open("xb") as sink:
                    shutil.copyfileobj(source, sink, length=1024 * 1024)
                extracted_files += 1
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            raise

    return {
        "archive": str(archive),
        "output": str(destination),
        "files": extracted_files,
        "uncompressed_bytes": total,
        "status": "success",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="安全解压 ZIP 文件")
    parser.add_argument("archives", nargs="+", help="一个或多个 ZIP 文件")
    parser.add_argument("--output", default="extracted", help="输出目录，默认 extracted/")
    args = parser.parse_args()
    output_root = Path(args.output)
    output_root.mkdir(parents=True, exist_ok=True)
    results = []
    failed = False
    for raw in args.archives:
        archive = Path(raw)
        try:
            result = extract_one(archive, output_root)
            print(f"[成功] {archive} -> {result['output']} ({result['files']} 个文件)")
        except Exception as exc:
            failed = True
            result = {"archive": raw, "status": "failed", "error": str(exc)}
            print(f"[失败] {raw}: {exc}", file=sys.stderr)
        results.append(result)
    report = output_root / "unzip-report.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"报告已写入: {report}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
