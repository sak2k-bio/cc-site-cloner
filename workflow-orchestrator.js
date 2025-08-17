import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import JsonHandler from './utils/json-handler.js';
import * as clonerTools from './chai-gem-cloner.js';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

const USE_GOOGLE = process.env.USE_GOOGLE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FALLBACK_POLICY = (process.env.FALLBACK_POLICY || 'last_resort').toLowerCase();
const COT_PROMPT_FILE = process.env.COT_PROMPT_FILE || 'COT_SETUP.md';

const TOOL_MAP = {
    cloneWebsite: clonerTools.cloneWebsite,
    analyzeWebsite: clonerTools.analyzeWebsite,
    generateNodeApp: clonerTools.generateNodeApp,
    executeCommand: clonerTools.executeCommand,
};

class WorkflowOrchestrator {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required for WorkflowOrchestrator.');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        this.conversationHistory = [];
        this.systemPrompt = '';
    }

    async initialize() {
        try {
            const promptPath = path.resolve(process.cwd(), COT_PROMPT_FILE);
            const promptContent = await fs.readFile(promptPath, 'utf8');
            this.systemPrompt = promptContent;
            this.conversationHistory.push({ role: 'system', content: this.systemPrompt });
        } catch (error) {
            console.error(`Failed to load system prompt from ${COT_PROMPT_FILE}:`, error);
            throw new Error('Could not initialize orchestrator.');
        }
    }

    async generateWithGoogle(messages) {
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const result = await this.model.generateContent({
            contents,
            generationConfig: { temperature: 0.0, maxOutputTokens: 4000 },
        });

        return result.response?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(result.response);
    }

    extractFirstJsonArray(text) {
        const start = text.indexOf('[');
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '[') depth++;
            else if (text[i] === ']') {
                depth--;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return null; // Unmatched brackets
    }

    parseAIResponse(rawContent) {
        const steps = [];
        const jsonArrayStr = this.extractFirstJsonArray(rawContent);

        if (jsonArrayStr) {
            try {
                const parsed = JsonHandler.safeParse(jsonArrayStr);
                if (Array.isArray(parsed)) {
                    for (const s of parsed) {
                        const validated = JsonHandler.validateWorkflowStep(s);
                        if (validated) steps.push(validated);
                    }
                    if (steps.length > 0) return steps;
                }
            } catch (e) {
                console.warn('Could not parse the main JSON array, falling back to object scanning.');
            }
        }

        // Fallback to scanning for individual JSON objects
        const objRegex = /\{\s*"step"[\s\S]*?\}/g;
        let match;
        while ((match = objRegex.exec(rawContent)) !== null) {
            try {
                const o = JsonHandler.safeParse(match[0]);
                const validated = o && JsonHandler.validateWorkflowStep(o);
                if (validated) steps.push(validated);
            } catch (e) {
                console.warn('Ignoring invalid JSON step object:', match[0]);
            }
        }
        return steps;
    }

    async run(initialRequest) {
        console.log('🤖 Orchestrator starting workflow...');
        this.conversationHistory.push({ role: 'user', content: initialRequest });

        let cloneResult, analysisResult, generateResult;
        const maxIterations = 15;
        let safety = 0;

        while (safety < maxIterations) {
            safety++;
            let rawResponse;

            if (USE_GOOGLE) {
                console.log(`\n🤔 Thinking... (Iteration ${safety})`);
                rawResponse = await this.generateWithGoogle(this.conversationHistory);
            } else {
                console.log('\n⚙️ Google disabled, using deterministic plan.');
                rawResponse = JSON.stringify([
                    { step: 'TOOL', tool_name: 'cloneWebsite', input: initialRequest.split(' ').pop() },
                    { step: 'TOOL', tool_name: 'analyzeWebsite', input: null },
                    { step: 'TOOL', tool_name: 'generateNodeApp', input: null },
                    { step: 'OUTPUT', content: 'Deterministic workflow complete.' }
                ]);
            }

            console.log('--- Raw AI Response ---');
            console.log(rawResponse);
            console.log('-------------------------');

            const steps = this.parseAIResponse(rawResponse);
            if (steps.length === 0) {
                console.warn('No valid steps found in AI response. Ending workflow.');
                break;
            }

            this.conversationHistory.push({ role: 'assistant', content: JSON.stringify(steps) });

            let shouldContinue = true;
            for (const step of steps) {
                console.log(`\n▶️ Executing step: ${step.step} - ${step.content || step.tool_name}`);
                let observation = '';

                switch (step.step) {
                    case 'TOOL':
                        const tool = TOOL_MAP[step.tool_name];
                        if (!tool) {
                            observation = `Error: Tool "${step.tool_name}" not found.`;
                            console.error(observation);
                        } else {
                            try {
                                let toolInput = step.input;
                                if (step.tool_name === 'analyzeWebsite' && cloneResult?.dir) {
                                    toolInput = cloneResult.dir;
                                } else if (step.tool_name === 'generateNodeApp' && cloneResult?.dir && analysisResult) {
                                    toolInput = [cloneResult.dir, analysisResult];
                                }

                                const result = await (Array.isArray(toolInput) ? tool(...toolInput) : tool(toolInput));
                                observation = JSON.stringify(result, null, 2);

                                if (step.tool_name === 'cloneWebsite') cloneResult = result;
                                if (step.tool_name === 'analyzeWebsite') analysisResult = result;
                                if (step.tool_name === 'generateNodeApp') generateResult = result;

                            } catch (e) {
                                observation = `Error executing ${step.tool_name}: ${e.message}`;
                                console.error(observation);
                            }
                        }
                        break;

                    case 'THINK':
                        // No action needed, just log the thought process
                        observation = "Acknowledged thought.";
                        break;

                    case 'OUTPUT':
                        console.log(`\n✅ Workflow finished with output: ${step.content}`);
                        shouldContinue = false;
                        break;

                    default:
                        observation = `Warning: Unknown step type "${step.step}".`;
                        console.warn(observation);
                }

                this.conversationHistory.push({ role: 'developer', content: JSON.stringify({ step: 'OBSERVE', content: observation }) });
                if (!shouldContinue) break;
            }

            if (!shouldContinue) break;
        }

        if (safety >= maxIterations) {
            console.warn('Reached max iterations, ending workflow.');
        }

        // Final fallback check
        const shouldFallback = FALLBACK_POLICY === 'always' && !generateResult;
        if (shouldFallback) {
            console.log('Executing deterministic fallback...');
            try {
                if (!cloneResult) cloneResult = await clonerTools.cloneWebsite(initialRequest.split(' ').pop());
                if (cloneResult?.dir && !analysisResult) analysisResult = await clonerTools.analyzeWebsite(cloneResult.dir);
                if (cloneResult?.dir && analysisResult) generateResult = await clonerTools.generateNodeApp(cloneResult.dir, analysisResult);
            } catch (e) {
                console.error('Deterministic fallback failed:', e.message);
            }
        }

        console.log('\n🤖 Orchestrator workflow finished.');
        return generateResult?.appDir || (cloneResult?.dir ? `${cloneResult.dir}_app` : undefined);
    }
}

let orchestrator = null;
if (USE_GOOGLE && GEMINI_API_KEY) {
    orchestrator = new WorkflowOrchestrator(GEMINI_API_KEY);
} else {
    console.log('Google Gemini is disabled or API key is not set. Orchestrator will run in deterministic mode.');
    // A "dummy" orchestrator that can still run deterministically
    orchestrator = {
        initialize: async () => {},
        run: async (initialRequest) => {
            console.log('Running in deterministic-only mode.');
            const url = initialRequest.split(' ').pop();
            const cloneResult = await clonerTools.cloneWebsite(url);
            if (!cloneResult?.dir) throw new Error('Cloning failed in deterministic mode.');
            const analysisResult = await clonerTools.analyzeWebsite(cloneResult.dir);
            const generateResult = await clonerTools.generateNodeApp(cloneResult.dir, analysisResult);
            return generateResult?.appDir;
        }
    };
}

export { orchestrator };
