import { describe, expect, it } from "vitest";
import { APP_NAME_MAX_LENGTH, appSubdomain, isValidAppName } from "./index.js";

describe("isValidAppName", () => {
  it("accepts simple names", () => {
    expect(isValidAppName("todo")).toBe(true);
    expect(isValidAppName("my-app-2")).toBe(true);
    expect(isValidAppName("a")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(isValidAppName("")).toBe(false);
    expect(isValidAppName("My-App")).toBe(false);
    expect(isValidAppName("-leading")).toBe(false);
    expect(isValidAppName("trailing-")).toBe(false);
    expect(isValidAppName("under_score")).toBe(false);
    expect(isValidAppName("a".repeat(APP_NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("appSubdomain", () => {
  it("prefixes and appends the base domain", () => {
    expect(appSubdomain("todo", "osita.ai")).toBe("sc-todo.osita.ai");
  });

  it("throws on invalid names", () => {
    expect(() => appSubdomain("Bad Name", "osita.ai")).toThrow(/Invalid app name/);
  });
});
