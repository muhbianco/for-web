/** JSON lines on stdout. Never pass tokens, coordinates history or message bodies. */
export interface Log {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export const jsonLog: Log = {
  info: (msg, extra) => console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), msg, ...extra })),
  warn: (msg, extra) => console.log(JSON.stringify({ level: "warn", ts: new Date().toISOString(), msg, ...extra })),
  error: (msg, extra) => console.log(JSON.stringify({ level: "error", ts: new Date().toISOString(), msg, ...extra })),
};

export const silentLog: Log = { info: () => {}, warn: () => {}, error: () => {} };
