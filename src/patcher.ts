// Method patches with undo. Several patches on one method stack; each unpatch removes only itself.
type After = (args: any[], ret: any, self: any) => any;
type Before = (args: any[], self: any) => any[] | void;
type Instead = (args: any[], orig: (...a: any[]) => any, self: any) => any;

interface Hooks { orig: Function; before: Before[]; after: After[]; instead: Instead[] }
const HOOKS = Symbol("nbHooks");

function hook(obj: any, name: string): Hooks {
    const current = obj[name];
    if (current?.[HOOKS]) return current[HOOKS];
    if (typeof current !== "function") throw new Error(`${name} is not a function`);
    const hooks: Hooks = { orig: current, before: [], after: [], instead: [] };
    const patched = function (this: any, ...args: any[]) {
        for (const b of hooks.before) args = b(args, this) ?? args;
        const call = (...a: any[]) => hooks.orig.apply(this, a);
        let ret = hooks.instead.length
            ? hooks.instead.reduceRight<(...a: any[]) => any>((next, fn) => (...a) => fn(a, next, this), call)(...args)
            : call(...args);
        for (const a of hooks.after) ret = a(args, ret, this);
        return ret;
    };
    (patched as any)[HOOKS] = hooks;
    Object.defineProperty(patched, "name", { value: current.name });
    Object.defineProperty(obj, name, { value: patched, configurable: true, writable: true, enumerable: Object.prototype.propertyIsEnumerable.call(obj, name) });
    return hooks;
}

function add<K extends "before" | "after" | "instead">(kind: K, obj: any, name: string, fn: Hooks[K][number]) {
    const hooks = hook(obj, name);
    (hooks[kind] as any[]).push(fn);
    return () => {
        const list = hooks[kind] as any[];
        const i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
        if (!hooks.before.length && !hooks.after.length && !hooks.instead.length && obj[name]?.[HOOKS] === hooks) {
            Object.defineProperty(obj, name, { value: hooks.orig, configurable: true, writable: true });
        }
    };
}

export const after = (obj: any, name: string, fn: After) => add("after", obj, name, fn);
export const before = (obj: any, name: string, fn: Before) => add("before", obj, name, fn);
export const instead = (obj: any, name: string, fn: Instead) => add("instead", obj, name, fn);
