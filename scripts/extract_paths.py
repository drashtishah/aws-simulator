#!/usr/bin/env python3
"""Extract internal path references from all project files into a CSV registry.

Scans JS, MD, JSON, CSS, and HTML files for hardcoded path references to
project directories (learning/, sims/, themes/, web/, .claude/, references/).
Outputs a sorted, deduplicated CSV to references/path-registry.csv.

Usage:
    python3 scripts/extract_paths.py
"""

import csv
import os
import re
import sys
from dataclasses import dataclass, astuple
from pathlib import Path, PurePosixPath
from typing import Callable, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent

SCAN_EXTENSIONS: Set[str] = {'.js', '.md', '.json', '.css', '.html'}

EXCLUDE_DIRS: Set[str] = {'node_modules', '.git', 'learning', 'test-results'}

EXCLUDE_FILES: Set[str] = {'package-lock.json'}

# Prefixes that anchor a path as an internal project reference
PATH_PREFIXES: Tuple[str, ...] = (
    'learning/', 'sims/', 'themes/', 'web/', '.claude/', 'references/',
)

# Known bare filenames mapped to their canonical project paths
KNOWN_FILES: Dict[str, str] = {
    'profile.json': 'learning/profile.json',
    'registry.json': 'sims/registry.json',
    'catalog.csv': 'learning/catalog.csv',
    'activity.jsonl': 'learning/logs/activity.jsonl',
    'journal.md': 'learning/journal.md',
    'feedback.md': 'learning/feedback.md',
    'manifest.json': 'sims/{id}/manifest.json',
    'story.md': 'sims/{id}/story.md',
    'resolution.md': 'sims/{id}/resolution.md',
    'agent-prompts.md': '.claude/skills/play/references/agent-prompts.md',
    'coaching-patterns.md': '.claude/skills/play/references/coaching-patterns.md',
    'sim-template.md': '.claude/skills/create-sim/references/sim-template.md',
    'exam-topics.md': '.claude/skills/create-sim/references/exam-topics.md',
    'game-design.md': '.claude/skills/create-sim/references/game-design.md',
    'story-structure.md': '.claude/skills/create-sim/references/story-structure.md',
    'manifest-schema.json': '.claude/skills/create-sim/assets/manifest-schema.json',
    'workspace-map.md': 'references/workspace-map.md',
    'contributing.md': 'references/contributing.md',
    'web-app-checklist.md': 'references/web-app-checklist.md',
    '_base.md': 'themes/_base.md',
    '.mcp.json': '.mcp.json',
    'CLAUDE.md': 'CLAUDE.md',
}

# JS variable patterns to replace with template tokens
JS_VAR_REPLACEMENTS: List[Tuple[str, str]] = [
    (r'req\.params\.id', '{id}'),
    (r'req\.params\.file', '{file}'),
    (r'simId', '{simId}'),
    (r'themeId', '{themeId}'),
    (r'sessionId', '{sessionId}'),
    (r'manifest\.id', '{simId}'),
    (r'id', '{id}'),
    (r'f', '{file}'),
]


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
        # Filter out excluded directories in-place
        dirnames[:] = [
            d for d in dirnames
            if d not in EXCLUDE_DIRS
        ]
        for fname in filenames:
            if fname in EXCLUDE_FILES:
                continue
            fpath = Path(dirpath) / fname
            if fpath.suffix in SCAN_EXTENSIONS:
                files.append(fpath)
    return sorted(files)


def normalize_path(raw: str) -> Optional[str]:
    """Clean and normalize a raw extracted path string.

    Returns None if the path is external or invalid.
    """
    # Strip surrounding quotes and backticks
    cleaned = raw.strip('\'"`\t ')

    # Strip trailing punctuation from markdown context
    cleaned = cleaned.rstrip('.,;:)')

    # Strip trailing backtick that regex might include
    cleaned = cleaned.rstrip('`')

    # Skip external/absolute paths
    if cleaned.startswith(('/tmp', 'http://', 'https://', '#')):
        return None

    # Normalize JS template literals: ${varName} -> {varName}
    cleaned = re.sub(r'\$\{(\w+)\}', r'{\1}', cleaned)

    # Skip paths that are just variable references
    if cleaned.startswith('$') or cleaned.startswith('{'):
        return None

    # Map server-relative HTML paths
    if cleaned.startswith('/') and not cleaned.startswith('/.'):
        cleaned = 'web/public' + cleaned

    # Collapse parent-directory segments
    try:
        collapsed = str(PurePosixPath(cleaned))
    except (ValueError, TypeError):
        return cleaned

    # Strip leading ./
    if collapsed.startswith('./'):
        collapsed = collapsed[2:]

    # Must start with a known prefix or be a known file
    if not any(collapsed.startswith(p) or collapsed.rstrip('/') + '/' == p for p in PATH_PREFIXES):
        if collapsed not in KNOWN_FILES and collapsed not in KNOWN_FILES.values():
            return None

    # Skip bare directory names without any content (e.g., just "web" or "sims")
    if '/' not in collapsed and '.' not in collapsed:
        return None

    return collapsed if collapsed else None


def parse_path_join_args(args_str: str) -> Optional[str]:
    """Parse path.join/resolve arguments into a normalized path string.

    Handles mixed string literals and variable references.
    Returns None if the result is just ROOT or entirely dynamic.
    """
    # Split on commas, respecting quotes
    parts: List[str] = []
    for arg in re.split(r',\s*', args_str.strip()):
        arg = arg.strip()

        # Skip ROOT, __dirname, process.cwd() etc.
        if arg in ('ROOT', '__dirname', "'..'", "'..'", 'process.cwd()'):
            continue

        # String literal
        str_match = re.match(r"""^['"`]([^'"`]*)['"`]$""", arg)
        if str_match:
            parts.append(str_match.group(1))
            continue

        # Template literal segment like `${simId}.json`
        tmpl_match = re.match(r'^`([^`]*)`$', arg)
        if tmpl_match:
            val = tmpl_match.group(1)
            # Replace ${varName} with {varName}
            val = re.sub(r'\$\{(\w+)\}', r'{\1}', val)
            parts.append(val)
            continue

        # Variable reference: replace with template token
        replaced = False
        for pattern, token in JS_VAR_REPLACEMENTS:
            if re.fullmatch(pattern, arg):
                parts.append(token)
                replaced = True
                break
        if not replaced:
            # Unknown variable: use generic placeholder
            parts.append('{var}')

    if not parts:
        return None

    joined = '/'.join(parts)
    return normalize_path(joined)


def extract_from_js(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from a JavaScript file."""
    entries: List[PathEntry] = []
    lines = content.split('\n')

    for line_num, line in enumerate(lines, start=1):
        # Pattern 1: path.join(...) and path.resolve(...)
        for match in re.finditer(r'path\.(?:join|resolve)\(([^)]+)\)', line):
            result = parse_path_join_args(match.group(1))
            if result:
                entries.append(PathEntry(file=rel_path, path=result, line_number=line_num))

        # Pattern 2: String literal paths (including template literals with ${})
        for match in re.finditer(
            r"""['"`]((?:learning|sims|themes|web|\.claude|references)/[^'"\s]+?)['"`]""",
            line,
        ):
            normalized = normalize_path(match.group(1))
            if normalized:
                entries.append(PathEntry(file=rel_path, path=normalized, line_number=line_num))

    return entries


def extract_from_md(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from a Markdown file."""
    entries: List[PathEntry] = []
    lines = content.split('\n')

    # If the file is inside .claude/ (skill or command), "references/" paths
    # that don't match top-level reference files are skill-relative
    is_claude_internal = rel_path.startswith('.claude/')
    skill_match = re.match(r'(\.claude/skills/[^/]+/)', rel_path)
    skill_base = skill_match.group(1) if skill_match else None

    # Top-level reference files that actually live in references/
    TOP_LEVEL_REFS = ('references/workspace-map', 'references/contributing', 'references/web-app-checklist')

    for line_num, line in enumerate(lines, start=1):
        # Pattern 1: Backtick-wrapped paths with known prefixes
        for match in re.finditer(
            r'`((?:learning|sims|themes|web|\.claude|references)/[^`\n]+)`',
            line,
        ):
            raw = match.group(1)
            # Inside .claude/, "references/X" where X is not a top-level ref file
            # is a skill-relative reference. Resolve to skill path if known,
            # otherwise mark as template since the exact skill is ambiguous.
            if is_claude_internal and raw.startswith('references/') and not any(raw.startswith(t) for t in TOP_LEVEL_REFS):
                if skill_base:
                    raw = skill_base + raw
                else:
                    # Command file referencing a skill's references/ dir
                    raw = '.claude/skills/{skill}/' + raw
            normalized = normalize_path(raw)
            if normalized:
                entries.append(PathEntry(file=rel_path, path=normalized, line_number=line_num))

        # Pattern 2: Known bare filenames in backticks
        for match in re.finditer(r'`([A-Za-z_][\w.-]+\.\w+)`', line):
            fname = match.group(1)
            if fname in KNOWN_FILES:
                entries.append(PathEntry(
                    file=rel_path,
                    path=KNOWN_FILES[fname],
                    line_number=line_num,
                ))

        # Pattern 3: Bare directory references in backticks
        for match in re.finditer(
            r'`((?:learning|sims|themes|web|\.claude|references)/)`',
            line,
        ):
            normalized = normalize_path(match.group(1))
            if normalized:
                entries.append(PathEntry(file=rel_path, path=normalized, line_number=line_num))

    return entries


def extract_from_json(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from a JSON file."""
    entries: List[PathEntry] = []
    lines = content.split('\n')

    for line_num, line in enumerate(lines, start=1):
        for match in re.finditer(
            r'"((?:learning|sims|themes|web|\.claude|references)/[^"]+)"',
            line,
        ):
            normalized = normalize_path(match.group(1))
            if normalized:
                entries.append(PathEntry(file=rel_path, path=normalized, line_number=line_num))

    return entries


def extract_from_html(content: str, rel_path: str) -> List[PathEntry]:
    """Extract path references from an HTML file."""
    entries: List[PathEntry] = []
    lines = content.split('\n')

    for line_num, line in enumerate(lines, start=1):
        for match in re.finditer(r'(?:href|src)="(/[^"]+)"', line):
            raw = match.group(1)
            # Skip external URLs and anchors
            if raw.startswith(('http://', 'https://', '#', '//')):
                continue
            normalized = normalize_path(raw)
            if normalized:
                entries.append(PathEntry(file=rel_path, path=normalized, line_number=line_num))

    return entries


# Map extensions to their extractor function
EXTRACTORS: Dict[str, Callable[[str, str], List[PathEntry]]] = {
    '.js': extract_from_js,
    '.md': extract_from_md,
    '.json': extract_from_json,
    '.html': extract_from_html,
    '.css': lambda content, rel_path: [],  # CSS has no path refs in this project
}


def write_csv(entries: List[PathEntry], output: Path) -> None:
    """Write sorted, deduplicated entries to CSV."""
    # Deduplicate
    unique = sorted(set(entries), key=lambda e: (e.file, e.line_number, e.path))

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['file', 'path', 'line_number'])
        for entry in unique:
            writer.writerow(astuple(entry))


def main() -> None:
    """Entry point: collect files, extract paths, write CSV."""
    output_path = ROOT / 'references' / 'path-registry.csv'

    files = collect_files(ROOT)
    all_entries: List[PathEntry] = []

    for fpath in files:
        rel = str(fpath.relative_to(ROOT))
        ext = fpath.suffix

        extractor = EXTRACTORS.get(ext)
        if not extractor:
            continue

        try:
            content = fpath.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            continue

        entries = extractor(content, rel)
        all_entries.extend(entries)

    write_csv(all_entries, output_path)

    # Summary
    unique_entries = set(all_entries)
    source_files = {e.file for e in unique_entries}
    print(f"Wrote {len(unique_entries)} entries from {len(source_files)} files to {output_path.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
