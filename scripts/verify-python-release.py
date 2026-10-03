"""Install both release distributions outside the checkout; no dev extra or editable install."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile


def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True, timeout=300)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    distributions = sorted(args.dist.resolve().glob("*.whl")) + sorted(args.dist.resolve().glob("*.tar.gz"))
    assert len(distributions) == 2 and sum(p.suffix == ".whl" for p in distributions) == 1, (
        "Expected exactly one wheel and one sdist"
    )
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source_sha = (
        os.environ.get("GITHUB_SHA")
        or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    )
    expected_version = re.search(
        r'^version = "([^"]+)"',
        (root / "packages/python-sdk/pyproject.toml").read_text(),
        re.MULTILINE,
    ).group(1)
    reports = []
    for distribution in distributions:
        with tempfile.TemporaryDirectory(prefix="qveris-release-python-") as workspace:
            temporary = Path(workspace)
            environment = temporary / "venv"
            run(["uv", "venv", "--python", sys.executable, str(environment)], temporary)
            executable = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            run(
                [
                    "uv",
                    "pip",
                    "install",
                    "--python",
                    str(executable),
                    str(distribution),
                ],
                temporary,
            )
            shutil.copyfile(root / "scripts/release-smoke-python.py", temporary / "consumer.py")
            shutil.copyfile(
                root / "docs/openapi/qveris-public-api.projection-fixtures.json",
                temporary / "fixtures.json",
            )
            run([str(executable), "-I", "consumer.py"], temporary)
            run(["uv", "pip", "check", "--python", str(executable)], temporary)
            shutil.copytree(root / "packages/python-sdk/examples", temporary / "examples")
            run([str(executable), "-I", "-m", "compileall", "-q", "examples"], temporary)
            version = subprocess.check_output(
                [
                    str(executable),
                    "-I",
                    "-c",
                    "import importlib.metadata; print(importlib.metadata.version('qveris'))",
                ],
                cwd=temporary,
                text=True,
            ).strip()
            assert version == expected_version, "Installed package version differs from candidate metadata"
            reports.append(
                {
                    "artifact": distribution.name,
                    "sha256": hashlib.sha256(distribution.read_bytes()).hexdigest(),
                    "version": version,
                    "status": "passed",
                    "checks": [
                        "isolated_install",
                        "public_exports",
                        "generated_models",
                        "bundled_changelog",
                        "detail_query",
                        "paid_single_submit",
                        "next_action",
                        "dependency_consistency",
                        "example_syntax",
                    ],
                }
            )
    report = {
        "source_sha": source_sha,
        "package": "qveris",
        "runtime": platform.python_version(),
        "platform": platform.system(),
        "artifacts": reports,
        "status": "passed",
        "live_service": "not_run",
    }
    (output / "python-release-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
