---
description: "Create or repair the recommended multi-root project layout with separate *_Repos and *_Workspace folders, plus a .code-workspace file that Cursor/VS Code can open directly."
---

# Setup Multi-Root Project Workspace

Use this command to create the recommended structure:

- `<ProjectName>_Repos/` for code repositories (usually frontend and backend),
- `<ProjectName>_Workspace/` for docs, `.opencode`, and workspace-level assets,
- `<ProjectName>.code-workspace` for a multi-root editor workspace.

This keeps code and workflow/docs concerns separated while still visible in one editor window.

## Input

<workspace_setup_input> $ARGUMENTS </workspace_setup_input>

If input is missing required fields, ask:

1. Project name (example: `BDTX`)
2. Base path where folders should be created (example: `/home/jpster/Repos`)
3. Frontend repo folder name (default: `frontend`)
4. Backend repo folder name (default: `backend`)
5. Optional: existing repo paths to link instead of creating new empty folders

## Rules

1. Non-destructive by default:
   - do not delete folders,
   - do not move existing repos automatically without explicit user confirmation.
2. If target folder exists, reuse it and report as "already existed".
3. Always generate/update a workspace file in `<ProjectName>_Workspace/`.
4. Keep paths explicit in the final report.

## Target structure

Create or ensure:

- `<base>/<ProjectName>_Repos/`
- `<base>/<ProjectName>_Repos/<frontend-repo>/`
- `<base>/<ProjectName>_Repos/<backend-repo>/`
- `<base>/<ProjectName>_Workspace/`
- `<base>/<ProjectName>_Workspace/docs/`
- `<base>/<ProjectName>_Workspace/.opencode/`
- `<base>/<ProjectName>_Workspace/<ProjectName>.code-workspace`

## Workspace file requirements

Write a valid JSON `.code-workspace` file with:

- one entry for workspace root (`.`),
- one entry for frontend repo path,
- one entry for backend repo path.

Use relative paths from `<ProjectName>_Workspace/`.

Example folders section:

```json
{
  "folders": [
    { "name": "Workspace", "path": "." },
    { "name": "Frontend", "path": "../<ProjectName>_Repos/<frontend-repo>" },
    { "name": "Backend", "path": "../<ProjectName>_Repos/<backend-repo>" }
  ]
}
```

## After creating the structure

1. Recommend opening `<ProjectName>.code-workspace` in Cursor/VS Code.
2. Then run `/pwf-setup` from the workspace root to initialize/repair docs skeleton.
3. If this is an existing project migration, ask whether to:
   - keep repos in place and only reference them,
   - or move/copy repos into `<ProjectName>_Repos/` (only after explicit confirmation).

## Output

Report:
- base path used,
- project name used,
- folders created,
- folders reused (already existed),
- workspace file path,
- next commands to run.

## Next Recommended Commands

- Open `<ProjectName>.code-workspace` in Cursor
- `/pwf-setup` to initialize docs structure in workspace root
- `/pwf-doc-foundation all` to build baseline documentation
- `/pwf-help` to choose the next execution path
