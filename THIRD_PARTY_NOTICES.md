# Third-party notices

This extension reuses the commit-pinned Cozy Read Aloud reading modules and portable core identified in vendor/cozy-reading-provenance.json, with the remaining pinned speech modules identified by vendor/provenance.json. Copyright (c) 2026 Note and PDF Voice Reader Contributors, under the MIT license. The original MIT notice is preserved in LICENSE and vendor/licenses/cozy-LICENSE. A source snapshot is not necessarily an upstream release.

The bundled Markdown parser uses markdown-it and its runtime dependencies. Their original license files are included in vendor/licenses. esbuild is a build-only dependency.

No Obsidian host code, proprietary IDE code, user notes, or credentials are distributed.

The math tokenization in src/math.cjs is adapted from vscode-office by Weijan Chen (MIT). The original source, fixed commit and adaptation details are recorded in vendor/office-provenance.json. Its MIT notice is included as vendor/licenses/vscode-office-LICENSE. Mermaid's asynchronous per-diagram rendering in the Office Vditor integration informed our independent reading preview implementation.

LaTeX is rendered by KaTeX 0.19.1 (MIT), including its bundled WOFF2 fonts. Diagrams are rendered by Mermaid 12.3.0 (MIT). All renderer JavaScript, styles and fonts are shipped locally. The licenses of the packages actually bundled by esbuild are collected in vendor/licenses during the build; dependency versions and asset hashes are recorded in qa/build-assets.json.
