import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type StackKind = "static" | "node-web";

export interface Detection {
  kind: StackKind;
  /** Human-readable explanation of why this stack was chosen. */
  reason: string;
  /** node-web only: command that starts the app. */
  startCommand?: string;
  /** node-web only: build command to run before start, when the app has one. */
  buildCommand?: string;
}

export class DetectionError extends Error {}

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
}

/**
 * Classifies a source directory as a static site or a Node web app.
 * Anything else is rejected — Smallcloud v1 supports exactly these two stacks.
 */
export function detectStack(dir: string): Detection {
  if (!existsSync(dir)) {
    throw new DetectionError(`Directory does not exist: ${dir}`);
  }

  const packageJsonPath = join(dir, "package.json");
  const hasIndexHtml = existsSync(join(dir, "index.html"));

  if (!existsSync(packageJsonPath)) {
    if (hasIndexHtml) {
      return { kind: "static", reason: "index.html at root, no package.json" };
    }
    throw new DetectionError(
      "Unsupported app: no package.json and no index.html. " +
        "Smallcloud supports static sites (index.html) and Node web apps (package.json with a start script).",
    );
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    throw new DetectionError(`package.json exists but is not valid JSON: ${packageJsonPath}`);
  }

  const startScript = pkg.scripts?.["start"];
  const buildScript = pkg.scripts?.["build"];

  if (startScript) {
    const detection: Detection = {
      kind: "node-web",
      reason: `package.json has a start script ("${startScript}")`,
      startCommand: "npm run start",
    };
    if (buildScript) detection.buildCommand = "npm run build";
    return detection;
  }

  if (pkg.main) {
    const detection: Detection = {
      kind: "node-web",
      reason: `package.json has a main entrypoint ("${pkg.main}")`,
      startCommand: `node ${pkg.main}`,
    };
    if (buildScript) detection.buildCommand = "npm run build";
    return detection;
  }

  if (hasIndexHtml) {
    return {
      kind: "static",
      reason: "package.json has no start script or main entrypoint, but index.html is present",
    };
  }

  throw new DetectionError(
    "Ambiguous app: package.json has no start script and no main entrypoint, and there is no index.html. " +
      "Add a start script to deploy as a Node web app, or an index.html to deploy as a static site.",
  );
}
