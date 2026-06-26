---
name: "code-validation"
description: "Instructs agents on how to verify code correctness using tools, tsc syntax checks, and builds."
version: "1.0.0"
category: "Software Development"
tags: ["validation", "build", "tsc", "verification", "lint"]
status: "verified"
---
# Code Validation and Verification Skill

This skill instructs agents on how to verify the correctness of the code they write before completing a task.

## 1. Syntax Validation
If you write TypeScript or JavaScript code, it is your responsibility to ensure it is syntactically valid.
- The `write_file` tool automatically performs a basic syntax check using `tsc` when you write `.ts` or `.tsx` files.
- **Pay close attention to the result of `write_file`.** If the `status` contains `error` or `written_but_has_syntax_errors`, you MUST read the `error` output, understand what you did wrong (e.g., missing comma, invalid TS syntax, double-escaped quotes), and call `write_file` again to fix it.
- **Do NOT complete your task** if the file has syntax errors.

## 2. Project Build
When you have made structural changes, added dependencies, or modified core files, run a build command to ensure the project still compiles.
- Use `execute_command` with `npm run build` (or the equivalent build command defined in `package.json`).
- If the build fails, fix the errors before returning your final response.

## 3. Linter and Formatting
If the project uses ESLint or Prettier, you can use them to automatically fix syntax issues or identify bugs:
- `npm run lint`
- `npm run format`

## 4. Understanding vs Guessing
If your code relies on an API that throws type errors during the build or syntax check, **do not guess the correct signature**.
- Use the `read_file` tool to inspect the local `.d.ts` definitions.
- Or use `grep_search` to find how the API is used elsewhere in the codebase.
