const output = `
Successfully edited C:\\project\\src\\App.tsx.
Successfully created C:\\project\\src\\components\\Button.tsx.
Successfully created C:\\project\\src\\pages\\About.tsx.
Exit code: 0
VERIFICATION PASSED
`;

function extractChangedFiles(output) {
  const changed = [];
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.includes("Successfully edited") || line.includes("Successfully created")) {
      const match = line.match(/(?:Successfully edited|Successfully created)\s+(.+?)(?:\.$|$)/);
      if (match) changed.push(match[1].trim());
    }
  }
  return [...new Set(changed)];
}

const changed = extractChangedFiles(output);
console.log('Changed:', changed);
console.log('Length:', changed.length);
changed.forEach((c, i) => console.log(`  [${i}] "${c}" (len=${c.length})`));
console.log('Includes App.tsx:', changed.includes('C:\\project\\src\\App.tsx'));
console.log('Includes Button.tsx:', changed.includes('C:\\project\\src\\components\\Button.tsx'));
console.log('Includes About.tsx:', changed.includes('C:\\project\\src\\pages\\About.tsx'));