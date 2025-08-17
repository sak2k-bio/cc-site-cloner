import 'dotenv/config';
import axios from 'axios';
import { load } from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import JsonHandler from './utils/json-handler.js';

const USE_GOOGLE = process.env.USE_GOOGLE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FALLBACK_POLICY = (process.env.FALLBACK_POLICY || 'last_resort').toLowerCase();

/* ========== NEW ANALYSIS TOOLS ========== */
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function executeCommand(cmd = '') {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) return reject(error);
            if (stderr) console.warn(`stderr: ${stderr}`);
            resolve(stdout);
        });
    });
}

function safeFilename(p) {
    return p.replace(/[:?#<>\\|*"]/g, '_');
}

async function downloadAsset(urlStr, outBaseDir, headers = {}) {
    try {
        const res = await axios.get(urlStr, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers
        });

        const u = new URL(urlStr);
        const rel = safeFilename(u.pathname.replace(/^\//, ''));
        const outPath = path.join(outBaseDir, rel || 'index.html');

        // Security check
        if (!path.resolve(outPath).startsWith(path.resolve(outBaseDir))) {
            throw new Error(`Path traversal attempt: ${urlStr}`);
        }

        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, res.data);
        return { ok: true, outPath, content: res.data, url: urlStr };
    } catch (e) {
        return { ok: false, url: urlStr, error: e.message };
    }
}

/* ========== ENHANCED CLONE FUNCTION ========== */
async function cloneWebsite(urlStr = '') {
    if (!urlStr) return 'No URL provided';
    let base;
    try {
        base = new URL(urlStr);
    } catch (e) {
        return `Invalid URL: ${urlStr}`;
    }

    const hostname = safeFilename(base.hostname);
    const outDir = path.join(process.cwd(), 'clones', `${hostname}_${Date.now()}`);
    const assetsDir = path.join(outDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    // Initial fetch with random UA
    const initialHeaders = {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Referer': base.origin
    };
    const { data: html } = await axios.get(urlStr, { responseType: 'text', headers: initialHeaders });
    const $ = load(html);

    // Capture all page assets
    const assetSet = new Set();
    const assetSelectors = {
        'link[href]': 'href',
        'script[src]': 'src',
        'img[src]': 'src',
        'img[srcset]': 'srcset',
        'source[src]': 'src',
        'audio[src]': 'src',
        'video[src]': 'src',
        'video[poster]': 'poster',
        'meta[content]': 'content',
        'object[data]': 'data'
    };

    for (const [selector, attr] of Object.entries(assetSelectors)) {
        $(selector).each((i, el) => {
            const value = $(el).attr(attr);
            if (!value) return;

            if (attr === 'srcset') {
                value.split(',').forEach(part => {
                    const url = part.trim().split(/\s+/)[0];
                    if (url) assetSet.add(new URL(url, base).href);
                });
            } else {
                try {
                    assetSet.add(new URL(value, base).href);
                } catch (e) {
                    console.warn(`Invalid URL: ${value}`);
                }
            }
        });
    }

    // Batch download with throttling
    const assetUrls = Array.from(assetSet);
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 1000;
    const downloadResults = [];
    const urlToLocal = {};

    for (let i = 0; i < assetUrls.length; i += BATCH_SIZE) {
        const batch = assetUrls.slice(i, i + BATCH_SIZE);
        const promises = batch.map(url => {
            const headers = {
                'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                'Referer': urlStr
            };
            return downloadAsset(url, assetsDir, headers);
        });

        const batchResults = await Promise.all(promises);
        downloadResults.push(...batchResults);
        await sleep(DELAY_BETWEEN_BATCHES);
    }

    // Process results
    downloadResults.forEach(r => {
        if (r.ok) {
            const rel = path.relative(outDir, r.outPath).split(path.sep).join('/');
            urlToLocal[r.url] = rel;
        } else {
            console.warn(`❌ Failed: ${r.url} - ${r.error}`);
        }
    });

    // Process CSS assets
    for (const [originalUrl, localPath] of Object.entries(urlToLocal)) {
        if (originalUrl.toLowerCase().endsWith('.css')) {
            try {
                const cssFullPath = path.join(outDir, localPath);
                const cssContentRaw = await fs.readFile(cssFullPath, 'utf8');
                let cssContent = cssContentRaw;

                const urlRegex = /url\((?:'|"|)([^'")]+)(?:'|"|)\)/g;
                let match;

                while ((match = urlRegex.exec(cssContentRaw)) !== null) {
                    const assetRef = match[1];
                    if (/^data:/.test(assetRef)) continue;

                    try {
                        const absoluteUrl = new URL(assetRef, originalUrl).href;
                        if (!urlToLocal[absoluteUrl]) {
                            const r2 = await downloadAsset(absoluteUrl, assetsDir);
                            if (r2.ok) {
                                const rel2 = path.relative(outDir, r2.outPath).split(path.sep).join('/');
                                urlToLocal[absoluteUrl] = rel2;
                            }
                        }
                    } catch (e) {
                        console.warn(`CSS URL error: ${assetRef}`);
                    }
                }

                cssContent = cssContentRaw.replace(urlRegex, (match, assetRef) => {
                    if (/^data:/.test(assetRef)) return match;
                    try {
                        const absoluteUrl = new URL(assetRef, originalUrl).href;
                        if (urlToLocal[absoluteUrl]) {
                            const relativeCssPath = path.relative(
                                path.dirname(cssFullPath),
                                path.join(outDir, urlToLocal[absoluteUrl])
                            ).split(path.sep).join('/');
                            return `url('${relativeCssPath}')`;
                        }
                    } catch (e) { }
                    return match;
                });

                if (cssContent !== cssContentRaw) {
                    await fs.writeFile(cssFullPath, cssContent, 'utf8');
                }
            } catch (e) {
                console.error(`CSS processing failed: ${e.message}`);
            }
        }
    }

    // Rewrite HTML references
    function mapAttr(selector, attr) {
        $(selector).each((i, el) => {
            const value = $(el).attr(attr);
            if (!value) return;

            try {
                if (attr === 'srcset') {
                    const newSrcset = value.split(',').map(part => {
                        const [url, ...descriptors] = part.trim().split(/\s+/);
                        const newUrl = urlToLocal[new URL(url, base).href] || url;
                        return [newUrl, ...descriptors].join(' ');
                    }).join(', ');
                    $(el).attr(attr, newSrcset);
                } else {
                    const resolvedUrl = new URL(value, base).href;
                    if (urlToLocal[resolvedUrl]) {
                        $(el).attr(attr, urlToLocal[resolvedUrl]);
                    } else if (['src', 'poster'].includes(attr)) {
                        const width = $(el).attr('width') || '400';
                        const height = $(el).attr('height') || '300';
                        $(el).attr('src', `https://placehold.co/${width}x${height}/EEE/31343C?text=Failed+to+Load`);
                    }
                }
            } catch (e) {
                // Invalid URL - skip
            }
        });
    }

    for (const [selector, attr] of Object.entries(assetSelectors)) {
        mapAttr(selector, attr);
    }

    // Save final HTML
    await fs.writeFile(path.join(outDir, 'index.html'), $.html(), 'utf8');

    return {
        status: 'success',
        message: `Cloned site to ${outDir}`,
        dir: outDir,
        assetsCount: Object.keys(urlToLocal).length,
        failedDownloads: downloadResults.filter(r => !r.ok).length
    };
}

/* ========== NEW ANALYSIS & APP GENERATION TOOLS ========== */
/**
 * Analyzes a cloned website directory and generates a report
 * @param {string} dirPath - Path to cloned directory
 * @returns {Promise<object>} Analysis report
 */
async function analyzeWebsite(dirPath) {
    try {
        const report = {
            htmlFiles: [],
            cssFiles: [],
            jsFiles: [],
            images: [],
            otherAssets: [],
            totalSize: 0,
            pageStructure: {}
        };

        // Recursive directory analysis
        async function analyzeDirectory(currentPath) {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relPath = path.relative(dirPath, fullPath);

                if (entry.isDirectory()) {
                    await analyzeDirectory(fullPath);
                } else {
                    const stats = await fs.stat(fullPath);
                    report.totalSize += stats.size;

                    const fileInfo = {
                        path: relPath,
                        size: stats.size,
                        type: path.extname(entry.name).toLowerCase()
                    };

                    switch (fileInfo.type) {
                        case '.html':
                            report.htmlFiles.push(fileInfo);
                            if (relPath === 'index.html') {
                                report.pageStructure = await analyzeHTML(fullPath);
                            }
                            break;
                        case '.css':
                            report.cssFiles.push(fileInfo);
                            break;
                        case '.js':
                            report.jsFiles.push(fileInfo);
                            break;
                        case '.jpg': case '.jpeg': case '.png': case '.gif': case '.svg': case '.webp':
                            report.images.push(fileInfo);
                            break;
                        default:
                            report.otherAssets.push(fileInfo);
                    }
                }
            }
        }

        // HTML structure analysis
        async function analyzeHTML(htmlPath) {
            try {
                const content = await fs.readFile(htmlPath, 'utf8');
                const $ = load(content);

                return {
                    title: $('title').text() || 'Untitled',
                    metaDescription: $('meta[name="description"]').attr('content') || '',
                    headingStructure: {
                        h1: $('h1').length,
                        h2: $('h2').length,
                        h3: $('h3').length
                    },
                    sections: $('body > *').map((i, el) => ({
                        tag: el.tagName,
                        class: $(el).attr('class') || '',
                        id: $(el).attr('id') || ''
                    })).get(),
                    links: {
                        internal: $('a[href^="/"], a[href^="./"], a[href^="../"]').length,
                        external: $('a[href^="http"]').length
                    },
                    scripts: $('script').length,
                    stylesheets: $('link[rel="stylesheet"]').length,
                    images: $('img').length
                };
            } catch (e) {
                return { error: `HTML analysis failed: ${e.message}` };
            }
        }

        await analyzeDirectory(dirPath);
        return report;
    } catch (e) {
        return { error: `Analysis failed: ${e.message}` };
    }
}

/**
 * Generates a Node.js app from cloned website
 * @param {string} clonedDir - Path to cloned website
 * @param {object} analysis - Analysis report
 * @returns {Promise<string>} Success message
 */
async function generateNodeApp(clonedDir, analysis) {
    try {
        const appDir = `${clonedDir}_app`;
        await fs.mkdir(appDir, { recursive: true });

        // Create Express server
        const appJsContent = `const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ${analysis.pageStructure.title} routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Additional routes based on analysis
${analysis.htmlFiles.filter(f => f.path !== 'index.html').map(file => {
            const routePath = file.path.replace('.html', '').replace(/\\/g, '/');
            return `app.get('/${routePath}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', '${file.path}'));
});`;
        }).join('\n')}

// Start server
app.listen(port, () => {
    console.log(\`Server running at http://localhost:\${port}\`);
    console.log(\`Serving ${analysis.htmlFiles.length} HTML files\`);
});`;

        // Create package.json
        const packageJson = {
            name: "website-app",
            version: "1.0.0",
            description: "Generated from cloned website",
            main: "app.js",
            scripts: {
                start: "node app.js"
            },
            dependencies: {
                express: "^4.18.2"
            }
        };

        // Copy website to public folder
        const publicDir = path.join(appDir, 'public');
        await fs.cp(clonedDir, publicDir, { recursive: true });
        await fs.writeFile(path.join(appDir, 'app.js'), appJsContent);
        await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify(packageJson, null, 2));

        // Create analysis report
        await fs.writeFile(
            path.join(appDir, 'ANALYSIS_REPORT.md'),
            `# Website Analysis Report\n\n` +
            `## Summary\n` +
            `- **Pages**: ${analysis.htmlFiles.length}\n` +
            `- **Assets**: ${analysis.cssFiles.length + analysis.jsFiles.length + analysis.images.length}\n` +
            `- **Total Size**: ${(analysis.totalSize / 1024 / 1024).toFixed(2)} MB\n\n` +
            `## Structure\n` +
            `- **Title**: ${analysis.pageStructure.title}\n` +
            `- **Sections**: ${analysis.pageStructure.sections.length}\n` +
            `- **Headings**: H1(${analysis.pageStructure.headingStructure.h1}) ` +
            `H2(${analysis.pageStructure.headingStructure.h2}) ` +
            `H3(${analysis.pageStructure.headingStructure.h3})\n`
        );

        return {
            status: 'success',
            message: `Node app generated in ${appDir}`,
            appDir,
            nextSteps: [
                `cd ${appDir}`,
                'npm install',
                'npm start',
                `Open http://localhost:3000`
            ]
        };
    } catch (e) {
        return { error: `App generation failed: ${e.message}` };
    }
}

/* ========== EXPORT TOOLS ========== */
export {
    executeCommand,
    cloneWebsite,
    analyzeWebsite,
    generateNodeApp,
};