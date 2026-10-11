// Test what the test file's output string evaluates to
const output = `
Successfully edited C:\project\src\App.tsx.
Successfully created C:\project\src\components\Button.tsx.
Successfully created C:\project\src\pages\About.tsx.
Exit code: 0
VERIFICATION PASSED
`;

console.log('Output string:');
console.log(JSON.stringify(output));

const lines = output.split("\n");
console.log('\nLines:');
lines.forEach((line, i) => console.log(`[${i}] "${line}"`));

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
console.log('\nChanged:', changed);
changed.forEach((c, i) => console.log(`  [${i}] "${c}"`));
console.log('Includes App.tsx:', changed.includes('C:\\project\\src\\App.tsx'));