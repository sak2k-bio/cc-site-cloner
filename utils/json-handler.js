/**
 * Enhanced JSON Handler - Validates and fixes malformed JSON objects
 * with special handling for Unicode characters and workflow structure
 */

class JsonHandler {
    static isValidJson(jsonString) {
        try {
            JSON.parse(jsonString);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Properly escapes special characters in strings for JSON compatibility
     */
    static escapeSpecialChars(str) {
        if (typeof str !== 'string') return str;
        return str
            .replace(/\\/g, '\\\\')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\f/g, '\\f')
            .replace(/\b/g, '\\b')
            .replace(/"/g, '\\"');
    }

    /**
     * Internal: light sanitize (strip comments, trailing commas, normalize EOL)
     */
    static sanitize(jsonString) {
        return String(jsonString ?? '')
            .trim()
            .replace(/\r\n/g, '\n')
            .replace(/\/\/[^\n]*/g, '')
            .replace(/,\s*([\]\}])/g, '$1');
    }

    /**
     * Fixes malformed JSON with better Unicode handling and structure recovery
     */
    static fixMalformedJson(jsonString) {
        let cleaned = this.sanitize(jsonString);

        if (this.isValidJson(cleaned)) return cleaned;
        console.log('Detected malformed JSON. Attempting to fix...');

        // Attempt to balance braces/brackets for incomplete objects/arrays
        try {
            if (cleaned.startsWith('[')) {
                const openCount = (cleaned.match(/\[/g) || []).length;
                const closeCount = (cleaned.match(/\]/g) || []).length;
                if (openCount > closeCount) cleaned += ']'.repeat(openCount - closeCount);
            } else if (cleaned.startsWith('{')) {
                const openCount = (cleaned.match(/\{/g) || []).length;
                const closeCount = (cleaned.match(/\}/g) || []).length;
                if (openCount > closeCount) cleaned += '}'.repeat(openCount - closeCount);
            }
            if (this.isValidJson(cleaned)) {
                console.log('Successfully fixed JSON structure');
                return cleaned;
            }
        } catch { }

        // Try to extract the largest valid JSON portion from noisy text
        try {
            let jsonPart = cleaned;
            const marker = 'Invalid JSON step:';
            if (jsonPart.includes(marker)) jsonPart = jsonPart.split(marker)[1];

            let depth = 0;
            let inString = false;
            let escapeNext = false;
            let startIdx = -1;
            let endIdx = -1;

            for (let i = 0; i < jsonPart.length; i++) {
                const ch = jsonPart[i];

                if (escapeNext) { escapeNext = false; continue; }
                if (ch === '\\') { escapeNext = true; continue; }
                if (ch === '"') { inString = !inString; continue; }
                if (inString) continue;

                if (ch === '{' || ch === '[') {
                    if (depth === 0 && startIdx === -1) startIdx = i;
                    depth++;
                } else if (ch === '}' || ch === ']') {
                    depth--;
                    if (depth === 0) { endIdx = i + 1; break; }
                }
            }

            if (startIdx !== -1 && endIdx !== -1) {
                const candidate = jsonPart.slice(startIdx, endIdx);
                const extracted = this.sanitize(candidate);
                if (this.isValidJson(extracted)) {
                    console.log('Extracted valid JSON portion');
                    return extracted;
                }
            }
        } catch (e) {
            console.warn('Error during secondary JSON fix attempt:', e.message);
        }

        console.error('Could not automatically fix JSON. Returning original.');
        return jsonString;
    }

    static safeParse(jsonString, fix = true) {
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            if (!fix) return null;
            try {
                const fixed = this.fixMalformedJson(jsonString);
                return JSON.parse(fixed);
            } catch (fixError) {
                console.error('Failed to fix and parse JSON:', fixError.message);
                const snippet = String(jsonString ?? '').slice(0, 200);
                console.error('Problematic JSON snippet:', snippet + (String(jsonString ?? '').length > 200 ? '...' : ''));
                return null;
            }
        }
    }

    /**
     * Validates and processes a workflow step object
     */
    static validateWorkflowStep(step) {
        const stepObj = typeof step === 'string' ? this.safeParse(step) : step;
        if (!stepObj) {
            console.error('Invalid workflow step: Could not parse JSON');
            return null;
        }

        const requiredProps = ['step', 'content'];
        for (const prop of requiredProps) {
            if (!(prop in stepObj)) {
                console.error(`Invalid workflow step: Missing required property "${prop}"`);
                return null;
            }
        }

        if (stepObj.step === 'TOOL' || stepObj.step === 'OBSERVE') {
            if (!('tool_name' in stepObj)) {
                console.error('Invalid TOOL/OBSERVE step: Missing "tool_name" property');
                return null;
            }
        }

        return stepObj;
    }
}

export default JsonHandler;
