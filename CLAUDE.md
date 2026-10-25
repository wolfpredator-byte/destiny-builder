@AGENTS.md

# Destiny Build Assistant — Project Instructions

## Project purpose
Destiny Builder is a Destiny 2 build-management and
recommendation application connected to Bungie APIs.

Tech stack: Next.js, TypeScript, React and Tailwind CSS.

## Mandatory development rules

- The project roadmap is `docs/ROADMAP.md` and is the source of truth.
- Read `docs/ROADMAP.md` before planning changes; only the phase marked ▶ is authorized.
- For evidence and decision history, see `docs/DESTINY_BUILDER_PROJECT_MEMORY.md`.
- If `docs/ROADMAP.md` cannot be located, report that fact.
~~~

## Come salvarla

Non posso scrivere io sul repository. Da PowerShell, nella radice del progetto:

~~~powershell
# dopo aver salvato il file in docs\ROADMAP.md e modificato CLAUDE.md
git status --short
git diff CLAUDE.md
git add docs/ROADMAP.md CLAUDE.md
git commit -m "docs: add ROADMAP.md as source of truth (allineata a memoria v1.8)"
~~~

- Never infer the current project phase from Git commits alone.
- Never implement new features outside the approved phase.
- Do not modify unrelated files.
- Do not invent Destiny 2 mechanics or API behavior.
- Distinguish verified facts from assumptions.
- Preserve existing working functionality.

## Teaching mode

- Explain important code changes in Italian.
- Comment functions, important logic and non-obvious values.
- Explain why a change is necessary.
- Keep explanations practical and concise.

## Workflow

1. Inspect only files relevant to the task.
2. Identify dependencies and potential risks.
3. Explain the proposed implementation before editing.
4. Wait for approval before significant changes.
5. Make small, focused modifications.
6. Run relevant tests when authorized.
7. Report modified files, results and remaining issues.

## Safety

- Never expose credentials, tokens or secrets.
- Do not execute destructive Git commands.
- Never alter Bungie authentication without approval.
- Do not overwrite or regenerate project instructions.
- Preserve existing previews and UI functionality.
