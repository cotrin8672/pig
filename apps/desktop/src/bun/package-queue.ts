import { resolve } from "node:path";

// Only resource discovery/mutations share this queue. Search and chat execution do not.
// One queue per canonical profile, shared even by separately-created service instances.
const queues = new Map<string, Promise<void>>();
export function packageProfileKey(agentDir: string): string {
  const key = resolve(agentDir);
  return process.platform === "win32" ? key.toLowerCase() : key;
}
export function withPackageLock<T>(
  agentDir: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = packageProfileKey(agentDir);
  const result = (queues.get(key) ?? Promise.resolve()).then(work);
  const tail = result.then(
    () => {},
    () => {},
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return result;
}
