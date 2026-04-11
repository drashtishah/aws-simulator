#!/usr/bin/env python3
"""Extract path references from markdown and JSON files into a CSV registry.

Scans .md and .json files for strings that look like file/directory paths
(anything containing a slash). These are files where paths must be hardcoded
since there's no import/variable mechanism.

The script only extracts and reports. It does not validate, resolve, or
rewrite paths. The test (web/test/path-registry.test.ts) handles validation.

Outputs a sorted, deduplicated CSV to references/registries/path-registry.csv.

Usage:
    python3 scripts/extract_paths.py
"""

import csv
import os
import re
from dataclasses import dataclass, astuple
from pathlib import Path
from typing import List, Optional, Set

ROOT = Path(__file__).resolve().parent.parent

SCAN_EXTENSIONS: Set[str] = {'.md', '.json'}

EXCLUDE_DIRS: Set[str] = {'node_modules', '.git', 'learning', 'sims', 'web/test-results', 'docs', 'plans', '.worktrees', 'worktrees', '.tmp'}

EXCLUDE_FILES: Set[str] = {'package-lock.json'}

# A valid project path: lowercase word chars, digits, dots, hyphens, underscores,
# braces (for templates), slashes, and dollar signs (for template literals).
# No spaces, no colons, no parentheses, no commas, no uppercase letters.
PATH_CHAR_RE = re.compile(r'^[a-z0-9./\-_{}\$]+$')


@dataclass(frozen=True)
class PathEntry:
    """A single path reference found in a source file."""
    file: str
    path: str
    line_number: int


def collect_files(root: Path) -> List[Path]:
    """Walk the repo tree and return scannable files."""
    files: List[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fname in filenames:
            if fname in EXCLUDE_FILES:
                continue
            fpath = Path(dirpath) / fname
            if fpath.suffix in SCAN_EXTENSIONS:
                files.append(fpath)
    return sorted(files)


def normalize_path(raw: str) -> Optional[str]:
    """Clean and normalize a raw extracted path string.

    Returns None if the string is clearly not a project path.
    Does not check whether the path exists on disk.
    """
    cleaned = raw.strip()

    # Strip trailing punctuation from markdown context
    cleaned = cleaned.rstrip('.,;:)`')

    # Must contain a slash
    if '/' not in cleaned:
        return None

    # Must look like a filesystem path
    if not PATH_CHAR_RE.match(cleaned):
        return None

    # Skip IP addresses and CIDR ranges (e.g., 10.0.0.0/16)
    if re.match(r'\d+\.\d+\.\d+', cleaned):
        return None

    # Strip leading ./
    if cleaned.startswith('./'):
        cleaned = cleaned[2:]

    # Skip absolute paths
    if cleaned.startswith('/'):
        return None

    # Skip empty paths
    if not cleaned.replace('/', ''):
        return None

    return cleaned if cleaned else None


def extract_from_md(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from a Markdown file.

    Matches any backtick-wrapped string that contains a slash.
    """
    entries: List[PathEntry] = []
    lines = content.split('\n')

    for line_num, line in enumerate(lines, start=1):
        for match in re.finditer(r'`([^`\n]*?/[^`\n]*?)`', line):
            normalized = normalize_path(match.group(1))
            if normalized:
                entries.append(PathEntry(
                    file=rel_path,
                    path=normalized,
                    line_number=line_num,
                ))

    return entries


def extract_from_json(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from a JSON file.

    Matches any JSON string value that contains a slash.
    """
    entries: List[PathEntry] = []
    lines = content.split('\n')

    for line_num, line in enumerate(lines, start=1):
        for match in re.finditer(r'"([^"]*?/[^"]*?)"', line):
            normalized = normalize_path(match.group(1))
            if normalized:
                entries.append(PathEntry(
                    file=rel_path,
                    path=normalized,
                    line_number=line_num,
                ))

    return entries


def write_csv(entries: List[PathEntry], output: Path) -> None:
    """Write sorted, deduplicated entries to CSV."""
    unique = sorted(set(entries), key=lambda e: (e.file, e.line_number, e.path))

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['file', 'path', 'line_number'])
        for entry in unique:
            writer.writerow(astuple(entry))


def main() -> None:
    """Entry point: collect files, extract paths, write CSV."""
    output_path = ROOT / 'references' / 'registries' / 'path-registry.csv'

    files = collect_files(ROOT)
    all_entries: List[PathEntry] = []

    extractors = {
        '.md': extract_from_md,
        '.json': extract_from_json,
    }

    for fpath in files:
        rel = str(fpath.relative_to(ROOT))

        extractor = extractors.get(fpath.suffix)
        if not extractor:
            continue

        try:
            content = fpath.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            continue

        entries = extractor(content, rel)
        all_entries.extend(entries)

    write_csv(all_entries, output_path)

    unique_entries = set(all_entries)
    source_files = {e.file for e in unique_entries}
    print(f"Wrote {len(unique_entries)} entries from {len(source_files)} files to {output_path.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
