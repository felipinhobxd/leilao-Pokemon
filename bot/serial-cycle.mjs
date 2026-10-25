/** Every caller waits for the same in-flight cycle, including its opening. */
export function createSerialCycle(work) {
  let pending = null;
  return function run() {
    if (!pending) pending = Promise.resolve().then(work).finally(() => { pending = null; });
    return pending;
  };
}
