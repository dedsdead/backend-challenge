---
name: visual-brainstorm-companion
description: "Use during brainstorm only when the problem is strongly visual (complex UI, flow mapping, alternatives) and create optional browser/canvas artifacts. Spawns design subagents for visual output."
---

# Visual Brainstorm Companion

Use this skill only when visual output materially improves decision quality. This skill integrates with OpenCode's `task` tool and design agents.

## When to use

- Multi-step UI flow where layout affects behavior
- Comparing 2-3 design alternatives with trade-offs
- Data flow that is hard to understand in text
- Component hierarchy that benefits from visual mapping

## When NOT to use

- Pure backend architecture decisions
- Small bugfix discussions
- Text-only requirement clarification
- Database schema changes

## Flow

### Step 1: Confirm visual aid is useful

Ask: "Would a visual artifact (diagram, mockup, flow) change the decision?" If no, skip this skill entirely.

### Step 2: Choose rendering approach

| Need | Approach | Tool |
|------|----------|------|
| UI flow / page hierarchy | Mermaid diagram | `bash` → render to SVG via `mmdc` or inline in markdown |
| Figma-to-code comparison | Design sync agent | `task` → `design/figma-design-sync` |
| Iterative layout refinement | Design iteration agent | `task` → `design/design-iterator` |
| Architecture / data flow | Mermaid or ASCII diagram | `write` → `docs/brainstorms/` |

### Step 3: Create the visual artifact

**For Mermaid diagrams** (most common):
```bash
# If mmdc (mermaid-cli) is available:
mmdc -i diagram.mmd -o diagram.svg -t dark

# Otherwise, embed Mermaid syntax in the brainstorm doc for later rendering
```

Write the diagram to `docs/brainstorms/<TIMESTAMP>-<topic>-visual.md` alongside the main brainstorm doc.

**For design agent tasks** (when Figma or implementation comparison is needed):
```
Use the task tool to spawn:
- design/design-iterator → for iterative layout refinement
- design/figma-design-sync → for Figma-to-code comparison
Pass: goal, current implementation path, Figma URL if available
```

### Step 4: Summarize decisions

After creating the visual, extract and write to the main brainstorm doc:
- What the visual revealed
- Which alternative was chosen and why
- Any new constraints discovered

### Step 5: Token budget

- Keep visual artifacts under 500 tokens each
- Prefer one focused diagram over multiple views
- If the visual grows beyond 500 tokens, split into sub-diagrams

## Output

- Visual artifact in `docs/brainstorms/` (mermaid SVG or markdown)
- Decision summary in the main brainstorm doc
- Reference to the visual artifact from the brainstorm doc

## Integration with docs-memory-guard

The `docs-memory-guard` plugin tracks whether docs were updated during a session. This skill writes to `docs/brainstorms/`, which counts as doc coverage — the plugin will not fire a warning if this skill is used.
