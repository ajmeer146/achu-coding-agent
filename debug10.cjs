const fs = require('fs');
const content = fs.readFileSync('src/agent.ts', 'utf8');
const idx = content.indexOf('case "start_app"');
console.log(content.slice(idx+1500, idx+1800));