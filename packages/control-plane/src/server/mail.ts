import type { Database } from "../db/database.js";
import { issueLoginToken } from "../auth/magiclink.js";

/** Sends one email. Returns true on acceptance by the provider. */
export type MailSender = (to: string, subject: string, text: string) => Promise<boolean>;

export interface MailSettings {
  resendApiKey?: string;
  /** e.g. "Smallcloud <signin@yourdomain.com>" — must be a verified Resend sender. */
  mailFrom?: string;
}

/**
 * Resend-backed sender (https://resend.com — free tier covers small teams).
 * Returns undefined when not configured; callers fall back to log delivery.
 */
export function createMailSender(
  settings: MailSettings,
  fetchImpl: typeof fetch = fetch,
): MailSender | undefined {
  const { resendApiKey, mailFrom } = settings;
  if (!resendApiKey || !mailFrom) return undefined;

  return async (to, subject, text) => {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: mailFrom, to, subject, text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}

export interface LinkDelivery {
  /** How the link reached (or should reach) the user. */
  via: "email" | "log";
  /** The full sign-in URL — present ONLY when it must be logged (not emailed). */
  url?: string;
}

/**
 * Issues a magic link and delivers it: by email when a sender is configured
 * and accepts the message, otherwise by returning the URL for the caller to
 * log. Email success deliberately withholds the URL so single-use tokens
 * stop appearing in logs once real delivery exists.
 */
export async function deliverLoginLink(
  db: Database,
  email: string,
  host: string,
  sender: MailSender | undefined,
): Promise<LinkDelivery> {
  const { rawToken } = issueLoginToken(db, email);
  const url = `https://${host}/_sc/auth?token=${rawToken}`;

  if (sender) {
    const sent = await sender(
      email,
      "Your Smallcloud sign-in link",
      `Click to sign in (valid 15 minutes, single use):\n\n${url}\n\nIf you didn't request this, ignore this email.`,
    );
    if (sent) return { via: "email" };
  }
  return { via: "log", url };
}
