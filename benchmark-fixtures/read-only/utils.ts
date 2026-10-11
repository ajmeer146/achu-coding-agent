// Simple module for read-only analysis
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function calculateArea(width: number, height: number): number {
  return width * height;
}

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  multiply(a: number, b: number): number {
    return a * b;
  }
}