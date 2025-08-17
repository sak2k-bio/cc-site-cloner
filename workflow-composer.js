import { main as runDeployer } from './deploy-latest.js';
import { orchestrator } from './workflow-orchestrator.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

async function main() {
    console.log('🚀 Kicking off AI workflow...\n');

    try {
        // --- Step 1: Get User Input ---
        const defaultUrl = process.env.WEBSITE_URL || process.argv[2] || '';
        const rl = readline.createInterface({ input, output });
        const question = defaultUrl
            ? `Enter website URL to clone [default: ${defaultUrl}]: `
            : 'Enter website URL to clone: ';

        const answer = await rl.question(question);
        rl.close();

        const finalUrl = (answer || defaultUrl || '').trim();
        if (!finalUrl) {
            console.error('❌ No URL provided. Exiting.');
            process.exit(1);
        }
        console.log(`🌐 Target URL: ${finalUrl}`);

        // --- Step 2: Run Orchestrated Cloning and App Generation ---
        console.log('\n--- Running AI Orchestrator ---\n');

        await orchestrator.initialize();
        const initialRequest = `Clone the website ${finalUrl}, analyze its structure, and generate a runnable Node.js application.`;
        const appDir = await orchestrator.run(initialRequest);

        console.log(`\n--- Orchestration Complete ---\nApp directory resolved: ${appDir || '(could not be determined)'}\n`);

        if (!appDir) {
            console.warn('⚠️ App directory not found, skipping deployment.');
        } else {
            // --- Step 3: Deploy Application ---
            console.log('--- Deploying Application ---\n');
            await runDeployer(appDir);
            console.log('\n--- Deployment Complete ---');
        }

        console.log('\n✅ Workflow finished successfully.');

    } catch (error) {
        console.error('\n❌ Workflow failed:', error.message);
        process.exit(1);
    }
}

main();
