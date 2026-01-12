#!/usr/bin/env python3
"""
apply_local_config.py

Local "single source of truth" config applier for Cali_Votes.

- Reads secrets from secrets.local.json (NOT committed).
- Rewrites:
  - config.js (EXEC_URL, ASSET_BASE)
  - apps_script/Code.gs (best-effort: CFG keys if present)
- Makes .bak backups for every modified file.
- Refuses to run if secrets file is missing.

Usage:
  python3 scripts/apply_local_config.py
  python3 scripts/apply_local_config.py --secrets secrets.local.json
  python3 scripts/apply_local_config.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from typing import Any, Dict, List, Tuple


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

REQUIRED_KEYS = [
    "EXEC_URL",
    "ASSET_BASE",
]

# Optional keys we *attempt* to apply into apps_script/Code.gs if we find matching config keys.
OPTIONAL_CODEGS_KEYS = [
    "SHEET_ID",
    "FRONTEND_BASE_URL",
    "SENDER_EMAIL",
    "ADMIN_PASSWORD",
    "ORIGIN_ALLOWLIST",
    "DRIVE_FOLDER_ID",
    "RESEND_API_KEY",
]


def die(msg: str, code: int = 1) -> None:
    print(f"[apply_local_config] ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_backup(path: str) -> str:
    bak = path + ".bak"
    shutil.copyfile(path, bak)
    return bak


def normalize_url_no_trailing_slash(url: str) -> str:
    url = str(url or "").strip()
    return re.sub(r"/+$", "", url)


def update_config_js(text: str, secrets: Dict[str, Any]) -> Tuple[str, List[str]]:
    """
    Update window.CALI_VOTES EXEC_URL and ASSET_BASE values.
    Works against typical patterns:
      EXEC_URL: "..."
      ASSET_BASE: "..."
    """
    changes: List[str] = []

    exec_url = str(secrets["EXEC_URL"]).strip()
    asset_base = normalize_url_no_trailing_slash(str(secrets["ASSET_BASE"]))

    def repl(key: str, val: str, s: str) -> str:
        # Matches: KEY: "...." or KEY: '....'
        pattern = re.compile(rf'(\b{re.escape(key)}\s*:\s*)(["\'])(.*?)(\2)', re.DOTALL)
        m = pattern.search(s)
        if not m:
            return s
        before = m.group(3)
        if before == val:
            return s

        def _sub(_m: re.Match) -> str:
            # Use explicit \g<> to avoid numeric backref ambiguity (e.g. \21)
            return f"{_m.group(1)}{_m.group(2)}{val}{_m.group(2)}"

        out = pattern.sub(_sub, s, count=1)
        changes.append(f"config.js: set {key}")
        return out

    out = text
    out = repl("EXEC_URL", exec_url, out)
    out = repl("ASSET_BASE", asset_base, out)

    # Fail loudly if format doesn't match expected keys to avoid false confidence.
    if not re.search(r"\bEXEC_URL\s*:", out):
        die("config.js does not contain EXEC_URL key (unexpected format).")
    if not re.search(r"\bASSET_BASE\s*:", out):
        die("config.js does not contain ASSET_BASE key (unexpected format).")

    return out, changes


def _replace_cfg_string_value(text: str, key: str, value: str) -> Tuple[str, bool]:
    """
    Replace a string property in a CFG-like object literal:
      KEY: '...'
      KEY: "..."
    Only replaces the first occurrence.
    """
    pattern = re.compile(rf'(\b{re.escape(key)}\s*:\s*)(["\'])(.*?)(\2)', re.DOTALL)
    m = pattern.search(text)
    if not m:
        return text, False

    def _sub(_m: re.Match) -> str:
        return f"{_m.group(1)}{_m.group(2)}{value}{_m.group(2)}"

    out = pattern.sub(_sub, text, count=1)
    return out, True


def _replace_cfg_array_string(text: str, key: str, values: List[str]) -> Tuple[str, bool]:
    """
    Replace an array property in a CFG-like object literal:
      KEY: ["a", "b"]
    """
    # Very tolerant matcher for: KEY: [ ... ]
    pattern = re.compile(rf'(\b{re.escape(key)}\s*:\s*)\[(.*?)\]', re.DOTALL)
    m = pattern.search(text)
    if not m:
        return text, False

    new_arr = ", ".join(json.dumps(v) for v in values)

    def _sub(_m: re.Match) -> str:
        return f"{_m.group(1)}[{new_arr}]"

    out = pattern.sub(_sub, text, count=1)
    return out, True


def update_code_gs(text: str, secrets: Dict[str, Any]) -> Tuple[str, List[str]]:
    """
    Best-effort update for apps_script/Code.gs.

    This script tries to find and replace values for keys inside a CFG object.
    It will not invent a CFG if your Code.gs is structured differently.
    If it cannot find a key, it simply skips it.

    This keeps things safe across Code.gs variants.
    """
    changes: List[str] = []
    out = text

    # Common values
    if "FRONTEND_BASE_URL" in secrets and secrets["FRONTEND_BASE_URL"]:
        secrets["FRONTEND_BASE_URL"] = normalize_url_no_trailing_slash(str(secrets["FRONTEND_BASE_URL"]))

    # Try keys
    for key in OPTIONAL_CODEGS_KEYS:
        if key not in secrets or secrets[key] in (None, ""):
            continue

        if key == "ORIGIN_ALLOWLIST":
            if not isinstance(secrets[key], list):
                die("ORIGIN_ALLOWLIST must be a JSON array of strings.")
            out2, ok = _replace_cfg_array_string(out, key, [str(x) for x in secrets[key]])
            if ok and out2 != out:
                changes.append(f"apps_script/Code.gs: set {key}")
            out = out2
            continue

        out2, ok = _replace_cfg_string_value(out, key, str(secrets[key]))
        if ok and out2 != out:
            changes.append(f"apps_script/Code.gs: set {key}")
        out = out2

    return out, changes


def apply_file(path: str, new_text: str, dry_run: bool) -> None:
    if dry_run:
        return
    bak = write_backup(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_text)
    print(f"[apply_local_config] wrote {path} (backup: {bak})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--secrets", default=os.path.join(ROOT, "secrets.local.json"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    secrets_path = os.path.abspath(args.secrets)
    if not os.path.exists(secrets_path):
        die(
            f"Secrets file not found: {secrets_path}\n"
            "Create it by copying secrets.local.example.json → secrets.local.json"
        )

    secrets = load_json(secrets_path)

    for k in REQUIRED_KEYS:
        if k not in secrets or not str(secrets[k]).strip():
            die(f"Missing required key in secrets: {k}")

    # Normalize
    secrets["ASSET_BASE"] = normalize_url_no_trailing_slash(str(secrets["ASSET_BASE"]))
    secrets["EXEC_URL"] = str(secrets["EXEC_URL"]).strip()

    planned: List[str] = []
    results: Dict[str, str] = {}

    # config.js
    config_path = os.path.join(ROOT, "config.js")
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            before = f.read()
        after, ch = update_config_js(before, secrets)
        planned.extend(ch)
        results[config_path] = after
    else:
        die("config.js not found in repo root.")

    # Code.gs
    codegs_path = os.path.join(ROOT, "apps_script", "Code.gs")
    if os.path.exists(codegs_path):
        with open(codegs_path, "r", encoding="utf-8") as f:
            before = f.read()
        after, ch = update_code_gs(before, secrets)
        planned.extend(ch)
        results[codegs_path] = after
    else:
        print("[apply_local_config] NOTE: apps_script/Code.gs not found; skipping.", file=sys.stderr)

    if not planned:
        print("[apply_local_config] No changes detected (files already match secrets).")
        return 0

    print("[apply_local_config] Planned changes:")
    for line in planned:
        print(f"  - {line}")

    # Apply
    wrote_any = False
    for path, text in results.items():
        with open(path, "r", encoding="utf-8") as f:
            cur = f.read()
        if cur == text:
            continue
        apply_file(path, text, args.dry_run)
        wrote_any = True

    if args.dry_run:
        print("[apply_local_config] Dry run only; no files written.")
    else:
        if not wrote_any:
            print("[apply_local_config] No files needed writing (already up to date).")
        else:
            print("[apply_local_config] Done.")
            print("[apply_local_config] Next: review with `git diff` before committing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
