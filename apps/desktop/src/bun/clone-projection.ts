import { isProxy } from "node:util/types";

const nativeClone = Symbol("native-clone");

/** Copy mutable JSON containers, not megabytes of immutable strings. Rich or
 * unusually deep/wide SDK values still use the native structured clone. */
export function cloneProjection<T>(value: T): T {
  const seen = new Map<object, object>();
  let remaining = 1024;
  const copy = <U>(input: U, depth: number): U => {
    if (typeof input === "function" || typeof input === "symbol")
      throw nativeClone;
    if (input === null || typeof input !== "object") return input;
    const previous = seen.get(input);
    if (previous) return previous as U;
    if (depth > 64 || --remaining < 0 || isProxy(input)) throw nativeClone;
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw nativeClone;
    const keys = Object.keys(input);
    if (keys.length > 256) throw nativeClone;
    const result = array ? new Array(input.length) : {};
    seen.set(input, result);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      // Never invoke a getter and then invoke it again during native fallback.
      if (!descriptor || !("value" in descriptor)) throw nativeClone;
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result as U;
  };
  try {
    return copy(value, 0);
  } catch (error) {
    if (error !== nativeClone) throw error;
    return structuredClone(value);
  }
}
