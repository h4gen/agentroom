// Test-only Workers entry. Never deployed; faults exercise the real Room and R2 boundary.
import handler, { Room as ProductionRoom } from "../../apps/relay/src/index.ts";
export default handler;
export class Room extends ProductionRoom {
  constructor(ctx, env) {
    const fault = { mode: "" };
    const FILES = new Proxy(env.FILES, {
      get(target, name) {
        const value = target[name];
        if (typeof value !== "function") return value;
        return async (...args) => {
          if (name === fault.mode) throw new Error("Synthetic R2 failure");
          const result = await value.apply(target, args);
          if (name === "put" && fault.mode === "slow-put")
            await new Promise((resolve) => setTimeout(resolve, 600));
          return result;
        };
      },
    });
    super(ctx, { ...env, FILES });
    this.fault = fault;
  }
  setFault(mode) {
    this.fault.mode = mode;
  }
  runCleanup() {
    return this.alarm();
  }
}
