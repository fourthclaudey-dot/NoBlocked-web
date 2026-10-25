// Logger; dev builds mirror everything to the dev server.
import { devLog } from "./dev";

function make(level: "log" | "warn" | "error") {
    return (...args: any[]) => {
        console[level]("[NoBlocked]", ...args);
        if (__DEV__) devLog(level, args);
    };
}

export const log = { info: make("log"), warn: make("warn"), error: make("error") };
