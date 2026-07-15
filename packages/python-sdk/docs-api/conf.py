"""Sphinx configuration for the generated public Python SDK API reference."""

from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

project = "qveris"
extensions = ["sphinx.ext.autodoc", "sphinx.ext.napoleon", "sphinx_markdown_builder"]
master_doc = "index"
exclude_patterns = []
autodoc_member_order = "bysource"
autodoc_typehints = "signature"
autodoc_typehints_format = "short"
markdown_flavor = "github"
markdown_anchor_sections = True
markdown_anchor_signatures = True
markdown_docinfo = False
