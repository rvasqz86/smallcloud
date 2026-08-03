// The CLI shares its composition (constants, config file, deployer factory)
// with every other local client — the source of truth is control-plane.
export {
  APP_NETWORK,
  AUTH_PROXY_CONTAINER,
  AUTH_PROXY_NETWORKS,
  AUTH_PROXY_ORIGIN,
  DEFAULT_BASE_DOMAIN,
  dataDir,
  loadConfig,
  saveConfig,
  smallcloudHome,
  type LocalConfig as CliConfig,
} from "@smallcloud/control-plane";
