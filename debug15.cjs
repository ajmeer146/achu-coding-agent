const fs = require('fs');
const content = fs.readFileSync('src/agent.ts', 'utf8');
const idx = content.indexOf('case "browser_verify"');
const endIdx = content.indexOf('case "open_browser"', idx);
console.log(content.slice(idx, endIdx));