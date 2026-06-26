---
name: "typescript-best-practices"
description: "Guidelines for writing clean, valid TypeScript and avoiding common LLM syntax errors."
version: "1.0.0"
category: "Software Development"
tags: ["typescript", "syntax", "best-practices", "code-style"]
status: "verified"
---
# TypeScript Best Practices Skill

This skill provides mandatory guidelines for generating valid and clean TypeScript/JavaScript code, especially to avoid common errors made by LLM agents.

## 1. Avoid Invalid Conditional Syntax in Objects
Do NOT use the ternary operator (`?:`) incorrectly inside object definitions or parameter defaults. 
**Incorrect:**
```typescript
const config = {
  timeout: 5000 ?:, // INVALID SYNTAX
  retries?: 3       // INVALID SYNTAX (only valid in type interfaces, not object instances)
};
```
**Correct:**
```typescript
const config = {
  timeout: 5000,
  retries: 3
};
```
If you are writing a Type or Interface, `?` is valid:
```typescript
interface Config {
  timeout?: number;
}
```

## 2. String Escaping and Quotes
When generating strings, avoid double-escaping quotes unless absolutely necessary.
If you need to output a string containing quotes, use single quotes or template literals (backticks).
**Incorrect:**
```typescript
const str = "He said \"hello\""; // Prone to escaping bugs
```
**Correct:**
```typescript
const str = 'He said "hello"';
const str2 = `He said "hello"`;
```

## 3. Arrays and Nesting
Do NOT create unnecessarily nested arrays unless the API explicitly requires it.
**Incorrect:** `return [[{ name: 'cmd' }]];`
**Correct:** `return [{ name: 'cmd' }];`

## 4. Backticks in Template Literals
Ensure that template literals are closed properly and that variables are interpolated using `${var}`, not `$var$` or other incorrect syntax.
**Incorrect:** ``const url = `http://$host$`;``
**Correct:** ``const url = `http://${host}`;``

## 5. Type Imports
When importing types in a standard Node.js or browser environment, you can use `import type` to clarify your intent and prevent compilation errors if the file is purely for types.
```typescript
import type { Plugin, Hooks } from '../types/index.js';
```
