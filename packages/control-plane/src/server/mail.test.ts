import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createMailSender, deliverLoginLink } from "./mail.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("createMailSender", () => {
  it("is undefined until fully configured", () => {
    expect(createMailSender({})).toBeUndefined();
    expect(createMailSender({ resendApiKey: "re_x" })).toBeUndefined();
    expect(createMailSender({ mailFrom: "a@b.c" })).toBeUndefined();
  });

  it("posts to resend with auth and reports acceptance", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const send = createMailSender(
      { resendApiKey: "re_test", mailFrom: "Smallcloud <s@x.y>" },
      fetchImpl as unknown as typeof fetch,
    )!;
    expect(await send("to@x.y", "subj", "body")).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "Smallcloud <s@x.y>", to: "to@x.y" });
  });

  it("reports failure on provider rejection or network error", async () => {
    const rejecting = createMailSender(
      { resendApiKey: "k", mailFrom: "f@x.y" },
      (async () => new Response("no", { status: 422 })) as typeof fetch,
    )!;
    expect(await rejecting("t@x.y", "s", "b")).toBe(false);

    const throwing = createMailSender(
      { resendApiKey: "k", mailFrom: "f@x.y" },
      (async () => {
        throw new Error("net down");
      }) as typeof fetch,
    )!;
    expect(await throwing("t@x.y", "s", "b")).toBe(false);
  });
});

describe("deliverLoginLink", () => {
  it("emails the link and withholds the URL from the caller", async () => {
    const sent: string[] = [];
    const delivery = await deliverLoginLink(db, "user@x.y", "sc-app.osita.ai", async (_to, _s, text) => {
      sent.push(text);
      return true;
    });
    expect(delivery.via).toBe("email");
    expect(delivery.url).toBeUndefined();
    expect(sent[0]).toContain("https://sc-app.osita.ai/_sc/auth?token=");
  });

  it("falls back to log delivery when unconfigured or when sending fails", async () => {
    const none = await deliverLoginLink(db, "user@x.y", "h.osita.ai", undefined);
    expect(none.via).toBe("log");
    expect(none.url).toContain("/_sc/auth?token=");

    const failed = await deliverLoginLink(db, "user@x.y", "h.osita.ai", async () => false);
    expect(failed.via).toBe("log");
    expect(failed.url).toContain("/_sc/auth?token=");
  });
});
