#!/usr/bin/env python3
import os, re, sys, glob, shutil

BANNER_DIV = '<div id="sessionBanner"></div>'
BANNER_CALL = '<script>mountSessionBanner();</script>'

def patch_html(text: str) -> str:
    # If already patched, do nothing (idempotent)
    already_div = re.search(r'id=["\']sessionBanner["\']', text, re.I) is not None
    already_call = re.search(r'\bmountSessionBanner\s*\(\s*\)\s*;', text, re.I) is not None

    out = text

    # Inject banner div right after <body ...>
    if not already_div:
        m = re.search(r'(<body\b[^>]*>)', out, re.I)
        if not m:
            return out  # no <body>, skip
        insert_at = m.end()
        out = out[:insert_at] + "\n  " + BANNER_DIV + "\n" + out[insert_at:]

    # Inject script call right before </body>
    if not already_call:
        m = re.search(r'(</body\s*>)', out, re.I)
        if not m:
            return out  # no </body>, skip
        insert_at = m.start()
        out = out[:insert_at] + "  " + BANNER_CALL + "\n" + out[insert_at:]

    return out

def main():
    # default: patch html in repo root only
    # pass --all to include subdirectories too
    include_all = ("--all" in sys.argv)

    patterns = ["*.html"] if not include_all else ["**/*.html"]
    files = []
    for pat in patterns:
        files.extend(glob.glob(pat, recursive=True))

    files = [f for f in files if os.path.isfile(f)]
    # Skip Apps Script html if you keep it in apps_script (optional)
    files = [f for f in files if not f.startswith("apps_script/")]

    if not files:
        print("No HTML files found to patch.")
        return 0

    changed = 0
    for path in sorted(files):
        with open(path, "r", encoding="utf-8", errors="replace") as fp:
            before = fp.read()

        after = patch_html(before)
        if after != before:
            # backup
            bak = path + ".bak"
            shutil.copyfile(path, bak)
            with open(path, "w", encoding="utf-8") as fp:
                fp.write(after)
            print(f"PATCHED: {path} (backup: {bak})")
            changed += 1
        else:
            print(f"OK:      {path} (no change)")

    print(f"\nDone. Files changed: {changed}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
