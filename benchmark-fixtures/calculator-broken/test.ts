// Test file for calculator-broken
import { add, subtract } from './calculator.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message}`);
    failed++;
  }
}

assert(add(2, 3) === 5, 'add(2, 3) === 5');
assert(add(-1, 1) === 0, 'add(-1, 1) === 0');
assert(add(0, 0) === 0, 'add(0, 0) === 0');

assert(subtract(5, 3) === 2, 'subtract(5, 3) === 2');
assert(subtract(0, 5) === -5, 'subtract(0, 5) === -5');
assert(subtract(10, 10) === 0, 'subtract(10, 10) === 0');
assert(subtract(-5, -3) === -2, 'subtract(-5, -3) === -2');

console.log(`\nTests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;