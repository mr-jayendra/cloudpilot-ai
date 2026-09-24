import path from "path"

process.env.CLOUDPILOT_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.CLOUDPILOT_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CLOUDPILOT_DISABLE_MODELS_FETCH = "true"
