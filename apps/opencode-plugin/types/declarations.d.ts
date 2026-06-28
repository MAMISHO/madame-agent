/* ------------------------------------------------------------------ */
/*  Ambient declarations for @opentui/* (provided by OpenCode host)   */
/* ------------------------------------------------------------------ */

declare module "@opentui/solid" {
  import type { JSX as SolidJSX } from "solid-js/jsx-runtime";

  export type JSX = SolidJSX;

  export type SolidPlugin<Slots extends Record<string, object>, Ctx> = {
    slots: {
      [K in keyof Slots]?: (props: Slots[K]) => JSX.Element;
    };
  };
}

declare module "@opentui/solid/jsx-runtime" {
  export { Fragment, jsx, jsxs, jsxDEV } from "solid-js/jsx-runtime";
  export type { JSX } from "solid-js/jsx-runtime";
}

declare module "@opentui/core" {
  export type CliRenderer = {
    print: (text: string) => void;
  };
  export type SlotMode = string;
  export type RGBA = string;
  export type ParsedKey = {
    key: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
  };
}
