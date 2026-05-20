// React-friendly log bus. lib code calls log(tag, msg); page subscribes
// via subscribeToLogs and renders the panel from state. Independent of
// any DOM IDs (the Vite version wrote directly to a <pre>).

export type LogTag = 'mm' | 'stellar' | 'relayer' | 'ui' | 'ok' | 'err';
export interface LogEntry {
  id: number;
  tag: LogTag;
  msg: string;
  ts: number;
}

type Subscriber = (entry: LogEntry) => void;
let subscribers: Subscriber[] = [];
let nextId = 1;

export function log(tag: LogTag, ...parts: unknown[]) {
  const msg = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, ...parts);
  const entry: LogEntry = { id: nextId++, tag, msg, ts: Date.now() };
  for (const sub of subscribers) sub(entry);
}

export function subscribeToLogs(cb: Subscriber) {
  subscribers.push(cb);
  return () => {
    subscribers = subscribers.filter((s) => s !== cb);
  };
}
