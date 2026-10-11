const fs = require('fs');
const content = fs.readFileSync('src/agent.ts', 'utf8');
const idx = content.indexOf('case "browser_verify"');
const endIdx = content.indexOf('case "open_browser"', idx);
console.log('Length:', endIdx - idx);
console.log('Last 50 chars:', JSON.stringify(content.slice(endIdx - 50, endIdx + 50)));