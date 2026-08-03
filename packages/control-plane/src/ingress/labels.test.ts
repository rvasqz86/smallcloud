import { describe, expect, it } from "vitest";
import { ingressLabels } from "./labels.js";

const CONFIG = { baseDomain: "osita.ai", authProxyOrigin: "http://10.0.1.1:7777" };

describe("ingressLabels", () => {
  it("routes the app host to the auth proxy, never to the app", () => {
    const labels = ingressLabels("todo", CONFIG);
    expect(labels["caddy_0"]).toBe("https://sc-todo.osita.ai");
    expect(labels["caddy_0.reverse_proxy"]).toBe("http://10.0.1.1:7777");
    expect(labels["smallcloud.app"]).toBe("todo");
    expect(Object.values(labels).some((v) => v.includes("upstreams"))).toBe(false);
  });

  it("rejects invalid app names", () => {
    expect(() => ingressLabels("Bad Name", CONFIG)).toThrow(/Invalid app name/);
  });
});
