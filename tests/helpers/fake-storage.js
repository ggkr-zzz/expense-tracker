/**
 * An in-memory stand-in for window.localStorage.
 * Set `failReads = true`, or `failWrites = "quota" | "other"`, to imitate a browser that refuses.
 */
export function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    failReads: false,
    failWrites: false,
    getItem(key) {
      if (this.failReads) throw new Error("storage is blocked");
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (this.failWrites) {
        const error = new Error("write refused");
        if (this.failWrites === "quota") error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}
