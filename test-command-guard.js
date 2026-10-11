import { validateCommand } from './dist/utils/command-guard.js';
const unsafeCommands = [
  'setx VAR value',
  '$env:PATH = "something"',
  'Set-Item env:PATH',
  'Set-Alias ls Get-ChildItem',
  'New-Alias ll Get-ChildItem',
  'Remove-Alias ls',
  'PATH="/new/path:$PATH"',
  'function test { echo hello }',
  'Set-Content file.txt content',
  'Add-Content file.txt content',
  'Out-File file.txt',
  'echo "test" > test.cmd',
  'cp script.ps1 backup.ps1',
  'mv tsconfig.json tsconfig.json.bak',
  'ren package.json package.json.backup',
  'del .env',
  'rm tsconfig.json',
  'erase .npmrc',
  'px',
  'npm install -g some-package'
];
const safeCommands = [
  'echo hello',
  'dir',
  'Get-ChildItem',
  'type file.txt',
  'npx tsc --noEmit',
  'node script.js'
];
console.log('Testing unsafe commands:');
let unsafePassed = 0;
for (const cmd of unsafeCommands) {
  const result = validateCommand(cmd);
  if (!result.allowed) {
    console.log('PASS:\t' + cmd);
    unsafePassed++;
  } else {
    console.log('FAIL:\t' + cmd + ' - ' + (result.reason || 'No reason'));
  }
}
console.log('\nTesting safe commands:');
let safePassed = 0;
for (const cmd of safeCommands) {
  const result = validateCommand(cmd);
  if (result.allowed) {
    console.log('PASS:\t' + cmd);
    safePassed++;
  } else {
    console.log('FAIL:\t' + cmd + ' - ' + (result.reason || 'No reason'));
  }
}
console.log('\nUnsafe: ' + unsafePassed + '/' + unsafeCommands.length + ' correctly blocked');
console.log('Safe: ' + safePassed + '/' + safeCommands.length + ' correctly allowed');