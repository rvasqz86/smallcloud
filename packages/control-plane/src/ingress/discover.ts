import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Gateway IP of the network a proxy container sits on. A host process bound
 * to 0.0.0.0 is reachable from that container at this address. Read-only
 * inspection — production containers are never modified.
 */
export async function gatewayIpForProxy(
  proxyContainer = "coolify-proxy",
  network = "coolify",
): Promise<string> {
  const { stdout } = await exec("docker", [
    "inspect",
    proxyContainer,
    "--format",
    `{{(index .NetworkSettings.Networks "${network}").Gateway}}`,
  ]);
  const ip = stdout.trim();
  if (!ip || ip === "<no value>") {
    throw new Error(`Could not discover gateway for ${proxyContainer} on network ${network}`);
  }
  return ip;
}

/** IP of a container on a specific network — how the host reaches sandboxed apps. */
export async function containerIpOnNetwork(container: string, network: string): Promise<string> {
  const { stdout } = await exec("docker", [
    "inspect",
    container,
    "--format",
    `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
  ]);
  const ip = stdout.trim();
  if (!ip || ip === "<no value>") {
    throw new Error(`Container ${container} has no IP on network ${network}`);
  }
  return ip;
}
