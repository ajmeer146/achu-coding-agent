const fs = require('fs');
const content = fs.readFileSync('src/agent.ts', 'utf8');
const idx = content.indexOf('case "open_browser"');
const before = content.slice(idx-100, idx);
console.log(before);