declare const __DEV__: boolean;
declare const __DEV_HOST__: string;

// Tampermonkey grants (see tools/build.mjs). Absent when a grant is not available.
declare const GM_getValue: (<T>(key: string, fallback?: T) => T) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;
declare const GM_registerMenuCommand: ((name: string, fn: () => void) => unknown) | undefined;
