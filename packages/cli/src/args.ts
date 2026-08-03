import { APP_NAME_MAX_LENGTH, isValidAppName } from "@smallcloud/shared";

export type CliCommand =
  | { kind: "deploy"; dir: string; name?: string; email?: string; allowEgress?: string[] }
  | { kind: "status"; name: string }
  | { kind: "logs"; name: string; tail: number }
  | { kind: "delete"; name: string }
  | { kind: "share"; name: string; role: "viewer" | "editor" }
  | { kind: "unshare"; name: string; email: string }
  | { kind: "list" }
  | { kind: "new"; dir: string; template: "static" | "node" | "kv" }
  | { kind: "backup" }
  | { kind: "audit"; tail: number }
  | { kind: "doctor" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseCli(argv: string[]): CliCommand {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  if (command === "deploy") {
    const cmd: {
      kind: "deploy";
      dir: string;
      name?: string;
      email?: string;
      allowEgress?: string[];
    } = { kind: "deploy", dir: "." };
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === "--name") {
        const value = rest[++i];
        if (!value) return { kind: "error", message: "--name requires a value" };
        cmd.name = value;
      } else if (arg === "--email") {
        const value = rest[++i];
        if (!value) return { kind: "error", message: "--email requires a value" };
        cmd.email = value;
      } else if (arg === "--allow-egress") {
        const value = rest[++i];
        if (!value) return { kind: "error", message: "--allow-egress requires host[,host…]" };
        cmd.allowEgress = value.split(",").map((h) => h.trim()).filter(Boolean);
      } else if (arg.startsWith("-")) {
        return { kind: "error", message: `Unknown flag: ${arg}` };
      } else {
        cmd.dir = arg;
      }
    }
    return cmd;
  }

  if (command === "status") {
    const name = rest[0];
    if (!name) return { kind: "error", message: "Usage: smallcloud status <app>" };
    return { kind: "status", name };
  }

  if (command === "logs") {
    const name = rest[0];
    if (!name || name.startsWith("-")) {
      return { kind: "error", message: "Usage: smallcloud logs <app> [--tail N]" };
    }
    let tail = 100;
    if (rest[1] === "--tail") {
      tail = Number(rest[2]);
      if (!Number.isInteger(tail) || tail <= 0) {
        return { kind: "error", message: "--tail requires a positive integer" };
      }
    }
    return { kind: "logs", name, tail };
  }

  if (command === "delete") {
    const name = rest[0];
    if (!name) return { kind: "error", message: "Usage: smallcloud delete <app>" };
    return { kind: "delete", name };
  }

  if (command === "share") {
    const name = rest[0];
    if (!name || name.startsWith("-")) {
      return { kind: "error", message: "Usage: smallcloud share <app> [--role viewer|editor]" };
    }
    let role: "viewer" | "editor" = "viewer";
    if (rest[1] === "--role") {
      if (rest[2] !== "viewer" && rest[2] !== "editor") {
        return { kind: "error", message: "--role must be viewer or editor" };
      }
      role = rest[2];
    }
    return { kind: "share", name, role };
  }

  if (command === "unshare") {
    const [name, email] = rest;
    if (!name || !email) {
      return { kind: "error", message: "Usage: smallcloud unshare <app> <email>" };
    }
    return { kind: "unshare", name, email };
  }

  if (command === "list") return { kind: "list" };
  if (command === "backup") return { kind: "backup" };

  if (command === "new") {
    const dir = rest[0];
    if (!dir || dir.startsWith("-")) {
      return { kind: "error", message: "Usage: smallcloud new <dir> [--template static|node|kv]" };
    }
    let template: "static" | "node" | "kv" = "node";
    if (rest[1] === "--template") {
      if (rest[2] !== "static" && rest[2] !== "node" && rest[2] !== "kv") {
        return { kind: "error", message: "--template must be static, node, or kv" };
      }
      template = rest[2];
    }
    return { kind: "new", dir, template };
  }
  if (command === "doctor") return { kind: "doctor" };

  if (command === "audit") {
    let tail = 50;
    if (rest[0] === "--tail") {
      tail = Number(rest[1]);
      if (!Number.isInteger(tail) || tail <= 0) {
        return { kind: "error", message: "--tail requires a positive integer" };
      }
    }
    return { kind: "audit", tail };
  }

  return { kind: "error", message: `Unknown command: ${command}` };
}

/** Derives a valid app name from a directory basename. */
export function sanitizeAppName(basename: string): string {
  const name = basename
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, APP_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
  if (!isValidAppName(name)) {
    throw new Error(
      `Cannot derive an app name from "${basename}" — pass one with --name (lowercase letters, digits, hyphens)`,
    );
  }
  return name;
}
