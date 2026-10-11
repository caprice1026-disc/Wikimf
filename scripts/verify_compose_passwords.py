"""Verify raw DB password wiring with isolated Compose projects; retain volumes."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proxy-ca", type=Path, help="Optional public CA bundle for the test-only Docker build")
    args = parser.parse_args()
    directory = ROOT / ".tmp" / ("compose-passwords-" + uuid4().hex[:12])
    directory.mkdir(parents=True)
    image = "wikimf-password-regression:" + directory.name
    # Compose !override prevents the real project's published ports/env_file from merging.
    override_path = directory / "override.yaml"
    config = 'services:\n  db:\n    ports: !override []\n  backend:\n    ports: !override []\n    env_file: !override [' + json.dumps(str(ROOT / ".env.example")) + ']\n    image: ' + image + '\n'
    if args.proxy_ca:
        dockerfile = directory / "Dockerfile"
        source = (ROOT / "apps/backend/Dockerfile").read_text()
        source = source.replace("RUN python -m pip", "RUN --mount=type=secret,id=proxy_ca,required=true PIP_CERT=/run/secrets/proxy_ca python -m pip")
        dockerfile.write_text("# syntax=docker/dockerfile:1\n" + source)
        config += '    build:\n      dockerfile: ' + json.dumps(str(dockerfile)) + '\n      secrets: [proxy_ca]\nsecrets:\n  proxy_ca:\n    file: ' + json.dumps(str(args.proxy_ca.resolve())) + '\n'
    override_path.write_text(config)
    results = []
    for label, password in [("alphanumeric", "synthetic_Alpha123"), ("at-sign", "synthetic@pass"), ("literal-percent40", "synthetic%40pass")]:
        project = "wikimf-password-" + uuid4().hex[:12]
        env = {**os.environ, "POSTGRES_PASSWORD": password}
        command = ["docker", "compose", "--project-name", project, "-f", str(ROOT / "compose.yaml"), "-f", str(override_path)]
        log_path = directory / (label + ".log")
        def run(*arguments, check=True):
            with log_path.open("a") as log:
                return subprocess.run(command + list(arguments), cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=check)
        def health():
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                result = subprocess.run(command + ["exec", "-T", "backend", "python", "-c",
                    "import json,urllib.request; r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8000/health',timeout=2); assert json.load(r)['status']=='ok'"],
                    cwd=ROOT, env=env, capture_output=True)
                if result.returncode == 0:
                    return
                time.sleep(1)
            raise RuntimeError(f"{label} migration/health failed; inspect {log_path}")
        try:
            if not results:
                run("build", "backend")
            run("up", "-d", "--no-build")
            health()
            run("down")  # No --volumes: restart the same initialized DB.
            run("up", "-d", "--no-build")
            health()
            results.append({"case": label, "migration": "passed", "health": "passed", "same_volume_restart": "passed", "retained_volume": project + "_postgres_data"})
            print(label + ": migration, health, retained-volume restart passed", flush=True)
        finally:
            run("down", check=False)
    output = directory / "results.json"
    output.write_text(json.dumps(results, indent=2) + "\n")
    print("Evidence: " + str(output))


if __name__ == "__main__":
    main()
