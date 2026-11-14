# Markdown Section Reader 0.7.5

- Add the default-on `mdReader.academicTableRepeatHeaders` preference and reading-settings checkbox. Disable it to read column names once at the beginning of each table, followed by row values.
- Keep smart/all/skip table policy independent. Preserve blank-cell positions, zero values and source ranges.
- Synchronize Cozy desktop 1.7.7 reading modules and portable core 0.3.1, with commit-pinned, per-file provenance and MIT notices.
- Preserve formula smart skipping, concise/full formula modes, session guards, local voices and explicit MiMo credential handling.

Install the VSIX in Qoder, Cursor or VS Code, then reload the existing IDE window when convenient. This update does not import credentials, send notes, modify source documents or reload an active reading session automatically.

Offline regression tests and package integrity checks use public, synthetic examples. Real-device voice quality and complete interactive IDE workflows are not revalidated by these tests.
