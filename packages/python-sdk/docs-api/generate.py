"""Generate checked-in Markdown API references with Sphinx autodoc."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


DOCS_API = Path(__file__).resolve().parent
REPO_ROOT = DOCS_API.parents[2]


def build(master_doc: str, language: str, target: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="qveris-sphinx-") as temporary:
        temporary_path = Path(temporary)
        source = temporary_path / "source"
        output = temporary_path / "output"
        source.mkdir()
        shutil.copyfile(DOCS_API / "conf.py", source / "conf.py")
        shutil.copyfile(DOCS_API / f"{master_doc}.rst", source / "index.rst")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "sphinx",
                "-W",
                "--keep-going",
                "-b",
                "markdown",
                "-D",
                "master_doc=index",
                "-D",
                f"language={language}",
                str(source),
                str(output),
            ],
            check=True,
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output / "index.md", target)


build("index", "en", REPO_ROOT / "docs/en-US/python-sdk-api.md")
build("index_zh", "zh_CN", REPO_ROOT / "docs/zh-CN/python-sdk-api.md")
