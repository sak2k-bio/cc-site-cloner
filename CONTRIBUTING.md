# Contributing

Thanks for your interest in contributing!

## Development setup
1. Fork and clone the repo
2. Node.js 18+
3. Install deps: `npm install`
4. Create `.env` (see `.env.example`)
5. Run: `npm start`

## Branching & commits
- Create feature branches from `main`
- Conventional commits preferred (e.g., `feat: add prompt default`, `fix: json parsing`)

## Coding guidelines
- Keep outputs terse and actionable in CLI
- Prefer async/await and error handling with clear messages
- Avoid committing secrets; use `.env`

### Architecture Overview
The project follows an orchestrator-tool pattern.
- **`workflow-orchestrator.js`** is the central controller. It communicates with the Gemini LLM and manages the overall state of the workflow.
- **`chai-gem-cloner.js`** is a library of "tools". These are simple, single-purpose functions that the orchestrator can call.
- To add a new capability, first add it as a tool in `chai-gem-cloner.js`, then update the system prompt in `COT_SETUP.md` to make the AI aware of the new tool.

## Pull requests
- Include a concise description and screenshots/log snippets if relevant
- Ensure `npm start` runs and produces expected output
- Update docs if behavior changes

## Reporting issues
- Include Node version, OS, steps to reproduce, and relevant logs
