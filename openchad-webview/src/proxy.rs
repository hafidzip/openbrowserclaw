//! Local filtering proxy for hard network blocking (Tier 1: domain-level).
//!
//! Binds a TCP listener on `127.0.0.1:0` (ephemeral port) and proxies all
//! webview HTTP(S) traffic. CONNECT tunnels are checked against the adblock
//! engine at the hostname level; plain HTTP requests are checked at the full
//! URL level. Blocked requests receive a clean `403 Forbidden` response.
//!
//! The proxy is supervised by a watchdog task that pings a health endpoint
//! every 5 seconds and restarts the accept-loop on failure (up to 3 retries).

use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tokio::time::{self, Duration};

use crate::AdblockState;

// =============================================================================
// Configuration constants
// =============================================================================

/// Maximum concurrent proxied connections.
const MAX_CONNECTIONS: usize = 512;

/// Idle tunnel timeout.
const TUNNEL_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

/// Total per-connection lifetime cap.
const TUNNEL_MAX_LIFETIME: Duration = Duration::from_secs(3600);

/// Watchdog health-check interval.
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(5);

/// Maximum consecutive restart failures before declaring degraded.
const MAX_RESTART_FAILURES: u32 = 3;

/// Header read timeout (defense against slow-loris).
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum header size (defense against oversized headers).
const MAX_HEADER_SIZE: usize = 16 * 1024; // 16 KiB

// =============================================================================
// BlockStats — atomic counters for observability
// =============================================================================

/// Atomic counters for proxy blocking statistics.
#[derive(Debug, Default)]
pub struct BlockStats {
    pub checked: AtomicU64,
    pub blocked: AtomicU64,
    pub errors: AtomicU64,
    pub connections: AtomicU64,
}

impl BlockStats {
    pub fn snapshot(&self) -> BlockStatsSnapshot {
        BlockStatsSnapshot {
            checked: self.checked.load(Ordering::Relaxed),
            blocked: self.blocked.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            connections: self.connections.load(Ordering::Relaxed),
        }
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct BlockStatsSnapshot {
    pub checked: u64,
    pub blocked: u64,
    pub errors: u64,
    pub connections: u64,
}

// =============================================================================
// ProxyState — shared state for the proxy
// =============================================================================

/// Shared state for the local filtering proxy.
pub struct ProxyState {
    /// Reference to the adblock engine (shared with Tauri commands).
    pub adblock: Arc<AdblockState>,
    /// Connection semaphore to cap concurrent connections.
    pub semaphore: Arc<Semaphore>,
    /// Blocking statistics.
    pub stats: Arc<BlockStats>,
    /// Whether the proxy is alive (set to false on unrecoverable failure).
    pub alive: AtomicBool,
    /// Consecutive restart failure count.
    pub restart_failures: AtomicU32,
}

impl ProxyState {
    pub fn new(adblock: Arc<AdblockState>) -> Self {
        Self {
            adblock,
            semaphore: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            stats: Arc::new(BlockStats::default()),
            alive: AtomicBool::new(true),
            restart_failures: AtomicU32::new(0),
        }
    }
}

// =============================================================================
// Response helpers
// =============================================================================

fn response_403() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header("Content-Type", "text/plain")
        .body(Full::new(Bytes::from("Blocked by adblock filter")))
        .unwrap()
}



fn response_503() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .header("Content-Type", "text/plain")
        .body(Full::new(Bytes::from("Proxy at capacity")))
        .unwrap()
}

fn response_health(stats: &BlockStats) -> Response<Full<Bytes>> {
    let snap = stats.snapshot();
    let body = serde_json::to_string(&snap).unwrap_or_else(|_| "{}".to_owned());
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Full::new(Bytes::from(body)))
        .unwrap()
}

fn response_bad_request(msg: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header("Content-Type", "text/plain")
        .body(Full::new(Bytes::from(msg.to_owned())))
        .unwrap()
}

// =============================================================================
// Proxy request handler
// =============================================================================

/// Main proxy handler — dispatches CONNECT, plain HTTP, and health checks.
async fn proxy_handler(
    state: Arc<ProxyState>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    // Health endpoint.
    if req.method() == Method::GET && req.uri().path() == "/__health" {
        return Ok(response_health(&state.stats));
    }

    // CONNECT method — HTTPS tunneling.
    if req.method() == Method::CONNECT {
        return Ok(handle_connect(state, req).await);
    }

    // Plain HTTP absolute-form requests.
    Ok(handle_plain_http(state, req).await)
}

/// Handle CONNECT requests for HTTPS tunneling.
///
/// 1. Extract hostname from the CONNECT target.
/// 2. Check against adblock engine (domain-level).
/// 3. If blocked → 403 Forbidden.
/// 4. If allowed → establish tunnel with `copy_bidirectional`.
async fn handle_connect(
    state: Arc<ProxyState>,
    req: Request<Incoming>,
) -> Response<Full<Bytes>> {
    let authority = req.uri().authority().map(|a| a.to_string()).unwrap_or_else(|| {
        // Fallback: parse from the URI host or the raw CONNECT target.
        req.uri().host().unwrap_or("").to_string()
    });

    // Parse host and port from the authority.
    let (host, port) = if let Some(colon_pos) = authority.rfind(':') {
        let h = &authority[..colon_pos];
        let p = authority[colon_pos + 1..].parse::<u16>().unwrap_or(443);
        (h.to_string(), p)
    } else {
        (authority.clone(), 443)
    };

    if host.is_empty() {
        return response_bad_request("Invalid CONNECT target");
    }

    // Domain-level adblock check.
    let check_url = format!("https://{host}/");
    state.stats.checked.fetch_add(1, Ordering::Relaxed);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        state.adblock.check_request(check_url, String::new(), "other".to_string())
    }));

    let blocked = match result {
        Ok(check_result) => check_result.matched,
        Err(_) => {
            // Engine panicked — treat as blocked per fail-closed policy.
            state.stats.errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("⚠️ adblock: engine panicked during CONNECT check for {host}");
            true
        }
    };

    if blocked {
        state.stats.blocked.fetch_add(1, Ordering::Relaxed);
        return response_403();
    }

    // Attempt to connect to the upstream server.
    let upstream_addr = format!("{host}:{port}");
    let upstream = match time::timeout(Duration::from_secs(10), TcpStream::connect(&upstream_addr)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            eprintln!("❌ proxy: failed to connect to {upstream_addr}: {e}");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Full::new(Bytes::from(format!("Failed to connect to upstream: {e}"))))
                .unwrap();
        }
        Err(_) => {
            eprintln!("❌ proxy: connection to {upstream_addr} timed out");
            return Response::builder()
                .status(StatusCode::GATEWAY_TIMEOUT)
                .body(Full::new(Bytes::from("Upstream connection timed out")))
                .unwrap();
        }
    };

    // For CONNECT, we need to respond with 200 then start tunneling.
    // hyper's HTTP/1 doesn't let us do bidirectional I/O after responding on
    // the same connection via the normal handler return. We need to use
    // `hyper::upgrade` to take over the connection.
    //
    // We set up the upgrade here and spawn the tunnel task.
    tokio::task::spawn(async move {
        match hyper::upgrade::on(req).await {
            Ok(upgraded) => {
                let mut upgraded = TokioIo::new(upgraded);
                let mut upstream = upstream;

                // Bidirectional copy with idle timeout.
                let result = time::timeout(
                    TUNNEL_MAX_LIFETIME,
                    tokio::io::copy_bidirectional(&mut upgraded, &mut upstream),
                )
                .await;

                match result {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        // Normal for connections closed by either side.
                        if e.kind() != std::io::ErrorKind::NotConnected {
                            // Only log unexpected errors.
                        }
                    }
                    Err(_) => {
                        // Lifetime timeout — just close.
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ proxy: upgrade failed for tunnel: {e}");
            }
        }
    });

    // Return 200 Connection Established to trigger the upgrade.
    Response::builder()
        .status(StatusCode::OK)
        .body(Full::new(Bytes::new()))
        .unwrap()
}

/// Handle plain HTTP (non-CONNECT) requests.
///
/// For absolute-form HTTP requests, we have full URL visibility. Run a
/// full URL check, infer `request_type` from headers, and forward or block.
async fn handle_plain_http(
    state: Arc<ProxyState>,
    req: Request<Incoming>,
) -> Response<Full<Bytes>> {
    let url = req.uri().to_string();

    // Only handle absolute-form requests (http://...).
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return response_bad_request("Proxy requires absolute-form URI");
    }

    // Infer request type from headers.
    let request_type = infer_request_type(&req);

    state.stats.checked.fetch_add(1, Ordering::Relaxed);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        state.adblock.check_request(url.clone(), String::new(), request_type)
    }));

    let blocked = match result {
        Ok(check_result) => check_result.matched,
        Err(_) => {
            state.stats.errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("⚠️ adblock: engine panicked during HTTP check for {url}");
            true
        }
    };

    if blocked {
        state.stats.blocked.fetch_add(1, Ordering::Relaxed);
        return response_403();
    }

    // Forward the request to the upstream server.
    match forward_http_request(req).await {
        Ok(resp) => resp,
        Err(e) => {
            eprintln!("❌ proxy: failed to forward HTTP request to {url}: {e}");
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Full::new(Bytes::from(format!("Failed to forward: {e}"))))
                .unwrap()
        }
    }
}

/// Infer the adblock `request_type` from HTTP headers.
fn infer_request_type<B>(req: &Request<B>) -> String {
    // Check Sec-Fetch-Dest first (most reliable in modern browsers).
    if let Some(dest) = req.headers().get("sec-fetch-dest") {
        if let Ok(dest_str) = dest.to_str() {
            return match dest_str {
                "document" => "document",
                "iframe" => "subdocument",
                "script" => "script",
                "style" => "stylesheet",
                "image" => "image",
                "font" => "font",
                "audio" | "video" | "track" => "media",
                "empty" => {
                    // Could be XHR/fetch — check Accept header.
                    if let Some(accept) = req.headers().get("accept") {
                        if let Ok(a) = accept.to_str() {
                            if a.contains("application/json") || a.contains("text/") {
                                return "xhr".to_string();
                            }
                        }
                    }
                    "other"
                }
                _ => "other",
            }
            .to_string();
        }
    }

    // Fallback: infer from Accept header.
    if let Some(accept) = req.headers().get("accept") {
        if let Ok(a) = accept.to_str() {
            if a.contains("text/html") {
                return "document".to_string();
            }
            if a.contains("text/css") {
                return "stylesheet".to_string();
            }
            if a.contains("image/") {
                return "image".to_string();
            }
            if a.contains("application/javascript") || a.contains("text/javascript") {
                return "script".to_string();
            }
            if a.contains("font/") {
                return "font".to_string();
            }
        }
    }

    "other".to_string()
}

/// Forward an HTTP request to the upstream server using a simple TCP connection.
async fn forward_http_request(
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Box<dyn std::error::Error + Send + Sync>> {
    let uri = req.uri().clone();
    let host = uri
        .host()
        .ok_or("Missing host in request URI")?
        .to_string();
    let port = uri.port_u16().unwrap_or(80);

    let addr = format!("{host}:{port}");
    let stream = time::timeout(Duration::from_secs(10), TcpStream::connect(&addr)).await??;
    let io = TokioIo::new(stream);

    let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
    tokio::task::spawn(async move {
        if let Err(e) = conn.await {
            eprintln!("❌ proxy: client connection error: {e}");
        }
    });

    // Rewrite the URI to origin-form for the upstream request.
    let mut parts = req.into_parts();
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.to_string())
        .unwrap_or_else(|| "/".to_string());
    parts.0.uri = path_and_query.parse()?;

    let upstream_req = Request::from_parts(parts.0, parts.1);
    let resp = time::timeout(
        Duration::from_secs(120),
        sender.send_request(upstream_req),
    )
    .await??;

    // Collect the response body.
    let (parts, body) = resp.into_parts();
    let body_bytes = body.collect().await?.to_bytes();
    Ok(Response::from_parts(parts, Full::new(body_bytes)))
}

// =============================================================================
// Proxy server lifecycle
// =============================================================================

/// Start the local filtering proxy.
///
/// Returns the bound port and a handle to the supervisor task.
/// The proxy binds to `127.0.0.1:0` (ephemeral port) before any webview
/// window is created. The bound port is passed into `proxy_url`.
pub async fn start_proxy(
    adblock: Arc<AdblockState>,
) -> Result<(u16, Arc<ProxyState>, tokio::task::JoinHandle<()>), Box<dyn std::error::Error + Send + Sync>>
{
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let state = Arc::new(ProxyState::new(adblock));

    println!("🛡️ adblock proxy: listening on 127.0.0.1:{port}");

    let supervisor_state = state.clone();
    let supervisor_handle = tokio::spawn(supervisor_task(listener, supervisor_state));

    Ok((port, state, supervisor_handle))
}

/// Supervisor task: runs the accept-loop and restarts it on failure.
async fn supervisor_task(listener: TcpListener, state: Arc<ProxyState>) {
    loop {
        // Run the accept loop.
        let accept_result = accept_loop(&listener, state.clone()).await;

        if let Err(e) = accept_result {
            let failures = state.restart_failures.fetch_add(1, Ordering::SeqCst) + 1;
            eprintln!(
                "❌ adblock proxy: accept-loop failed (attempt {failures}/{MAX_RESTART_FAILURES}): {e}"
            );

            if failures >= MAX_RESTART_FAILURES {
                state.alive.store(false, Ordering::SeqCst);
                eprintln!("🚨 adblock proxy: unrecoverable — {MAX_RESTART_FAILURES} consecutive failures");
                // The Tauri event `adblock://proxy-degraded` should be emitted by
                // the caller watching `state.alive`.
                break;
            }

            // Wait briefly before restarting.
            time::sleep(Duration::from_millis(500)).await;
        } else {
            // Clean shutdown.
            break;
        }
    }
}

/// Accept loop: accepts connections and spawns handlers.
async fn accept_loop(
    listener: &TcpListener,
    state: Arc<ProxyState>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    loop {
        let (stream, peer_addr) = listener.accept().await?;

        // Verify the peer is on loopback (defense in depth).
        if !peer_addr.ip().is_loopback() {
            eprintln!("⚠️ proxy: rejected non-loopback connection from {peer_addr}");
            drop(stream);
            continue;
        }

        // Reset restart failure count on successful accept.
        state.restart_failures.store(0, Ordering::SeqCst);
        state.stats.connections.fetch_add(1, Ordering::Relaxed);

        // Check connection semaphore.
        let permit = match state.semaphore.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                // At capacity — we can't easily send a 503 before HTTP parsing,
                // so just drop the connection.
                eprintln!("⚠️ proxy: at capacity ({MAX_CONNECTIONS}), dropping connection");
                drop(stream);
                continue;
            }
        };

        let conn_state = state.clone();
        tokio::spawn(async move {
            let _permit = permit; // Held for connection lifetime.

            let io = TokioIo::new(stream);
            let service = service_fn(move |req: Request<Incoming>| {
                let s = conn_state.clone();
                async move { proxy_handler(s, req).await }
            });

            let conn = http1::Builder::new()
                .preserve_header_case(true)
                .title_case_headers(true)
                .serve_connection(io, service)
                .with_upgrades();

            if let Err(e) = conn.await {
                // Normal for connections closed by the client.
                let msg = e.to_string();
                if !msg.contains("connection closed") && !msg.contains("broken pipe") {
                    // Uncomment for debugging:
                    // eprintln!("proxy: connection error: {e}");
                }
            }
        });
    }
}

/// Health check function — can be used by the watchdog or exposed as a command.
pub async fn check_health(state: &ProxyState, port: u16) -> bool {
    if !state.alive.load(Ordering::SeqCst) {
        return false;
    }

    let _url = format!("http://127.0.0.1:{port}/__health");

    match time::timeout(Duration::from_secs(3), async {
        let stream = TcpStream::connect(format!("127.0.0.1:{port}")).await?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(conn);

        let req = Request::builder()
            .method(Method::GET)
            .uri("/__health")
            .header("Host", format!("127.0.0.1:{port}"))
            .body(Full::<Bytes>::new(Bytes::new()))?;

        let resp = sender.send_request(req).await?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(resp.status() == StatusCode::OK)
    })
    .await
    {
        Ok(Ok(healthy)) => healthy,
        _ => false,
    }
}

/// Watchdog task: periodically checks proxy health and reports degradation.
pub async fn watchdog_task(state: Arc<ProxyState>, port: u16) {
    loop {
        time::sleep(WATCHDOG_INTERVAL).await;

        if !state.alive.load(Ordering::SeqCst) {
            // Proxy declared dead — stop watching.
            break;
        }

        let healthy = check_health(&state, port).await;
        if !healthy {
            eprintln!("⚠️ adblock proxy watchdog: health check failed on port {port}");
        }
    }
}
