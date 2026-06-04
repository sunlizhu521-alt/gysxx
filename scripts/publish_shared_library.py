import base64
import json
import mimetypes
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SOURCE_CONFIG = DATA_DIR / "library-source-files.json"
SHARED_LIBRARY = DATA_DIR / "shared-library.json"


def now_iso():
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).replace(microsecond=0).isoformat()


def file_iso(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).replace(microsecond=0).isoformat()


def refresh_month_from_name_or_mtime(path):
    match = re.search(r"(20\d{2})[-年.]?\s*(0?[1-9]|1[0-2])", path.name)
    if match:
      return f"{match.group(1)}-{int(match.group(2)):02d}"
    modified = datetime.fromtimestamp(path.stat().st_mtime)
    return f"{modified.year}-{modified.month:02d}"


def build_record(item):
    path = Path(item["path"])
    if not path.exists():
        raise FileNotFoundError(f"{item['id']} source file is missing: {path}")
    mime_type = mimetypes.guess_type(path.name)[0] or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    saved_at = file_iso(path)
    return {
        "id": item["id"],
        "name": path.name,
        "size": path.stat().st_size,
        "typeLabel": item.get("typeLabel") or "Excel 工作簿",
        "mimeType": mime_type,
        "refreshMonth": item.get("refreshMonth") or refresh_month_from_name_or_mtime(path),
        "savedAt": saved_at,
        "applied": True,
        "appliedAt": saved_at,
        "dataBase64": base64.b64encode(path.read_bytes()).decode("ascii"),
    }


def load_config():
    with SOURCE_CONFIG.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def main():
    config = load_config()
    payload = {
        "version": 1,
        "generatedAt": now_iso(),
        "stores": {
            "dimension-files": [build_record(item) for item in config.get("dimension-files", [])],
            "fact-files": [build_record(item) for item in config.get("fact-files", [])],
        },
    }
    write_json(SHARED_LIBRARY, payload)
    print(f"shared-library records: {sum(len(records) for records in payload['stores'].values())}")

    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_dashboard_data.py")], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
