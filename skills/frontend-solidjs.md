---
name: "frontend-solidjs"
description: "Guidelines and best practices for writing SolidJS components, reactivity, and JSX."
version: "1.0.0"
category: "Frontend Frameworks"
tags: ["solidjs", "frontend", "ui", "components", "reactivity", "jsx"]
status: "verified"
---
# Frontend Development with SolidJS Skill

This skill provides guidelines for writing UI components using SolidJS, which is the framework used by `@opentui/solid` and OpenCode UI.

## 1. Reactivity in SolidJS
SolidJS uses Signals for reactivity. Unlike React, components in SolidJS execute exactly once.
- Do NOT use `useState` or `useEffect` from React.
- **Correct:** Use `createSignal`, `createEffect`, and `createMemo`.

```tsx
import { createSignal, createEffect } from 'solid-js';

export function Counter() {
  const [count, setCount] = createSignal(0);

  createEffect(() => {
    console.log("Count is now", count());
  });

  return (
    <button onClick={() => setCount(c => c + 1)}>
      Clicks: {count()}
    </button>
  );
}
```

## 2. JSX Syntax
SolidJS uses JSX, but remember:
- Use `class` instead of `className`.
- Access signal values by calling them as functions (e.g., `count()`).
- Avoid destructuring props inside the component signature because it breaks reactivity. Use `props.myValue`.

## 3. Writing Clean TSX
Ensure that your `.tsx` files are well-formed and do not contain syntax errors.
- **Never** use syntax like `[[{...}]]` when returning arrays of elements.
- **Always** wrap multiple JSX elements in a Fragment `<> ... </>` or a parent container.

## 4. OpenTUI Components
If you are writing components for `@opentui/solid` or OpenCode, use standard HTML tags or the specific components provided by the OpenCode API.
- Do not hallucinate component names like `<OpenCodeSidebar />` unless you have explicitly seen them in the API definitions.
