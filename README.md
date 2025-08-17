# CC-Site-Cloner: AI-Powered Website Cloning

CC-Site-Cloner is an intelligent command-line tool that uses the power of Google's Gemini LLM to clone a public website, analyze its structure, and generate a runnable Express.js application to serve the cloned content. It demonstrates a sophisticated Chain of Thought (CoT) architecture where an AI orchestrator dynamically plans and executes a workflow using a defined set of tools.

This project is more than just a scraper; it's an example of how LLMs can be used to automate complex, multi-step software engineering tasks.

## Key Features
- **Intelligent Cloning**: Fetches a website's HTML and assets, intelligently rewriting paths to work locally.
- **AI-Powered Workflow**: Utilizes Google Gemini (`gemini-1.5-flash`) and a Chain of Thought (CoT) prompt to dynamically plan and execute the cloning process.
- **Automated App Generation**: Analyzes the cloned site's structure and automatically generates a complete, runnable Express.js server to host it.
- **Tool-Based Architecture**: Built around a clear set of tools (`cloneWebsite`, `analyzeWebsite`, `generateNodeApp`) that the AI orchestrator can use.
- **Configurable & Deterministic**: The AI workflow is optional (`USE_GOOGLE=true`). The application can run in a fully deterministic mode and has a configurable fallback policy.
- **Easy Deployment**: Includes a simple helper script to install dependencies and start the generated Node.js application.

## How It Works: The AI Orchestrator
The core of this project is the AI-driven workflow, managed by the `workflow-orchestrator.js`.
1.  **Prompting**: When you provide a URL, the `workflow-composer.js` kicks off the process by sending an initial request and a detailed system prompt to the Gemini LLM. This system prompt, located in `COT_SETUP.md`, instructs the AI to act as an automated agent and use the available tools.
2.  **Chain of Thought (CoT)**: The AI receives the request and the list of available tools. It then creates a plan, thinking step-by-step. Its first response might be to use the `cloneWebsite` tool.
3.  **Tool Execution**: The orchestrator parses the AI's JSON response, sees the request to use `cloneWebsite`, and executes the actual `cloneWebsite` function.
4.  **Observation**: The result of the tool's execution (e.g., the directory path of the cloned site) is sent back to the AI as an "observation".
5.  **Iteration**: The AI receives this new information and continues the process, deciding the next step (e.g., calling `analyzeWebsite` on the new directory).
This loop continues until the AI determines the task is complete and generates a final `OUTPUT` step.

## Requirements
- Node.js 18+

## Installation
```
npm install
```

## Configuration (`.env`)
Create a `.env` file in the project root by copying the `.env.example` file.
```
# Core Settings
USE_GOOGLE=true        # Set to true to enable the Gemini-powered AI workflow.
GEMINI_API_KEY=        # Your Google AI Studio API key. Required if USE_GOOGLE=true.
WEBSITE_URL=           # An optional default URL to use if none is provided at runtime.

# Advanced Settings
FALLBACK_POLICY=last_resort  # "never", "last_resort", or "always". Controls when the deterministic fallback runs.
COT_PROMPT_FILE=COT_SETUP.md # (optional) Path to a custom CoT system prompt file.
```

## Usage
The easiest way to run the application is with the interactive prompt:
```
npm start
```
The application will prompt you to enter a website URL.

Alternatively, you can provide the URL via an environment variable or as a command-line argument:
```
# Using an environment variable
$Env:WEBSITE_URL="https://example.com"; npm start

# Using a command-line argument
node workflow-composer.js https://example.com
```

## Project Structure
The list below describes the key files and their roles.

- `workflow-composer.js` → **Main entry point**. Gets user input and starts the AI orchestrator.
- `workflow-orchestrator.js` → **The brain of the application**. Manages the CoT conversation with Gemini, calls tools, and oversees the workflow.
- `chai-gem-cloner.js` → A **library of core tools**: `cloneWebsite`, `analyzeWebsite`, `generateNodeApp`.
- `COT_SETUP.md` → The **configurable system prompt** and design document for the AI's Chain of Thought process.
- `deploy-latest.js` → A helper script to install dependencies and run the latest generated application.
- `utils/json-handler.js` → A utility for robustly parsing and validating JSON from the AI.
- `clones/` → The output directory for cloned websites and their generated Express apps.

```
.
├── clones/
├── utils/
│   └── json-handler.js
├── .env.example
├── .gitignore
├── COT_SETUP.md
├── CONTRIBUTING.md
├── README.md
├── chai-gem-cloner.js
├── deploy-latest.js
├── package.json
├── workflow-composer.js
└── workflow-orchestrator.js
```

## Contributing
See `CONTRIBUTING.md`.

## License
ISC
