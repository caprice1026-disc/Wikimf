"""Generate JSON schema from Backend's Pydantic source; --check detects drift."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"apps/backend"))
from wikimf.contracts import ReadingEventInput, EventBatch

parser = argparse.ArgumentParser()
parser.add_argument("--check",action="store_true")
args = parser.parse_args()
failed = False
for name,model in [("reading-event.schema.json",ReadingEventInput),("event-batch.schema.json",EventBatch)]:
    path = ROOT/"packages/contracts"/name
    content = json.dumps(model.model_json_schema(),ensure_ascii=False,indent=2)+"\n"
    if args.check:
        failed |= not path.exists() or path.read_text(encoding="utf-8") != content
    else:
        path.write_text(content,encoding="utf-8")
if failed:
    raise SystemExit("Generated schema drift; run python scripts/generate_contracts.py")
print("Contract schemas verified" if args.check else "Contract schemas generated")
