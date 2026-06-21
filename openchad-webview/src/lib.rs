use std::{
    borrow::Cow,
    env,
    fs,
    path::{Path, PathBuf},
};

use pyo3::{
    exceptions::PyValueError,
    prelude::*,
    types::{PyDict, PyTuple},
};
use pyo3_utils::{
    from_py_dict::{derive_from_py_dict, FromPyDict as _, NotRequired},
    serde::PySerde,
};
use pytauri_core::{tauri_runtime::Runtime, utils::TauriError};
use tauri_plugin_prevent_default::Flags;
use tauri::{
    image::Image,
    ipc::RuntimeCapability,
    utils::{
        self as tauri_utils,
        acl::{
            build::parse_capabilities,
            capability::{Capability, CapabilityFile},
        },
        assets::{AssetKey, AssetsIter, CspHash},
        config::{CapabilityEntry, FrontendDist},
        platform::Target,
    },
    AppHandle, Assets, Config, Manager,
    PhysicalPosition, PhysicalSize,
    WebviewBuilder, WebviewUrl,
};

type TauriContext = tauri::Context<Runtime>;

const CAPABILITIES_FOLDER: &str = "capabilities";

pub fn tauri_generate_context() -> TauriContext {
    tauri::generate_context!()
}

/// A simple `Assets` implementation that reads files from disk directory.
struct DirAssets(PathBuf);

impl Assets<Runtime> for DirAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        // > refer to [tauri_utils::assets::AssetKey]
        // >
        // > - Has a root directory
        //
        // So we need to skip the first character (i.e., `/`) of the key.
        let path = self.0.join(&key.as_ref()[1..]);

        // TODO: return `None` only when not found, log::error!() in other cases
        fs::read(&path).ok().map(Cow::Owned)
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        unimplemented!()
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        todo!("use `walkdir` crate to implement this")
    }
}

/// [CapabilityFile] does not implement [RuntimeCapability], so we need to wrap it.
struct RuntimeCapabilityFile(CapabilityFile);

impl RuntimeCapability for RuntimeCapabilityFile {
    fn build(self) -> CapabilityFile {
        self.0
    }
}

/// ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L508-L522>
fn find_icon(
    config: &Config,
    config_parent: &Path,
    predicate: impl Fn(&&String) -> bool,
    default: &str,
) -> Option<FactoryResult<Image<'static>>> {
    let icon_path = config.bundle.icon.iter().find(predicate);

    // if user specifies a icon, we will load it whether it exists or not.
    if let Some(icon_path) = icon_path {
        let icon_path = config_parent.join(icon_path); // in case of relative path
        let icon = Image::from_path(&icon_path).map_err(|cause| {
            let err = PyValueError::new_err(format!(
                "Failed to load specific icon at {}",
                icon_path.display()
            ));
            (err, cause).into()
        });
        return Some(icon);
    }

    let icon_path = config_parent.join(default);
    if icon_path.exists() {
        let icon = Image::from_path(&icon_path).map_err(|cause| {
            let err = PyValueError::new_err(format!(
                "Failed to load default icon at {}",
                icon_path.display()
            ));
            (err, cause).into()
        });
        return Some(icon);
    }

    None
}

/// ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L211-L244>
fn load_default_window_icon(
    config: &Config,
    config_parent: &Path,
    target: Target,
) -> Option<FactoryResult<Image<'static>>> {
    match target {
        Target::Windows => {
            // handle default window icons for Windows targets
            find_icon(
                config,
                config_parent,
                |i| i.ends_with(".ico"),
                "icons/icon.ico",
            )
            .or_else(|| {
                find_icon(
                    config,
                    config_parent,
                    |i| i.ends_with(".png"),
                    "icons/icon.png",
                )
            })
        }
        _ => {
            // handle default window icons for Unix targets
            find_icon(
                config,
                config_parent,
                |i| i.ends_with(".png"),
                "icons/icon.png",
            )
        }
    }
}

#[derive(Default)]
struct ContextFactoryKwargs {
    // TODO: use `pytauri::ext_mod::ConfigFrom` (`tauri::Config`) as the type
    tauri_config: NotRequired<Option<PySerde<serde_json::Value>>>,
}

derive_from_py_dict!(ContextFactoryKwargs {
    #[pyo3(default)]
    tauri_config,
});

impl ContextFactoryKwargs {
    fn from_kwargs(kwargs: Option<&Bound<'_, PyDict>>) -> PyResult<Option<Self>> {
        kwargs.map(Self::from_py_dict).transpose()
    }
}

/// `def context_factory(src_tauri_dir: Path, /, **ContextFactoryKwargs) -> tauri.Context:`
///
/// - `src_tauri_dir` should be absolute path.
//
// TODO: better error handling
pub fn context_factory(
    args: &Bound<'_, PyTuple>,
    kwargs: Option<&Bound<'_, PyDict>>,
) -> PyResult<TauriContext> {
    let py = args.py();
    // TODO, PERF: avoid cloning the `PathBuf` data.
    let (src_tauri_dir,): (PathBuf,) = args.extract()?;

    let ContextFactoryKwargs { tauri_config } =
        ContextFactoryKwargs::from_kwargs(kwargs)?.unwrap_or_default();
    let tauri_config = tauri_config.0.unwrap_or_default();

    let result: FactoryResult<TauriContext> = py.allow_threads(move || {
        let mut ctx = tauri_generate_context();
        let target = Target::current();

        // Load config from file dynamically.
        // TODO: unify the error type
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/lib.rs#L57-L99>
        let mut config = tauri_utils::config::parse::read_from(target, &src_tauri_dir)
            .map_err(|e| PyValueError::new_err(format!("Failed to read tauri config: {e}")))?
            .0;
        if let Some(tauri_config) = tauri_config {
            json_patch::merge(&mut config, &tauri_config.into_inner());
        }
        let config: Config = serde_json::from_value(config).map_err(|e| {
            PyValueError::new_err(format!("Failed to serialize merged tauri config: {e}"))
        })?;
        // NOTE: modify the `config` field first, because following code will use it.
        *ctx.config_mut() = config;

        // Patch `package_info` from `config`.
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L268-L287>
        if let Some(product_name) = &ctx.config().product_name {
            ctx.package_info_mut().name = product_name.clone();
        }
        if let Some(version) = &ctx.config().version {
            ctx.package_info_mut().version = version.parse().unwrap();
        }

        // Supply custom Assets from disk dynamically.
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L176-L207>
        if let Some(frontend_dist) = &ctx.config().build.frontend_dist {
            match frontend_dist {
                FrontendDist::Url(_) => {
                    // do nothing, we don't need supply custom Assets for URL frontend_dist,
                    // because tauri will fetch the frontend from the URL.
                }
                FrontendDist::Directory(dir) => {
                    let abs_assert_dir = if dir.is_relative() {
                        src_tauri_dir.join(dir)
                    } else {
                        dir.clone()
                    };
                    ctx.set_assets(Box::new(DirAssets(abs_assert_dir)));
                }
                FrontendDist::Files(_) => {
                    return Err(
                        PyValueError::new_err("frontend_dist: Files is not supported yet").into(),
                    );
                }
                unknown => unimplemented!("unimplemented frontend_dist type: {:?}", unknown),
            }
        }

        // Load capabilities from disk dynamically.
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-build/src/acl.rs#L402-L407>
        let capabilities_pattern_path = src_tauri_dir
            // i.e., `cpabilities/**/*`
            .join(format!("{CAPABILITIES_FOLDER}/**/*"));
        let capabilities_pattern = capabilities_pattern_path.to_str().ok_or_else(|| {
            PyValueError::new_err(format!(
                "`{}` is not is valid unicode",
                capabilities_pattern_path.display()
            ))
        })?;
        let mut capabilities_from_files = parse_capabilities(capabilities_pattern)
            // TODO: unify the error type
            .map_err(|e| {
                PyValueError::new_err(format!("Failed to parse capabilities files: {e}"))
            })?;

        // Patch `capabilities` from `config`.
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L388-L416>
        //      <https://tauri.app/security/capabilities/>
        let capabilities: Vec<Capability> = if ctx.config().app.security.capabilities.is_empty() {
            capabilities_from_files.into_values().collect()
        } else {
            let mut capabilities = Vec::new();
            for capability_entry in &ctx.config().app.security.capabilities {
                match capability_entry {
                    CapabilityEntry::Inlined(capability) => {
                        capabilities.push(capability.clone());
                    }
                    CapabilityEntry::Reference(id) => {
                        let capability = capabilities_from_files.remove(id).ok_or_else(|| {
                            PyValueError::new_err(format!(
                                "capability with identifier {id} not found"
                            ))
                        })?;
                        capabilities.push(capability);
                    }
                }
            }
            capabilities
        };

        // Add capabilities to `ctx`.
        // TODO, FIXME: `runtime_authority_mut` currently is not public API,
        // see: <https://github.com/tauri-apps/tauri/issues/12968>
        ctx.runtime_authority_mut()
            .add_capability(RuntimeCapabilityFile(CapabilityFile::List(capabilities)))
            .map_err(|cause| (PyValueError::new_err("Failed to add capability"), cause))?;

        // Set default window icon.
        let default_window_icon = load_default_window_icon(ctx.config(), &src_tauri_dir, target);
        // NOTE: Even if `default_window_icon` is `None`, we should not call `set_default_window_icon(default_window_icon)`,
        // because we have bundled the `tauri-app` icon by default, and setting it to `None` will remove it.
        if let Some(icon) = default_window_icon {
            let icon = icon?;
            ctx.set_default_window_icon(Some(icon));
        }

        // Set tray icon.
        // ref: <https://github.com/tauri-apps/tauri/blob/339a075e33292dab67766d56a8b988e46640f490/crates/tauri-codegen/src/context.rs#L289-L299>
        if target.is_desktop() {
            if let Some(tray) = &ctx.config().app.tray_icon {
                let tray_icon_path = src_tauri_dir.join(&tray.icon_path);
                let icon = Image::from_path(&tray_icon_path).map_err(|cause| {
                    let err = PyValueError::new_err(format!(
                        "Failed to load tray icon at {}",
                        tray_icon_path.display()
                    ));
                    (err, cause)
                })?;
                ctx.set_tray_icon(Some(icon));
            }
        }

        // TODO: `Context::app_icon`, `Context::plugin_global_api_scripts`

        Ok(ctx)
    });

    result.map_err(|err| err.into_py_err(py))
}

/// `def builder_factory() -> tauri.Builder:`
pub fn builder_factory(
    _args: &Bound<'_, PyTuple>,
    _kwargs: Option<&Bound<'_, PyDict>>,
) -> PyResult<tauri::Builder<Runtime>> {
    let prevent_plugin = tauri_plugin_prevent_default::Builder::new()
    .with_flags(Flags::RELOAD)
    .build();

    Ok(tauri::Builder::default()
        .plugin(prevent_plugin)
        .on_page_load(|webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            // injection.js is embedded at compile time and runs first,
            // then the inline Tauri event-bridge script runs after it.
            static INJECTION_JS: &str = include_str!("scripts/injection.js");

            let script = format!(
                "{}\n{}",
                INJECTION_JS,
                r#"(async () => {
                    const _emitLocation = async (url) => {
                        const label = await window.__TAURI__.webview.getCurrentWebview().label;
                        await window.__TAURI__.event.emit('update_location', {
                            target: label,
                            url
                        });
                    };

                    const _emitFocus = async () => {
                        const label = await window.__TAURI__.webview.getCurrentWebview().label;
                        await window.__TAURI__.event.emit('focus', {
                            target: label,
                        });
                    };

                    const _emitPageLoaded = async () => {
                        const label = await window.__TAURI__.webview.getCurrentWebview().label;
                        await window.__TAURI__.event.emit('page_loaded', {
                            target: label
                        });
                    };

                    const _emitUpdateLocationTitleIcon = async (url) => {
                        const label = await window.__TAURI__.webview.getCurrentWebview().label;
                        const getIconBase64 = async () => {
                            try {
                                const iconUrl = `${location.origin}/favicon.ico`;
                                const res = await fetch(iconUrl);
                                if (!res.ok) return 'default';
                                const blob = await res.blob();
                                if (!blob.size) return 'default';
                                return await new Promise((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result);
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });
                            } catch {
                                return 'default';
                            }
                        };
                        await window.__TAURI__.event.emit('update_location_title_icon', {
                            target: label,
                            title: window.document.title,
                            icon: await getIconBase64(),
                            url
                        });
                    };

                    await _emitLocation(window.location.href);
                    await _emitUpdateLocationTitleIcon(window.location.href);
                    await _emitPageLoaded();

                    if (!window.__listenToLocationChange) {
                        window.__listenToLocationChange = true;
                        let lastHref = window.location.href;
                        let lastTitle = document.title;

                        if (window.navigation) {
                            window.navigation.addEventListener('navigate', async (event) => {
                                if (event.destination.sameDocument) {
                                    await _emitLocation(event.destination.url);
                                }
                            });
                        }

                        setInterval(async () => {
                            const currentHref = window.location.href;
                            const currentTitle = document.title;
                            if (currentHref !== lastHref || currentTitle !== lastTitle) {
                                lastHref = currentHref;
                                lastTitle = currentTitle;

                                try {
                                    await _emitUpdateLocationTitleIcon(currentHref);
                                } catch (error) {
                                    console.error("Error emitting location change:", error);
                                }
                            }
                        }, 1000);
                    }

                    if (!window.__listenToKeyDown) {
                        window.__listenToKeyDown = true;
                        window.addEventListener('pointerdown', async (event) => {
                            await _emitFocus();
                        });
                        window.addEventListener('keydown', async (event) => {
                            const label = await window.__TAURI__.webview.getCurrentWebview().label;

                            if (event.ctrlKey && event.key === 'w') {
                                event.preventDefault();
                                await window.__TAURI__.event.emit('delete_tab', { target: label });
                            }

                            if (event.ctrlKey && event.key === 't') {
                                event.preventDefault();
                                await window.__TAURI__.event.emit('create_task', { target: label });
                            }


                            if (event.ctrlKey && event.key >= '1' && event.key <= '9') {
                                event.preventDefault();
                                const n = parseInt(event.key);
                                const tab_index = n === 9 ? -1 : n - 1;
                                await window.__TAURI__.event.emit('switch_tab', { target: label, tab_index });
                            }
                        });
                    }

                    if (!window.AsyncLock) {
                        class AsyncMutex {
                            constructor() {
                                this._locked = false;
                                this._queue = [];
                            }
                            acquire() {
                                return new Promise(resolve => {
                                    if (!this._locked) {
                                        this._locked = true;
                                        resolve();
                                    } else {
                                        this._queue.push(resolve);
                                    }
                                });
                            }
                            release() {
                                const next = this._queue.shift();
                                if (next) next();
                                else this._locked = false;
                            }
                            async run(fn) {
                                await this.acquire();
                                try { return await fn(); }
                                finally { this.release(); }
                            }
                        }
                        window.AsyncLock = new AsyncMutex();
                    }
                })();"#
            );
            if let Err(e) = webview.eval(&script) {
                eprintln!("❌ script inject failed: {}", e);
            }
        })
        .invoke_handler(tauri::generate_handler![
            eval_in_webview,
            create_webview
        ]))
}
#[tauri::command]
fn eval_in_webview(app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.eval(&script).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWebviewArgs {
    parent_label: String,
    label: String,
    url: Option<String>,
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
    incognito: Option<bool>,
    user_agent: Option<String>,
}

#[tauri::command]
async fn create_webview(
    app: AppHandle,
    args: CreateWebviewArgs,
) -> Result<(), String> {
    let url_str = args.url.as_deref().unwrap_or("about:blank");

    let parent_window = app
        .get_window(&args.parent_label)
        .ok_or_else(|| format!("parent window '{}' not found", args.parent_label))?;

    let webview_url = url_str
        .parse::<url::Url>()
        .map(WebviewUrl::External)
        .unwrap_or_else(|_| WebviewUrl::App("index.html".into()));

    let mut builder = WebviewBuilder::new(&args.label, webview_url);
    let label = if args.label.starts_with("webview-agent-") { &args.label } else { "shared" };

    #[cfg(target_os = "windows")]
    let ext_path: Option<PathBuf> = env::var_os("OPENCHAD_EXTENSION_PATH")
        .map(PathBuf::from);

    {
        let data_dir: PathBuf = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("browser-data")
            .join(label);

        builder = builder.data_directory(data_dir);

        #[cfg(target_os = "windows")]
        if let Some(path) = ext_path {
            builder = builder
                .browser_extensions_enabled(true)
                .extensions_path(path);
        }
    }

    #[cfg(target_os = "macos")]
    {
        // data_store_identifier is the official replacement for data_directory
        // on WKWebView. Requires macOS ≥ 14; silently does nothing on older.
        builder = builder.data_store_identifier(label_to_store_id(label));
    }

    if let Some(ua) = &args.user_agent {
        builder = builder.user_agent(ua);
    }
    if args.incognito.unwrap_or(false) {
        builder = builder.incognito(true);
    }

    parent_window
        .add_child(
            builder,
            PhysicalPosition::new(args.x.unwrap_or(0), args.y.unwrap_or(0)),
            PhysicalSize::new(args.width.unwrap_or(800), args.height.unwrap_or(600)),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn label_to_store_id(label: &str) -> [u8; 16] {
    const FNV_PRIME: u64 = 0x00000100000001B3;
    const SEED_A: u64 = 0xcbf29ce484222325;
    const SEED_B: u64 = 0x14650fb0739d0383;
    let mut a = SEED_A;
    let mut b = SEED_B;

    for byte in label.bytes() {
        a ^= byte as u64;
        a = a.wrapping_mul(FNV_PRIME);
        b ^= byte.wrapping_add(0x5A) as u64;
        b = b.wrapping_mul(FNV_PRIME);
    }

    let mut id = [0u8; 16];
    id[..8].copy_from_slice(&a.to_le_bytes());
    id[8..].copy_from_slice(&b.to_le_bytes());
    id
}

enum FactoryError {
    PyErr(PyErr),
    /// (err, cause)
    TauriError(PyErr, tauri::Error),
}

type FactoryResult<T> = Result<T, FactoryError>;

impl From<PyErr> for FactoryError {
    fn from(err: PyErr) -> Self {
        FactoryError::PyErr(err)
    }
}

impl From<(PyErr, tauri::Error)> for FactoryError {
    fn from((err, cause): (PyErr, tauri::Error)) -> Self {
        FactoryError::TauriError(err, cause)
    }
}

impl FactoryError {
    #[inline]
    fn into_py_err(self, py: Python<'_>) -> PyErr {
        match self {
            FactoryError::PyErr(err) => err,
            FactoryError::TauriError(err, cause) => {
                err.set_cause(py, Some(PyErr::from(TauriError::from(cause))));
                err
            }
        }
    }
}

#[pymodule(gil_used = false)]
#[pyo3(name = "ext_mod")]
pub mod ext_mod {
    use super::*;

    #[pymodule_init]
    fn init(module: &Bound<'_, PyModule>) -> PyResult<()> {
        pytauri::pymodule_export(
            module,
            // i.e., `context_factory` function of python binding
            context_factory,
            // i.e., `builder_factory` function of python binding
            builder_factory,
        )
    }
}