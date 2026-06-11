use std::{
    borrow::Cow,
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex, RwLock,
    },
    thread,
};

mod proxy;

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
    webview::PageLoadEvent,
    Assets, Config, Manager, Emitter,
};

use adblock::{
    lists::{FilterSet, ParseOptions},
    request::Request,
    Engine,
};

type TauriContext = tauri::Context<Runtime>;

const CAPABILITIES_FOLDER: &str = "capabilities";
/// Folder (relative to the current working dir, or set via `ADBLOCK_LISTS_DIR`
/// env var) containing `*.txt` filter lists (EasyList / uBO syntax).
const ADBLOCK_LISTS_FOLDER: &str = "adblock";

/// Runtime patch for YouTube **instream (in-video) ads**.
///
/// Why this is needed: the system WebView exposes no network-request
/// interception hook, and YouTube serves video ads over the *same*
/// `blob:`/googlevideo media streams as real content — so network-level
/// blocking (the `adblock_check_request` command) cannot stop them. Cosmetic
/// filters only remove banners/overlays, not the ad playback itself.
///
/// This script:
///   1. Clicks the "Skip" button as soon as it appears.
///   2. Fast-forwards unskippable ads to the end (sets `currentTime` to
///      `duration`) and mutes them while they play.
///   3. Hides the ad module/overlays.
///   4. Re-runs on every DOM mutation via a `MutationObserver`, and as a
///      fallback on a short interval (YouTube is an SPA, pages don't reload).
const YT_AD_SKIP_SCRIPT: &str = r#"// ==UserScript==
// @name        fadblock-for-safari
// @description This is your new file, start writing code
// @match       https://www.youtube.com/*
// ==/UserScript==

// Source: https://raw.githubusercontent.com/0x48piraj/fadblock/master/src/chrome/js/content.js

const taimuRipu = async () => {
    await new Promise((resolve, _reject) => {
      const videoContainer = document.getElementById("movie_player");
  
      const setTimeoutHandler = () => {
        const isAd = videoContainer?.classList.contains("ad-interrupting") || videoContainer?.classList.contains("ad-showing");
        const skipLock = document.querySelector(".ytp-ad-preview-text")?.innerText;
        const surveyLock = document.querySelector(".ytp-ad-survey")?.length > 0;
  
        if (isAd && skipLock) {
          const videoPlayer = document.getElementsByClassName("video-stream")[0];
          videoPlayer.muted = true; // videoPlayer.volume = 0;
          videoPlayer.currentTime = videoPlayer.duration - 0.1;
          videoPlayer.paused && videoPlayer.play()
          // CLICK ON THE SKIP AD BTN
          document.querySelector(".ytp-ad-skip-button")?.click();
          document.querySelector(".ytp-ad-skip-button-modern")?.click();
        } else if (isAd && surveyLock) {
          // CLICK ON THE SKIP SURVEY BTN
          document.querySelector(".ytp-ad-skip-button")?.click();
          document.querySelector(".ytp-ad-skip-button-modern")?.click();
        }
  
        const staticAds = [".ytd-companion-slot-renderer", ".ytd-action-companion-ad-renderer", // in-feed video ads
                           ".ytd-watch-next-secondary-results-renderer.sparkles-light-cta", ".ytd-unlimited-offer-module-renderer", // similar components
                           ".ytp-ad-overlay-image", ".ytp-ad-text-overlay", // deprecated overlay ads (04-06-2023)
                           "div#root.style-scope.ytd-display-ad-renderer.yt-simple-endpoint", "div#sparkles-container.style-scope.ytd-promoted-sparkles-web-renderer",
                           ".ytd-display-ad-renderer", ".ytd-statement-banner-renderer", ".ytd-in-feed-ad-layout-renderer", // homepage ads
                           "div#player-ads.style-scope.ytd-watch-flexy, div#panels.style-scope.ytd-watch-flexy", // sponsors
                           ".ytd-banner-promo-renderer", ".ytd-video-masthead-ad-v3-renderer", ".ytd-primetime-promo-renderer" // subscribe for premium & youtube tv ads
                          ];
  
        staticAds.forEach((ad) => {
            document.hideElementsBySelector(ad);
        });
  
        resolve();
      };
  
      // RUN IT ONLY AFTER 100 MILLISECONDS
      setTimeout(setTimeoutHandler, 100);
    });
  
    taimuRipu();
  };
  
  
  const init = async () => {
    Document.prototype.hideElementsBySelector = (selector) =>
      [...document.querySelectorAll(selector)].forEach(
        (el) => (el.style.display = "none")
      );
  
      taimuRipu();
  };
  
  init();"#;

pub fn tauri_generate_context() -> TauriContext {
    tauri::generate_context!()
}

// =============================================================================
// adblock integration
// =============================================================================
//
// `adblock::Engine` is NOT `Send + Sync` (it contains `Rc`, `RefCell`, and
// non-thread-safe trait objects). Tauri requires managed state to be
// `Send + Sync + 'static`.
//
// To bridge this, the `Engine` lives entirely on a single dedicated worker
// thread. The managed `AdblockState` only holds a `Sender` (which IS `Send +
// Sync`) used to dispatch jobs to that thread, plus a couple of atomics-ish
// `RwLock`s. Each query sends a closure to the engine thread and receives the
// result back over a oneshot channel.
//
// The `AdblockState` is wrapped in `Arc` and shared between Tauri's `.manage()`
// and the local filtering proxy task. Both use the same `check_request()` path.

/// Fail policy for engine check failures (panic, timeout).
/// 0 = fail-open (allow), 1 = fail-closed (block).
const FAIL_POLICY_OPEN: u8 = 0;
const FAIL_POLICY_CLOSED: u8 = 1;

/// Serializable subset of [`adblock::blocker::BlockerResult`].
#[derive(serde::Serialize, Clone)]
struct AdblockCheckResult {
    matched: bool,
    important: bool,
    redirect: Option<String>,
    rewritten_url: Option<String>,
    exception: Option<String>,
    filter: Option<String>,
}

impl AdblockCheckResult {
    fn allow_all() -> Self {
        Self {
            matched: false,
            important: false,
            redirect: None,
            rewritten_url: None,
            exception: None,
            filter: None,
        }
    }
}

/// Serializable subset of [`adblock::cosmetic_filter_cache::UrlSpecificResources`].
#[derive(serde::Serialize, Clone)]
struct CosmeticResourcesResult {
    hide_selectors: Vec<String>,
    exceptions: Vec<String>,
    injected_script: String,
    generichide: bool,
}

impl CosmeticResourcesResult {
    fn empty() -> Self {
        Self {
            hide_selectors: Vec::new(),
            exceptions: Vec::new(),
            injected_script: String::new(),
            generichide: false,
        }
    }
}

/// A job sent to the dedicated engine thread.
///
/// Each variant carries its inputs and a oneshot [`Sender`] to deliver the
/// result back to the caller.
enum EngineJob {
    /// Replace the engine with one built from the provided rules. Returns the
    /// number of rules processed.
    LoadRules {
        rules: Vec<String>,
        resp: Sender<usize>,
    },
    /// Drop the current engine.
    Clear { resp: Sender<()> },
    /// Network request check.
    CheckRequest {
        url: String,
        source_url: String,
        request_type: String,
        resp: Sender<AdblockCheckResult>,
    },
    /// CSP directives for a document request.
    CspDirectives {
        url: String,
        source_url: String,
        request_type: String,
        resp: Sender<Option<String>>,
    },
    /// Cosmetic resources for a page URL.
    CosmeticResources {
        url: String,
        resp: Sender<CosmeticResourcesResult>,
    },
    /// Additional hidden selectors for newly observed classes/ids.
    HiddenClassIdSelectors {
        classes: Vec<String>,
        ids: Vec<String>,
        exceptions: HashSet<String>,
        resp: Sender<Vec<String>>,
    },
    /// Build the cosmetic injection script for a page URL.
    CosmeticInjectionScript {
        url: String,
        resp: Sender<Option<String>>,
    },
}

/// Global adblock state managed by Tauri.
///
/// Holds only `Send + Sync` handles; the actual `!Send` [`Engine`] lives on a
/// dedicated worker thread (see [`AdblockState::spawn`]).
///
/// Wrapped in `Arc` and shared between Tauri's `.manage()` and the local
/// filtering proxy. Both use `check_request()` for a single code path.
pub struct AdblockState {
    /// Channel to the engine worker thread. Wrapped in a `Mutex` so we can
    /// `send` from `&self` across threads (the `Sender` itself is already
    /// `Send + Sync`, the `Mutex` just keeps ownership semantics simple).
    job_tx: Mutex<Sender<EngineJob>>,
    enabled: RwLock<bool>,
    /// Fail policy: FAIL_POLICY_OPEN (0) or FAIL_POLICY_CLOSED (1).
    /// Default: fail-closed (block on engine errors).
    fail_policy: AtomicU8,
}

impl Default for AdblockState {
    fn default() -> Self {
        Self::spawn()
    }
}

impl AdblockState {
    /// Spawn the dedicated engine thread and return the state used to talk to it.
    fn spawn() -> Self {
        let (job_tx, job_rx) = mpsc::channel::<EngineJob>();

        thread::Builder::new()
            .name("adblock-engine".to_owned())
            .spawn(move || {
                // The engine lives here and never crosses thread boundaries.
                let mut engine: Option<Engine> = None;

                while let Ok(job) = job_rx.recv() {
                    match job {
                        EngineJob::LoadRules { rules, resp } => {
                            let mut filter_set = FilterSet::new(false /* debug */);
                            let mut count = 0usize;
                            for rule in &rules {
                                count += 1;
                                filter_set.add_filters([rule.as_str()], ParseOptions::default());
                            }
                            engine =
                                Some(Engine::from_filter_set(filter_set, true /* optimize */));
                            let _ = resp.send(count);
                        }
                        EngineJob::Clear { resp } => {
                            engine = None;
                            let _ = resp.send(());
                        }
                        EngineJob::CheckRequest {
                            url,
                            source_url,
                            request_type,
                            resp,
                        } => {
                            let result = match (&engine, Request::new(&url, &source_url, &request_type)) {
                                (Some(engine), Ok(request)) => {
                                    let r = engine.check_network_request(&request);
                                    AdblockCheckResult {
                                        matched: r.matched,
                                        important: r.important,
                                        redirect: r.redirect,
                                        rewritten_url: r.rewritten_url,
                                        exception: r.exception,
                                        filter: r.filter,
                                    }
                                }
                                // engine missing or invalid request => allow.
                                _ => AdblockCheckResult::allow_all(),
                            };
                            let _ = resp.send(result);
                        }
                        EngineJob::CspDirectives {
                            url,
                            source_url,
                            request_type,
                            resp,
                        } => {
                            let result = match (&engine, Request::new(&url, &source_url, &request_type)) {
                                (Some(engine), Ok(request)) => {
                                    engine.get_csp_directives(&request)
                                }
                                _ => None,
                            };
                            let _ = resp.send(result);
                        }
                        EngineJob::CosmeticResources { url, resp } => {
                            let result = match &engine {
                                Some(engine) => {
                                    let res = engine.url_cosmetic_resources(&url);
                                    CosmeticResourcesResult {
                                        hide_selectors: res.hide_selectors.into_iter().collect(),
                                        exceptions: res.exceptions.into_iter().collect(),
                                        injected_script: res.injected_script,
                                        generichide: res.generichide,
                                    }
                                }
                                None => CosmeticResourcesResult::empty(),
                            };
                            let _ = resp.send(result);
                        }
                        EngineJob::HiddenClassIdSelectors {
                            classes,
                            ids,
                            exceptions,
                            resp,
                        } => {
                            let result = match &engine {
                                Some(engine) => {
                                    engine.hidden_class_id_selectors(&classes, &ids, &exceptions)
                                }
                                None => Vec::new(),
                            };
                            let _ = resp.send(result);
                        }
                        EngineJob::CosmeticInjectionScript { url, resp } => {
                            let result = engine
                                .as_ref()
                                .and_then(|engine| build_cosmetic_injection_script(engine, &url));
                            let _ = resp.send(result);
                        }
                    }
                }
                // Channel closed => all senders dropped => app shutting down.
            })
            .expect("failed to spawn adblock engine thread");

        Self {
            job_tx: Mutex::new(job_tx),
            enabled: RwLock::new(true),
            fail_policy: AtomicU8::new(FAIL_POLICY_CLOSED),
        }
    }

    /// Send a job to the engine thread and block for its response.
    fn dispatch<T, F>(&self, make_job: F) -> Option<T>
    where
        F: FnOnce(Sender<T>) -> EngineJob,
    {
        let (resp_tx, resp_rx) = mpsc::channel::<T>();
        let job = make_job(resp_tx);
        {
            let tx = self.job_tx.lock().expect("adblock job_tx lock poisoned");
            if tx.send(job).is_err() {
                // Engine thread is gone.
                return None;
            }
        }
        resp_rx.recv().ok()
    }

    /// Build a new [`Engine`] from raw filter rules and swap it in.
    /// Returns the number of rules processed.
    fn load_rules(&self, rules: Vec<String>) -> usize {
        self.dispatch(|resp| EngineJob::LoadRules { rules, resp })
            .unwrap_or(0)
    }

    fn clear(&self) {
        let _ = self.dispatch(|resp| EngineJob::Clear { resp });
    }

    fn is_enabled(&self) -> bool {
        *self.enabled.read().expect("adblock enabled lock poisoned")
    }

    fn set_enabled(&self, enabled: bool) {
        *self.enabled.write().expect("adblock enabled lock poisoned") = enabled;
    }

    fn check_request(
        &self,
        url: String,
        source_url: String,
        request_type: String,
    ) -> AdblockCheckResult {
        if !self.is_enabled() {
            return AdblockCheckResult::allow_all();
        }
        self.dispatch(|resp| EngineJob::CheckRequest {
            url,
            source_url,
            request_type,
            resp,
        })
        .unwrap_or_else(AdblockCheckResult::allow_all)
    }

    fn csp_directives(
        &self,
        url: String,
        source_url: String,
        request_type: String,
    ) -> Option<String> {
        if !self.is_enabled() {
            return None;
        }
        self.dispatch(|resp| EngineJob::CspDirectives {
            url,
            source_url,
            request_type,
            resp,
        })
        .flatten()
    }

    fn cosmetic_resources(&self, url: String) -> CosmeticResourcesResult {
        if !self.is_enabled() {
            return CosmeticResourcesResult::empty();
        }
        self.dispatch(|resp| EngineJob::CosmeticResources { url, resp })
            .unwrap_or_else(CosmeticResourcesResult::empty)
    }

    fn hidden_class_id_selectors(
        &self,
        classes: Vec<String>,
        ids: Vec<String>,
        exceptions: HashSet<String>,
    ) -> Vec<String> {
        if !self.is_enabled() {
            return Vec::new();
        }
        self.dispatch(|resp| EngineJob::HiddenClassIdSelectors {
            classes,
            ids,
            exceptions,
            resp,
        })
        .unwrap_or_default()
    }

    fn cosmetic_injection_script(&self, url: String) -> Option<String> {
        if !self.is_enabled() {
            return None;
        }
        self.dispatch(|resp| EngineJob::CosmeticInjectionScript { url, resp })
            .flatten()
    }
}

/// Load all `*.txt` filter lists from a directory into the engine.
fn load_filter_lists_from_dir(state: &AdblockState, dir: &Path) -> std::io::Result<usize> {
    let mut all_rules: Vec<String> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("txt") {
            let content = fs::read_to_string(&path)?;
            all_rules.extend(content.lines().map(str::to_owned));
        }
    }
    Ok(state.load_rules(all_rules))
}

/// Returns `true` if the URL's host is a YouTube domain (where the in-video
/// ad-skipper script should be injected).
fn is_youtube_url(url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            return host == "youtube.com"
                || host.ends_with(".youtube.com")
                || host == "youtu.be"
                || host.ends_with(".youtube-nocookie.com");
        }
    }
    false
}

// -----------------------------------------------------------------------------
// adblock Tauri commands
// -----------------------------------------------------------------------------

/// Load filter rules (EasyList / uBO syntax) provided as a list of strings.
/// Replaces the current engine. Returns the number of rules processed.
#[tauri::command]
fn adblock_load_rules(app: tauri::AppHandle<Runtime>, rules: Vec<String>) -> Result<usize, String> {
    let state = app.state::<Arc<AdblockState>>();
    Ok(state.load_rules(rules))
}

/// Load filter rules from one or more list files on disk.
/// Replaces the current engine. Returns the number of rules processed.
#[tauri::command]
fn adblock_load_rule_files(
    app: tauri::AppHandle<Runtime>,
    paths: Vec<String>,
) -> Result<usize, String> {
    let mut all_rules: Vec<String> = Vec::new();
    for path in &paths {
        let content =
            fs::read_to_string(path).map_err(|e| format!("failed to read '{path}': {e}"))?;
        all_rules.extend(content.lines().map(str::to_owned));
    }
    let state = app.state::<Arc<AdblockState>>();
    Ok(state.load_rules(all_rules))
}

/// Check whether a network request should be blocked.
///
/// `request_type` is one of: `document`, `subdocument`, `script`, `stylesheet`,
/// `image`, `font`, `media`, `xhr`, `fetch`, `websocket`, `ping`, `other`, ...
#[tauri::command]
fn adblock_check_request(
    app: tauri::AppHandle<Runtime>,
    url: String,
    source_url: String,
    request_type: String,
) -> Result<AdblockCheckResult, String> {
    let state = app.state::<Arc<AdblockState>>();
    Ok(state.check_request(url, source_url, request_type))
}

/// Returns additional CSP directives for a `document`/`subdocument` request.
#[tauri::command]
fn adblock_get_csp_directives(
    app: tauri::AppHandle<Runtime>,
    url: String,
    source_url: String,
    request_type: String,
) -> Result<Option<String>, String> {
    let state = app.state::<Arc<AdblockState>>();
    Ok(state.csp_directives(url, source_url, request_type))
}

/// Cosmetic resources (hide selectors + scriptlets) for a page URL.
#[tauri::command]
fn adblock_cosmetic_resources(
    app: tauri::AppHandle<Runtime>,
    url: String,
) -> Result<CosmeticResourcesResult, String> {
    let state = app.state::<Arc<AdblockState>>();
    Ok(state.cosmetic_resources(url))
}

/// Given new CSS classes/ids observed on the page (e.g. via `MutationObserver`),
/// returns additional selectors that should be hidden.
#[tauri::command]
fn adblock_hidden_class_id_selectors(
    app: tauri::AppHandle<Runtime>,
    classes: Vec<String>,
    ids: Vec<String>,
    exceptions: Vec<String>,
) -> Result<Vec<String>, String> {
    let state = app.state::<Arc<AdblockState>>();
    let exceptions: HashSet<String> = exceptions.into_iter().collect();
    Ok(state.hidden_class_id_selectors(classes, ids, exceptions))
}

/// Enable/disable adblocking globally at runtime.
#[tauri::command]
fn adblock_set_enabled(app: tauri::AppHandle<Runtime>, enabled: bool) {
    app.state::<Arc<AdblockState>>().set_enabled(enabled);
}

/// Drop the loaded engine (frees memory, disables blocking until rules reload).
#[tauri::command]
fn adblock_clear(app: tauri::AppHandle<Runtime>) {
    app.state::<Arc<AdblockState>>().clear();
}

// -----------------------------------------------------------------------------
// adblock cosmetic injection
// -----------------------------------------------------------------------------

/// Build the JS snippet that applies cosmetic filtering to a loaded page.
///
/// NOTE: this is only ever called *on the engine thread* (it borrows `&Engine`,
/// which is `!Send`), so it must not be invoked from arbitrary threads.
fn build_cosmetic_injection_script(engine: &Engine, url: &str) -> Option<String> {
    let resources = engine.url_cosmetic_resources(url);

    let mut script = String::new();

    // 1. Hide selectors -> injected <style> element.
    if !resources.hide_selectors.is_empty() {
        let css = format!(
            "{}{{display:none !important;}}",
            resources
                .hide_selectors
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(",")
        );
        // serde_json escapes the CSS so it is safe to embed in JS source.
        let css_json = serde_json::to_string(&css).ok()?;
        script.push_str(&format!(
            r#"(function() {{
    try {{
        var s = document.getElementById('__adblock_style__');
        if (!s) {{
            s = document.createElement('style');
            s.id = '__adblock_style__';
            (document.head || document.documentElement).appendChild(s);
        }}
        s.textContent = {css_json};
    }} catch (e) {{ console.error('[adblock] style injection failed:', e); }}
}})();
"#
        ));
    }

    // 2. Scriptlet injections (`##+js(...)` rules). Requires `use_resources`
    //    to have been called with scriptlet resources to be non-empty.
    if !resources.injected_script.is_empty() {
        script.push_str(&resources.injected_script);
        script.push('\n');
    }

    if script.is_empty() {
        None
    } else {
        Some(script)
    }
}

// =============================================================================
// existing pytauri integration
// =============================================================================

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

/// Shared proxy info stored in Tauri managed state.
pub struct ProxyInfo {
    /// The local port the proxy is listening on.
    pub port: u16,
    /// Reference to the proxy state (stats, alive flag, etc.).
    pub proxy_state: Arc<proxy::ProxyState>,
}

/// Tauri command: get proxy blocking stats.
#[tauri::command]
fn adblock_proxy_stats(app: tauri::AppHandle<Runtime>) -> Result<proxy::BlockStatsSnapshot, String> {
    let info = app.state::<ProxyInfo>();
    Ok(info.proxy_state.stats.snapshot())
}

/// Tauri command: get proxy port.
#[tauri::command]
fn adblock_proxy_port(app: tauri::AppHandle<Runtime>) -> Result<u16, String> {
    let info = app.state::<ProxyInfo>();
    Ok(info.port)
}

/// `def builder_factory() -> tauri.Builder:`
pub fn builder_factory(
    _args: &Bound<'_, PyTuple>,
    _kwargs: Option<&Bound<'_, PyDict>>,
) -> PyResult<tauri::Builder<Runtime>> {
    // Create Arc<AdblockState> BEFORE the builder so we can share one clone
    // with `.manage()` and another with the proxy spawner.
    let adblock_state = Arc::new(AdblockState::default());
    let adblock_for_manage = adblock_state.clone();
    let adblock_for_proxy = adblock_state.clone();

    Ok(tauri::Builder::default()
        // Global adblock state, accessible from all commands & hooks.
        // (Holds only `Send + Sync` channel handles; the `!Send` engine lives
        // on a dedicated worker thread spawned by `AdblockState::spawn`.)
        .manage(adblock_for_manage)
        .setup(move |app| {
            // Optionally auto-load filter lists at startup from
            // `$ADBLOCK_LISTS_DIR` or `./adblock/*.txt`.
            let lists_dir = std::env::var_os("ADBLOCK_LISTS_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(ADBLOCK_LISTS_FOLDER));

            if lists_dir.is_dir() {
                let state = app.state::<Arc<AdblockState>>();
                // `&*state` derefs `State<'_, Arc<AdblockState>>` -> `&Arc<AdblockState>`.
                match load_filter_lists_from_dir(&state, &lists_dir) {
                    Ok(count) => {
                        println!(
                            "✅ adblock: loaded {count} filter rules from {}",
                            lists_dir.display()
                        );
                    }
                    Err(e) => {
                        eprintln!(
                            "❌ adblock: failed to load filter lists from {}: {e}",
                            lists_dir.display()
                        );
                    }
                }
            } else {
                println!(
                    "ℹ️ adblock: no filter list dir at {}, blocking inactive until rules are loaded",
                    lists_dir.display()
                );
            }

            // ── Start local filtering proxy ──────────────────────────────────
            // The proxy binds to 127.0.0.1:0 (ephemeral port) and blocks
            // requests at the domain level (Tier 1). The bound port is used
            // by webview windows via `proxy_url`.
            //
            // IMPORTANT: We use block_on here (not spawn) so that ProxyInfo
            // is registered in managed state BEFORE the app finishes setup.
            // Otherwise the frontend can call `adblock_proxy_port` before
            // the state exists, causing a panic.
            let proxy_adblock = adblock_for_proxy.clone();
            let app_handle = app.handle().clone();

            match tauri::async_runtime::block_on(proxy::start_proxy(proxy_adblock)) {
                Ok((port, proxy_state, _supervisor_handle)) => {
                    println!("🛡️ adblock proxy: started on port {port}");

                    // Store proxy info in managed state for commands and
                    // webview creation.
                    let proxy_info = ProxyInfo {
                        port,
                        proxy_state: proxy_state.clone(),
                    };
                    app.manage(proxy_info);

                    // Start watchdog in background.
                    let watchdog_state = proxy_state.clone();
                    tauri::async_runtime::spawn(async move {
                        proxy::watchdog_task(watchdog_state, port).await;
                        // Watchdog exited — proxy is degraded.
                        eprintln!("🚨 adblock proxy: watchdog exited — proxy degraded");
                        // Emit event for the UI.
                        let _ = app_handle.emit("adblock://proxy-degraded", ());
                    });
                }
                Err(e) => {
                    eprintln!("❌ adblock proxy: failed to start: {e}");
                }
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            // Apply cosmetic filtering once the page has finished loading.
            // (Network-level blocking is now also enforced at the proxy layer,
            // but cosmetic filters are still needed for element hiding.)
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let url = payload.url().as_str().to_owned();
                let state = webview.state::<Arc<AdblockState>>();

                // 1. Cosmetic filters (banners / overlays).
                if let Some(script) = state.cosmetic_injection_script(url.clone()) {
                    if let Err(e) = webview.eval(&script) {
                        eprintln!("❌ adblock: failed to inject cosmetic filters: {e}");
                    }
                }

                // 2. YouTube **in-video** ad skipper. Cosmetic + network filters
                //    cannot stop instream ads (served over the same media
                //    streams), so we patch the player at runtime instead.
                //    Only inject when adblock is enabled and we're on YouTube.
                if state.is_enabled() && is_youtube_url(&url) {
                    if let Err(e) = webview.eval(YT_AD_SKIP_SCRIPT) {
                        eprintln!("❌ adblock: failed to inject yt ad-skipper: {e}");
                    }
                }
            }

            // original page-load script
            let script = "console.log('hi')";
            if let Err(e) = webview.eval(script) {
                eprintln!("❌ Failed to execute script on page load: {}", e);
            }
        })
        .invoke_handler(tauri::generate_handler![
            eval_in_webview,
            adblock_load_rules,
            adblock_load_rule_files,
            adblock_check_request,
            adblock_get_csp_directives,
            adblock_cosmetic_resources,
            adblock_hidden_class_id_selectors,
            adblock_set_enabled,
            adblock_clear,
            adblock_proxy_stats,
            adblock_proxy_port,
        ]))
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

#[tauri::command]
fn eval_in_webview(app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.eval(&script).map_err(|e| e.to_string())
}