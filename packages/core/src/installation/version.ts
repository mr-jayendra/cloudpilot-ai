declare global {
  const CLOUDPILOT_VERSION: string
  const CLOUDPILOT_CHANNEL: string
}

export const InstallationVersion = typeof CLOUDPILOT_VERSION === "string" ? CLOUDPILOT_VERSION : "local"
export const InstallationChannel = typeof CLOUDPILOT_CHANNEL === "string" ? CLOUDPILOT_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
