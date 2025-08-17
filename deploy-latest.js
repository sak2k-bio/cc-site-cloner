import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { spawn } from 'child_process';

function run(cmd, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
        child.on('error', reject);
    });
}

async function findLatestAppDir(baseDir) {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const appDirs = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.endsWith('_app')) continue;
        const full = path.join(baseDir, entry.name);
        // Prefer timestamp in name: <host>_<timestamp>_app
        const m = entry.name.match(/_(\d+)_app$/);
        let ts = 0;
        if (m) ts = Number(m[1]);
        if (!ts || Number.isNaN(ts)) {
            // Fallback to mtime
            const st = await fs.stat(full);
            ts = st.mtimeMs;
        }
        appDirs.push({ dir: full, ts });
    }
    if (appDirs.length === 0) return null;
    appDirs.sort((a, b) => b.ts - a.ts);
    return appDirs[0].dir;
}

async function findLatestCloneDir(baseDir) {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const clones = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.endsWith('_app')) continue; // skip app dirs
        const full = path.join(baseDir, entry.name);
        // Expect <host>_<timestamp>
        const m = entry.name.match(/_(\d+)$/);
        let ts = 0;
        if (m) ts = Number(m[1]);
        if (!ts || Number.isNaN(ts)) {
            const st = await fs.stat(full);
            ts = st.mtimeMs;
        }
        clones.push({ dir: full, ts });
    }
    if (clones.length === 0) return null;
    clones.sort((a, b) => b.ts - a.ts);
    return clones[0].dir;
}

async function ensureAppFromClone(cloneDir) {
    const appDir = `${cloneDir}_app`;
    if (!fss.existsSync(appDir)) {
        await fs.mkdir(appDir, { recursive: true });
    }
    const publicDir = path.join(appDir, 'public');
    if (!fss.existsSync(publicDir)) {
        await fs.cp(cloneDir, publicDir, { recursive: true });
    }

    const appJsContent = `const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000; // hardcoded per request

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  // Try to serve top-level index.html; fallback if it resides under assets/
  const primary = path.join(__dirname, 'public', 'index.html');
  const alt = path.join(__dirname, 'public', 'assets', 'index.html');
  res.sendFile(fs.existsSync(primary) ? primary : alt);
});

app.listen(port, () => {
  console.log('Server running at http://localhost:' + port);
});
`;

    // Always overwrite app.js to ensure latest fixes are applied
    await fs.writeFile(path.join(appDir, 'app.js'), appJsContent);

    const pkgPath = path.join(appDir, 'package.json');
    if (!fss.existsSync(pkgPath)) {
        const packageJson = {
            name: 'website-app',
            version: '1.0.0',
            description: 'Generated from cloned website',
            main: 'app.js',
            scripts: { start: 'node app.js' },
            dependencies: { express: '^4.18.2' }
        };
        await fs.writeFile(pkgPath, JSON.stringify(packageJson, null, 2));
    }
    return appDir;
}

async function main(preferredPath) {
    const clonesDir = path.join(process.cwd(), 'clones');
    if (!fss.existsSync(clonesDir)) {
        console.error(`No clones directory found at ${clonesDir}`);
        process.exit(1);
    }

    let selectedApp = null;

    // If a preferred path is provided, try to use it first
    if (preferredPath) {
        const p = path.resolve(preferredPath);
        if (fss.existsSync(p)) {
            if (p.endsWith('_app')) {
                selectedApp = p;
            } else {
                // Treat as a clone directory and ensure app exists
                selectedApp = await ensureAppFromClone(p);
            }
        } else {
            console.warn(`Preferred path not found: ${p}. Falling back to auto-discovery.`);
        }
    }

    if (!selectedApp) {
        // Prefer the most recent clone; create its app if needed.
        const latestClone = await findLatestCloneDir(clonesDir);
        if (!latestClone) {
            console.error('No clone directories found under clones/.');
            process.exit(1);
        }
        const appFromLatestClone = await ensureAppFromClone(latestClone);

        // Also consider existing *_app dirs in case they are newer than the clone's generated app
        const latestExistingApp = await findLatestAppDir(clonesDir);

        // Choose the most recently modified between the two
        selectedApp = appFromLatestClone;
        try {
            const stA = await fs.stat(appFromLatestClone);
            const stB = latestExistingApp ? await fs.stat(latestExistingApp) : null;
            if (stB && stB.mtimeMs > stA.mtimeMs) {
                selectedApp = latestExistingApp;
            }
        } catch {
            // ignore and use appFromLatestClone
        }
    }

    console.log(`📂 Using app directory: ${selectedApp}`);
    console.log('📦 Running npm install...');
    await run('npm', ['i'], { cwd: selectedApp });

    console.log('🚀 Starting app with npm start...');
    await run('npm', ['start'], { cwd: selectedApp });
}

// main().catch((err) => {
//     console.error('Deploy failed:', err.message);
//     process.exit(1);
// });

export { main };
