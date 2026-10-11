const fs = require('fs');
const content = fs.readFileSync('src/agent.ts', 'utf8');
const idx = content.indexOf('case "open_browser"');
console.log(content.slice(idx-200, idx+200));