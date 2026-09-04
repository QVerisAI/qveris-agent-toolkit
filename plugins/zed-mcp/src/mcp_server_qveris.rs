use schemars::JsonSchema;
use serde::Deserialize;
use std::env;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const CONTEXT_SERVER_ID: &str = "mcp-server-qveris";
const PACKAGE_NAME: &str = "@qverisai/mcp";
const PACKAGE_VERSION: &str = "0.14.1";
const SERVER_PATH: &str = "node_modules/@qverisai/mcp/dist/index.js";

#[derive(Debug, Deserialize, JsonSchema)]
struct QVerisContextServerSettings {
    /// QVeris API key. Create one at https://qveris.ai/account?page=api-keys
    qveris_api_key: String,
    /// Optional complete HTTP(S) API root for self-hosted or regional deployments.
    #[serde(default)]
    qveris_base_url: Option<String>,
}

struct QVerisMcpExtension;

impl zed::Extension for QVerisMcpExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let installed_version = zed::npm_package_installed_version(PACKAGE_NAME)?;
        if installed_version.as_deref() != Some(PACKAGE_VERSION) {
            zed::npm_install_package(PACKAGE_NAME, PACKAGE_VERSION)?;
        }

        let settings = ContextServerSettings::for_project(CONTEXT_SERVER_ID, project)?;
        let Some(settings) = settings.settings else {
            return Err("missing `qveris_api_key` setting; create a key at https://qveris.ai/account?page=api-keys".into());
        };
        let settings: QVerisContextServerSettings =
            serde_json::from_value(settings).map_err(|error| error.to_string())?;

        let api_key = settings.qveris_api_key.trim();
        if api_key.is_empty() {
            return Err("`qveris_api_key` cannot be empty; create a key at https://qveris.ai/account?page=api-keys".into());
        }

        let mut server_env = vec![("QVERIS_API_KEY".into(), api_key.into())];

        if let Some(base_url) = settings.qveris_base_url {
            let base_url = base_url.trim();
            if !base_url.is_empty() {
                server_env.push(("QVERIS_BASE_URL".into(), base_url.into()));
            }
        }

        let server_path = env::current_dir()
            .map_err(|error| error.to_string())?
            .join(SERVER_PATH)
            .to_string_lossy()
            .to_string();

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path],
            env: server_env,
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings = include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema =
            serde_json::to_string(&schemars::schema_for!(QVerisContextServerSettings))
                .map_err(|error| error.to_string())?;

        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(QVerisMcpExtension);
