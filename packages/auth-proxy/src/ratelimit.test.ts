import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./ratelimit.js";

describe("createRateLimiter", () => {
  it("allows a burst up to capacity, then blocks", () => {
    let t = 0;
    const limit = createRateLimiter({ capacity: 3, refillPerSec: 1, now: () => t });
    expect(limit("a")).toBe(true);
    expect(limit("a")).toBe(true);
    expect(limit("a")).toBe(true);
    expect(limit("a")).toBe(false);
  });

  it("refills over time", () => {
    let t = 0;
    const limit = createRateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
    limit("a");
    limit("a");
    expect(limit("a")).toBe(false);
    t = 1000;
    expect(limit("a")).toBe(true);
    expect(limit("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    let t = 0;
    const limit = createRateLimiter({ capacity: 1, refillPerSec: 1, now: () => t });
    expect(limit("a")).toBe(true);
    expect(limit("b")).toBe(true);
    expect(limit("a")).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers cloudflare, then first XFF hop, then socket", () => {
    expect(clientIp({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }, "3.3.3.3")).toBe("1.1.1.1");
    expect(clientIp({ "x-forwarded-for": "2.2.2.2, 9.9.9.9" }, "3.3.3.3")).toBe("2.2.2.2");
    expect(clientIp({}, "3.3.3.3")).toBe("3.3.3.3");
    expect(clientIp({}, undefined)).toBe("unknown");
  });
});
