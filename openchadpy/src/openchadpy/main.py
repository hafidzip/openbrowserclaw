from openchadpy.context import max_retries_ctx
from openchadpy.context import agent_ctx
from aiortc import rtcrtptransceiver
from mcp.types import JSONRPCMessage
from openchadpy.tool_base import ToolBase
import os, shutil
import sys

from mcp.server.fastmcp import FastMCP
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from fastapi.responses import FileResponse, Response
from urllib.parse import unquote

# Import processing modules
from .code_sandbox import CodeSandbox
from .process_image import process_image
from .process_audio import process_audio
from .process_video import process_video, generate_video_thumbnail
from .streaming_response import range_requests_response, stream_processed_video
from .database import Database
from .context import workspace_ctx, tab_id_ctx, model_id_ctx
from .mcp_manager import MCPManager
from pytauri import Commands, AppHandle, Manager
from pytauri_plugins import (
    autostart,
    clipboard_manager,
    deep_link,
    dialog,
    fs,
    global_shortcut,
    http,
    notification,
    opener,
    os as os_plugin,
    persisted_scope,
    positioner,
    process,
    shell,
    single_instance,
    upload,
    websocket,
)
import subprocess
from pytauri_wheel.lib import builder_factory, context_factory
import anyio
from anyio import create_task_group, sleep
from anyio.abc import TaskGroup
from anyio.from_thread import start_blocking_portal
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from pathlib import Path
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware
import logging
import asyncio
import mimetypes
import json
import copy
from typing import Dict, Any, Optional, Callable, Awaitable, List, cast, AsyncGenerator
import uvicorn
import aiofiles
import importlib.util

# New Modules
from .connection_manager import manager
from .database_manager import (
    subscribe_db,
    unsubscribe_db,
    trigger_table_update,
    remove_id as remove_db_id,
)

from .file_manager import (
    subscribe_file,
    unsubscribe_file,
    subscribe_folder,
    unsubscribe_folder,
    remove_id as remove_file_id,
)

from .sqlite import sqlite, close_all_connections
from .file import file_handler, folder_handler
from .proxy import proxy_handler
from .credentials import credentials_handler, initialize_credentials
from .model_manager import ModelManager
from fastapi.responses import StreamingResponse
from .tool_manager import ToolManager
from .pipeline_manager import PipelineManager
from .model_provider import ModelProviderManager
from .settings import Settings
from .event_emitter import event_emitter, set_app_handle
from .plugin_watcher import create_plugin_watcher
from .startup import startup_tracker
from .settings_subscription import (
    subscribe_settings,
    unsubscribe_settings,
    notify_settings_change,
    remove_id as remove_settings_id
)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Add startup tracker handler to root logger
logging.getLogger().addHandler(startup_tracker.get_handler())

# Initialize Directories
_PROJECT_ROOT = os.environ.get("OPENCHAD_PROJECT_DIR", os.path.abspath(__file__))
if os.path.isfile(_PROJECT_ROOT):
    _PROJECT_ROOT = os.path.dirname(_PROJECT_ROOT)

# Add file logging to the root logger
try:
    _log_file = os.path.join(_PROJECT_ROOT, "openchad.log")
    open(_log_file, 'w').close()
    _file_handler = logging.FileHandler(_log_file, encoding="utf-8")
    _file_handler.setFormatter(logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%H:%M:%S"
    ))
    _file_handler.setLevel(logging.INFO)

    class IgnoreSpecificLogsFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            if "🔔 DB changed" in msg or "Broadcasting to client" in msg:
                return False
            if "change detected" in msg or "changes detected" in msg:
                return False
            return True

    _file_handler.addFilter(IgnoreSpecificLogsFilter())
    logging.getLogger().addHandler(_file_handler)
    logger.info(f"File logging initialized. Logs are saved to: {_log_file}")
except Exception as e:
    logger.error(f"Failed to set up file handler for logging: {e}")

_PYTHON_ROOT = os.path.dirname(os.path.join(_PROJECT_ROOT, 'python'))


# If running as a package, config might be in the python root or package dir
_CONFIG_PATH = os.environ.get("OPENCHAD_CONFIG_PATH")
if not _CONFIG_PATH:
    _CONFIG_PATH = os.path.join(_PYTHON_ROOT, "config.json")
    
# Define Plugin Directories
BACKENDS_DIR = os.environ.get("OPENCHAD_BACKENDS_DIR", os.path.join(_PROJECT_ROOT, "Backend"))
PIPELINES_DIR = os.environ.get("OPENCHAD_PIPELINES_DIR", os.path.join(_PROJECT_ROOT, "Pipeline"))
TOOLS_DIR = os.environ.get("OPENCHAD_TOOLS_DIR", os.path.join(_PROJECT_ROOT, "Tools"))
APPS_DIR = os.environ.get("OPENCHAD_APPS_DIR", os.path.join(_PROJECT_ROOT, "Apps"))
MODEL_PROVIDERS_DIR = os.environ.get("OPENCHAD_MODEL_PROVIDERS_DIR", os.path.join(_PROJECT_ROOT, "ModelProvider"))
SETTINGS_DIR = os.environ.get("OPENCHAD_SETTINGS_DIR", os.path.join(_PROJECT_ROOT, "Settings"))

def get_plugin_dirs():
    """Return absolute paths for all plugin and data directories."""
    return {
        "PROJECT_ROOT": os.path.abspath(_PROJECT_ROOT),
        "PYTHON_ROOT": os.path.abspath(_PYTHON_ROOT),
        "BACKENDS_DIR": os.path.abspath(BACKENDS_DIR),
        "PIPELINES_DIR": os.path.abspath(PIPELINES_DIR),
        "TOOLS_DIR": os.path.abspath(TOOLS_DIR),
        "APPS_DIR": os.path.abspath(APPS_DIR),
        "MODEL_PROVIDERS_DIR": os.path.abspath(MODEL_PROVIDERS_DIR),
        "SETTINGS_DIR": os.path.abspath(SETTINGS_DIR),
        "is_darwin": sys.platform == "darwin",
        "is_windows": os.name == "nt",
        "is_linux": sys.platform == "linux",
    }

# Initialize Shared Config Lock
config_lock = asyncio.Lock()
# Initialize Settings Manager
settings_manager = Settings(project_root=_PROJECT_ROOT, on_change=notify_settings_change)
# Initialize MCP Manager
mcp_manager = MCPManager(
    settings_manager=settings_manager,
    emitter=event_emitter,
)
# Initialize Model Manager
model_manager = ModelManager(emitter=event_emitter, config_path=_CONFIG_PATH, backends_dir=BACKENDS_DIR, config_lock=config_lock)
# Initialize Tool Manager
tool_manager = ToolManager(TOOLS_DIR)
code_sandbox = CodeSandbox(tool_manager, model_manager)
# Initialize Pipeline Manager
pipeline_manager = PipelineManager(config_path=_CONFIG_PATH, pipelines_dir=PIPELINES_DIR, config_lock=config_lock)
# Initialize Model Provider Manager
model_provider_manager = ModelProviderManager(
    settings_manager=settings_manager, 
    providers_dir=MODEL_PROVIDERS_DIR, 
    config_lock=config_lock,
    emitter=event_emitter,
    on_change=lambda provider_id=None: asyncio.create_task(scan_models(provider_id))
)

def build_tree(flat: dict) -> dict:
    normalized_flat = {}
    for node_id, raw_node in flat.items():
        node = dict(raw_node)
        for key in ["children", "tools"]:
            val = node.get(key)
            if isinstance(val, str):
                try:
                    node[key] = json.loads(val)
                except Exception:
                    pass
            if node.get(key) is None:
                node[key] = []
        
        # Handle allowMultiple boolean parsing if it is stored as a string or number
        if "allowMultiple" in node:
            val = node["allowMultiple"]
            if isinstance(val, str):
                if val.lower() == "true":
                    node["allowMultiple"] = True
                elif val.lower() == "false":
                    node["allowMultiple"] = False
                else:
                    try:
                        node["allowMultiple"] = bool(json.loads(val))
                    except Exception:
                        node["allowMultiple"] = False
            elif isinstance(val, (int, float)):
                node["allowMultiple"] = bool(val)

        normalized_flat[node_id] = node

    all_child_ids = {
        cid
        for node in normalized_flat.values()
        for cid in node.get("children", [])
    }

    root_ids = [id for id in normalized_flat if id not in all_child_ids]

    def build_node(id: str) -> dict:
        node = normalized_flat[id]
        return {
            **{k: v for k, v in node.items() if k != "children"},
            "children": {cid: build_node(cid) for cid in node.get("children", [])},
        }

    return {id: build_node(id) for id in root_ids}

async def get_agent_tree_internal(agent_id: Optional[str], workspace: str = "global") -> dict:
    agent_dict = {}
    if agent_id:
        db = Database(workspace=workspace, tab_id=agent_id)
        flat_agents = await db.get("agents")
        if flat_agents:
            agent_dict = build_tree(flat_agents)
    return agent_dict

async def credentials_handler_with_rescan(request: dict) -> dict:
    result = await credentials_handler(request)
    if "error" not in result and request.get("command") in {"add", "update", "set", "delete"}:
        for pid in model_provider_manager.get_credential_sensitive_providers():
            asyncio.create_task(scan_models(pid))
    return result

async def scan_models(provider_id: Optional[str] = None):
    """Scan for available models and update configuration."""
    try:
        if _CONFIG_PATH:
            await model_provider_manager.update_config(_CONFIG_PATH, provider_id)
            return {"success": True, "message": "Models scanned and configuration updated"}
        else:
            return {"success": False, "error": "No config path"}
    except Exception as e:
        logger.error(f"Error scanning models: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

# Background startup tracker
_plugin_watcher = None
_task_watcher_task = None

def find_available_port(host: str, start_port: int, max_attempts: int = 256) -> int:
    """Find an available port starting from start_port."""
    import socket
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError(
        f"No available ports found in range {start_port}–{start_port + max_attempts - 1}"
    )
port = find_available_port("127.0.0.1", 2048)

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"
VITE_PORT = os.getenv("VITE_PORT", "3000")
APP_NAME = os.getenv("APP_NAME", "openchad")

mcp_instance = FastMCP(APP_NAME)
is_windows = os.name == "nt"
uv_binary = "uv.exe" if is_windows else "uv"
_uv_project_dir = os.getenv("OPENCHAD_UV_PROJECT_DIR", "")
_uv_candidate = os.path.join(_uv_project_dir, uv_binary) if _uv_project_dir else ""
uv_path = _uv_candidate if _uv_candidate and os.path.isfile(_uv_candidate) else (shutil.which("uv") or "uv")
is_installing = False

def is_installed(package_name: str) -> bool:
    """Returns True if the package is installed, otherwise False."""
    return importlib.util.find_spec(package_name) is not None


async def _background_startup():
    await mcp_manager.start()
    private_path = os.path.join(_PROJECT_ROOT, "Workspaces", "Private")
    if not os.path.exists(private_path):
        os.makedirs(private_path)
    global_path = os.path.join(_PROJECT_ROOT, "Workspaces", "global")
    if not os.path.exists(global_path):
        os.makedirs(global_path)
    global _plugin_watcher
    try:
        logger.info("Background startup beginning...")
        # Phase 1: Core Initializations
        tool_manager.set_managers(
            model_manager=model_manager,
            tool_manager=tool_manager,
            settings_manager=settings_manager,
            mcp_manager=mcp_manager,
            event_emitter=event_emitter
        )
        startup_tracker.update_status("Initializing core systems...", progress=0.0)
        await asyncio.gather(
            settings_manager.initialize(),
            initialize_credentials()
        )
        # Phase 2: Concurrent Discovery
        startup_tracker.update_status("Discovering plugins and tools...", progress=20.0)
        await asyncio.gather(
            model_manager.discover_backends(),
            pipeline_manager.discover(),
            model_provider_manager.discover_and_load(),
            tool_manager.discover_and_load_all(),
        )
        # Phase 3: Configuration Updates
        startup_tracker.update_status("Configuring models...", progress=60.0)
        if _CONFIG_PATH:
            await model_provider_manager.update_config(_CONFIG_PATH)
            await model_manager.load_config()
        # Phase 4: Plugin Watcher
        startup_tracker.update_status("Initializing plugin watcher...", progress=90.0)
        _plugin_watcher = await create_plugin_watcher(
            mcp_instance=mcp_instance,
            pipeline_manager=pipeline_manager,
            tool_manager=tool_manager,
            model_manager=model_manager,
            mcp_manager=mcp_manager,
            settings_manager=settings_manager,
            event_emitter=event_emitter,
            model_provider_manager=model_provider_manager,
            config_path=_CONFIG_PATH,
            project_root=_PROJECT_ROOT,
            backends_dir=BACKENDS_DIR,
            pipelines_dir=PIPELINES_DIR,
            tools_dir=TOOLS_DIR,
            model_providers_dir=MODEL_PROVIDERS_DIR,
        )
        tool_manager.export_all_tools(mcp_instance)
        
        # Phase 5: Task Watcher
        startup_tracker.update_status("Initializing task watcher...", progress=95.0)
        from .task_watcher import start_task_watcher
        global _task_watcher_task
        _task_watcher_task = asyncio.create_task(start_task_watcher(_PROJECT_ROOT, settings_manager))

        startup_tracker.update_status("Server Ready", is_ready=True)
        logger.info("Background startup complete")
    except Exception as e:
        logger.error(f"Error during background startup: {e}", exc_info=True)
        startup_tracker.update_status(error=str(e))

# Lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic for the application"""
    logger.info("Server starting up (non-blocking)...")
    # Start background initialization
    startup_task = asyncio.create_task(_background_startup())
    yield
    logger.info("Server shutting down...")
    # Cancel startup if it's still running
    if not startup_task.done():
        logger.info("Cancelling background startup...")
        startup_task.cancel()
        try:
            await startup_task
        except asyncio.CancelledError:
            pass
    global _task_watcher_task
    if _task_watcher_task and not _task_watcher_task.done():
        logger.info("Stopping task watcher...")
        _task_watcher_task.cancel()
        try:
            await _task_watcher_task
        except asyncio.CancelledError:
            pass

    if _plugin_watcher:
        _plugin_watcher.stop()
    folder = os.path.join(_PROJECT_ROOT, "Workspaces", "Private")
    if not os.path.exists(folder):
        os.makedirs(folder)
    for filename in os.listdir(folder):
        file_path = os.path.join(folder, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        except Exception as e:
            print('Failed to delete %s. Reason: %s' % (file_path, e))
    await settings_manager.close()
    await close_all_connections()
app = FastAPI(lifespan=lifespan)
app.mount("/mcp", mcp_instance.sse_app())
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Stream Control Registry
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=

# Dictionary to track active streams: msg_id -> list of active task identifiers
active_streams: Dict[str, set] = {}
# Registry of cancel events: msg_id -> asyncio.Event
# Set when stop_stream() is called so pipeline tool loops can abort immediately.
_cancel_events: Dict[str, asyncio.Event] = {}

def register_stream(msg_id: str, task_token: Any = None):
    """Register a new stream as active with an optional unique token."""
    if msg_id:
        if task_token is None:
            task_token = id(asyncio.current_task())
        if msg_id not in active_streams:
            active_streams[msg_id] = set()
        active_streams[msg_id].add(task_token)
        logger.debug(f"Registered stream {msg_id} with token {task_token}")

def unregister_stream(msg_id: str, task_token: Any = None):
    """Unregister a specific task from a stream ID."""
    if not msg_id or msg_id not in active_streams:
        return  # Already removed (e.g. by stop_stream)
    entry = active_streams.get(msg_id)
    if not isinstance(entry, set):
        # Entry was cleared by stop_stream; nothing to do
        return
    if task_token is None:
        task_token = id(asyncio.current_task())
    if task_token in entry:
        entry.remove(task_token)
        logger.debug(f"Unregistered stream {msg_id} token {task_token}")
    if not entry:
        del active_streams[msg_id]

def is_stream_active(msg_id: str, task_token: Any = None) -> bool:
    """Check if the specific task for this stream is still active."""
    if not msg_id:
        return True
    entry = active_streams.get(msg_id)
    if entry is None or entry is False:
        return False
    if task_token is not None:
        return isinstance(entry, set) and task_token in entry
    return bool(entry)  # True if set is non-empty

def stop_stream(msg_id: str) -> bool:
    """Stop a specific stream by ID, removing it so is_stream_active returns False."""
    found = False
    if msg_id and msg_id in active_streams:
        del active_streams[msg_id]  # Remove key so is_stream_active returns False
        found = True
    # Signal cancel event so any in-progress tool call loop aborts immediately
    if msg_id and msg_id in _cancel_events:
        _cancel_events[msg_id].set()
    if found:
        logger.info(f"Stopped stream {msg_id}")
    return found

def _register_cancel_event(msg_id: str) -> asyncio.Event:
    """Create and register a cancel event for a stream."""
    event = asyncio.Event()
    if msg_id:
        _cancel_events[msg_id] = event
    return event

def _unregister_cancel_event(msg_id: str) -> None:
    """Remove the cancel event for a stream after it finishes."""
    if msg_id:
        _cancel_events.pop(msg_id, None)
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Pytauri Command handler
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
commands = Commands()
# Use a fixed connection ID for Tauri subscriptions
# This assumes a single Tauri client context
TAURI_CONN_ID = "tauri_client"

async def pytauri_send_json(data: Dict[str, Any]) -> bool:
    # Emit event to frontend
    event_name = data.get("event", None)
    if event_name:
        await event_emitter.emit(event_name, data)
    return True

async def _setup_pipeline(
    requested_model: Optional[str],
    files: List[str],
    query: Optional[str],
    workspace: str,
    tab_id: Optional[str],
    branch_id: Optional[str],
    response_branch: Optional[str],
    index: Optional[int],
    tb: Optional[str],
    pipeline_name: Optional[str], 
    messages: List[Dict[str, Any]], 
    chat_kwargs: Dict[str, Any],
    database: Database,
    send_event: Optional[Callable[[str, Dict[str, Any]], Awaitable[None]]] = None,
    pricing: Optional[Dict[str, Any]] = None,
    model_name: Optional[str] = None,
    set_continue: Optional[Callable[[bool], None]] = None,
    cancel_event: Optional[asyncio.Event] = None
):
    """Helper to setup pipeline and prepare chat arguments."""
    pipeline = await pipeline_manager.create_instance(
        code_sandbox = code_sandbox,
        model_id=requested_model,
        files=files,
        query=query,
        workspace=workspace, 
        tab_id=tab_id, 
        branch_id=branch_id,
        response_branch=response_branch,
        index=index,
        tb=tb,
        name=pipeline_name,
        tool_manager = tool_manager,
        model_manager = model_manager,
        settings_manager = settings_manager,
        mcp_manager = mcp_manager,
        event_emitter = event_emitter,
        messages = messages,
        args = chat_kwargs,
        send_event = send_event,
        database = database,
        pricing = pricing,
        model_name = model_name,
        set_continue = set_continue,
        cancel_event = cancel_event
        ) if pipeline_name else None
    if pipeline:
        try:
            # Run async setup hook (e.g., database reads that can't happen in __init__)
            await pipeline.setup() 
            chat_kwargs = copy.deepcopy(pipeline.args)
        except Exception as e:
            if pipeline_name:
                await pipeline_manager.record_error(pipeline_name, str(e), "setup")
            pipeline = None
    # Filter out empty tools
    if "tools" in chat_kwargs and not chat_kwargs["tools"]:
        del chat_kwargs["tools"]
    # Remove tool_choice if empty or tools were removed
    if "tool_choice" in chat_kwargs and (
        not chat_kwargs["tool_choice"] or "tools" not in chat_kwargs
    ):
        del chat_kwargs["tool_choice"]
    return pipeline, chat_kwargs 

async def handle_pytauri_chat(msg_id: str, body: Dict[str, Any], app_handle: AppHandle):
    """
    Handle chat completion for PyTauri with event-based streaming.
    This runs as a background task and emits events to the frontend.
    """
    agent = body.get("agent", None)
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    # Event name for this specific stream
    stream_event = f"chat_stream:{msg_id}"
    files = body.get("files", [])
    query = body.get("query", None)
    tab_id = body.get("tab_id", "global")
    branch_id = body.get("branch_id", None)
    response_branch = body.get("response_branch", None)
    index = body.get("index", None)
    tb = body.get("tb", None)
    workspace = body.get("workspace", "global")
    app_name = body.get("app_name")
    db = Database(workspace=workspace, tab_id=tab_id)
    pipeline_name = body.get("pipeline", None)
    
    agent_tree = None   
    agent_model_id = None
    if agent:
        agent_tree: Optional[Dict[str, Any]] = (await get_agent_tree_internal(agent_id=agent, workspace=workspace))
        logger.info("!!!AGENT_TREE: %s", json.dumps(agent_tree))
        agent_ctx.set(agent_tree)
        if agent_tree:
            current_agent_id = next(iter(agent_tree))
            agent_node = agent_tree.get(current_agent_id)
            if agent_node:
                agent_model_id = agent_node.get("model", None)
                logger.info("!!!AGENT_MODEL_ID: %s", agent_model_id)

    requested_model = agent_model_id if agent_model_id else body.get("model", "")    
    

    is_continue = [True]
    cancel_event = _register_cancel_event(msg_id)
    # Prepare kwargs
    chat_kwargs = {k: v for k, v in body.items() if k not in [
        "model",
        "messages",
        "stream",
        "id",
        "files",
        "query",
        "tab_id",
        "branch_id",
        "response_branch",
        "index",
        "tb",
        "workspace",
        "app_name",
        "pipeline",
        "agent",
        "max_retries"
    ]}
    agent_tree: Optional[Dict[str, Any]] = (await get_agent_tree_internal(agent_id=agent, workspace=workspace))
    agent_ctx.set(agent_tree)
    pipeline, chat_kwargs = await _setup_pipeline(
        requested_model=requested_model,
        files=files,
        query=query,
        workspace=workspace,
        tab_id=tab_id,
        branch_id=branch_id,
        response_branch=response_branch,
        index=index,
        tb=tb,
        pipeline_name=pipeline_name,
        messages=messages,
        chat_kwargs=chat_kwargs,
        database=db, 
        pricing=model_manager.get_pricing(requested_model),
        model_name=model_manager.get_model_name(requested_model),
        set_continue=lambda v: is_continue.__setitem__(0, v),
        cancel_event=cancel_event,
    )
    workspace_ctx.set(workspace)
    tab_id_ctx.set(tab_id)
    model_id_ctx.set(requested_model)
    logger.info("!!!Pipeline: %s", pipeline)
    logger.info("!!!Pipeline chat_kwargs: %s", chat_kwargs)
    logger.info("!!!Pipeline paramters: model=%s, files=%s, query=%s, tab_id=%s, branch_id=%s, response_branch=%s, index=%s, tb=%s, workspace=%s, app_name=%s, pipeline_name=%s", requested_model, files, query, tab_id, branch_id, response_branch, index, tb, workspace, app_name, pipeline_name)
    try:
        # Check for model parameter and load if needed
        if not model_manager.is_loaded(requested_model):
            model_data = await model_manager.get_model_from_config(requested_model)
            if model_data:
                try:
                    filename = model_data.get("filename")
                    backend = model_data.get("backend")
                    name = model_data.get("name", requested_model)
                    model_type = model_data.get("model_type", "llm")
                    model_path = model_data.get("model_path")
                    # Extract other kwargs
                    kwargs = {k: v for k, v in model_data.items() if k not in ["set_as_default", "backend", "model_type", "model_path", "filename", "name", "last_error"]}
                    await model_manager.load(
                            requested_model,
                            filename=filename,
                            backend=backend,
                            name=name,
                            model_type=model_type,
                            model_path=model_path,
                            set_as_default=False,
                            **kwargs,
                    )
                except Exception as e:
                    raise Exception(f"Error loading model {requested_model}: {e}")
            else: 
                raise Exception(f"Model {requested_model} not found")
        register_stream(msg_id)
        while is_continue[0]:
            is_continue[0] = False
            stopped = False
            if stream:  
                chunk_count = 0
                if pipeline:
                    await pipeline.start(**chat_kwargs)
                    messages = copy.deepcopy(pipeline.messages)
                    chat_kwargs = copy.deepcopy(pipeline.args)
                if not messages:
                    messages = [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ]
                max_retries = body.get("max_retries", 99)
                max_retries_ctx.set(max_retries)
                retry_delay = 1.0
                for attempt in range(max_retries):
                    if pipeline and pipeline.cancel_event and pipeline.cancel_event.is_set():
                        break
                    try:
                        logger.info(f"Stream {msg_id} starting chat with messages (attempt {attempt + 1}): {json.dumps(messages, default=str)}")
                        gen = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=True, **chat_kwargs)
                        assert hasattr(gen, "__aiter__"), "Expected async generator from model_manager.chat"
                        gen = cast(AsyncGenerator[Any, Any], gen)
                        async for chunk in gen:
                            chunk_count += 1                    
                            # Check if stream was stopped externally
                            if not is_stream_active(msg_id):
                                logger.info(f"Stream {msg_id} stopped externally after {chunk_count} chunks")
                                is_continue[0] = False
                                stopped = True
                                break
                            if chunk:
                                # Run pipeline               
                                process_chunk = None
                                if pipeline: 
                                    try:
                                        process_chunk = await pipeline.process_chunk(chunk, **chat_kwargs)
                                    except Exception as e:
                                        if pipeline_name:
                                            await pipeline_manager.record_error(pipeline_name, e, "process_chunk")
                                        pipeline = None # Disable pipeline on error
                                        stopped = True
                                process_chunk = chunk if not process_chunk else process_chunk
                                if process_chunk is not None:
                                    if isinstance(process_chunk, dict):
                                        delta = process_chunk.get('choices', [{}])[0].get('delta', {})
                                        is_stop = delta.get('stop')
                                        if is_stop:                      
                                            await event_emitter.emit(stream_event, {"response": process_chunk, "stream_end": False})
                                            stopped = True
                                            break
                                        is_force_stop = delta.get('force_stop')
                                        if is_force_stop:                      
                                            await event_emitter.emit(stream_event, {"response": process_chunk, "stream_end": False})
                                            stopped = True
                                            is_continue[0] = False
                                            break                       
                                await event_emitter.emit(stream_event, {"response": process_chunk, "stream_end": False})
                        # Successfully finished streaming without exceptions
                        break
                    except Exception as e:
                        is_mid_stream = "MidStreamFallbackError" in type(e).__name__ or "MidStreamFallbackError" in str(e)
                        is_retryable = is_mid_stream or "RateLimitError" in type(e).__name__ or "APIError" in type(e).__name__ or "provider_unavailable" in str(e)
                        if is_retryable and attempt < max_retries - 1:
                            logger.warning(
                                f"Stream {msg_id} failed with {type(e).__name__} (attempt {attempt + 1}/{max_retries}). "
                                f"Clearing current partial response and retrying..."
                            )
                            if pipeline:
                                try:
                                    await pipeline.reset()
                                except Exception as reset_err:
                                    logger.error(f"Error resetting pipeline state: {reset_err}", exc_info=True)
                            
                            await asyncio.sleep(retry_delay * (attempt + 1))
                            chunk_count = 0
                            stopped = False
                            continue
                        raise

                if pipeline:
                    await pipeline.end(**chat_kwargs)
                    pipeline.attempt += 1
                # If the stream was stopped externally, pipeline.end() may have called
                # set_continue(True) because tool_calls were mid-accumulation.
                # Force-override that here so the while loop does NOT restart.
                if stopped:
                    is_continue[0] = False
                logger.info(f"Stream {msg_id} loop finished. Total chunks: {chunk_count}")
                # Only finalize if we didn't stop early due to tool calls or user stop
                if is_stream_active(msg_id) and not stopped and pipeline:
                    try:
                        remaining = await pipeline.finalize(**chat_kwargs)
                        if remaining:
                            await event_emitter.emit(stream_event, {"response": remaining, "stream_end": False})
                    except Exception as e:
                        if pipeline_name:
                            await pipeline_manager.record_error(pipeline_name, e, "finalize")
                # Process next query from queue or finish
                if not is_continue[0]:
                    await event_emitter.emit(stream_event, {"stream_end": True})
                    break
            else:
                # Non-streaming
                if pipeline:
                    await pipeline.start(**chat_kwargs)
                    messages = copy.deepcopy(pipeline.messages)
                    chat_kwargs = copy.deepcopy(pipeline.args)
                if not messages:
                    messages = [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ]                    
                response = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=True, **chat_kwargs)
                pipeline_response = None
                if pipeline:
                    try:
                        pipeline_response = await pipeline.response(response, **chat_kwargs)
                    except Exception as e:
                        if pipeline_name:
                            await pipeline_manager.record_error(pipeline_name, e, "response")
                if pipeline:
                    await pipeline.end(**chat_kwargs)
                    pipeline.attempt += 1
                # Process next query from queue or finish
                if not is_continue[0]:
                    await event_emitter.emit(stream_event, {"response": response, "stream_end": True})
                    break
    except Exception as e:
        logger.error(f"Error in PyTauri chat stream {msg_id}: {e}", exc_info=True)
        await event_emitter.emit(stream_event, {"error": str(e), "stream_end": True})
    finally:
        if pipeline:
            await pipeline.stop(**chat_kwargs)
        if msg_id:
            unregister_stream(msg_id)
            _unregister_cancel_event(msg_id)

@commands.command()
async def pytauri_command(body: Dict[str, Any], app_handle: AppHandle) -> Dict[str, Any]:
    # Register the AppHandle once so event_emitter knows it's running inside Tauri.
    # This is safe to call on every command  it's a cheap global assignment.
    command = body.get("command")
    request = body.get("request") or {}  
    global is_installing
    try:
        match command:
            case 'emit':
                name = request.get("name")
                payload = request.get("payload")
                if name:
                    await event_emitter.emit(name, payload)
                return {'result': 'ok'}
            case 'get_agent_tree':
                agent_id = request.get("agentId", None)
                workspace = request.get("workspace", "global")
                agent_dict = await get_agent_tree_internal(agent_id, workspace)
                return {'tree': agent_dict}                
            case 'check_backend':
                try:                    
                    return { 'is_installing': is_installing, 'is_installed': is_installed('llama_cpp') 
                    and 
                    (is_installed('mlx-lm') if sys.platform == "darwin" else True) 
                    and
                    (is_installed('mlx-vlm') if sys.platform == "darwin" else True) }
                except Exception as e:  
                    return {'error': str(e)}
            case 'install_local_backend':
                try:                    
                    packages = []
                    if not is_installed('llama_cpp'):
                        packages.append('llama-cpp-python')
                    if not is_installed('mlx-lm') and sys.platform == "darwin":
                        packages.append('mlx-lm')
                    if not is_installed('mlx-vlm') and sys.platform == "darwin":
                        packages.append('mlx-vlm')

                    if packages:
                        async def _do_install():
                            global is_installing
                            try:
                                proc = await asyncio.create_subprocess_exec(
                                    uv_path, "add", *packages,
                                )
                                is_installing = True
                                returncode = await proc.wait()
                                if returncode == 0:
                                    is_installing = False
                                    await event_emitter.emit('backend-installed', {'success': True})
                                else:
                                    is_installing = False
                                    await event_emitter.emit('backend-installed', {'error': True, 'returncode': returncode})
                            except Exception as ex:
                                logger.error(f"install_local_backend failed: {ex}", exc_info=True)
                                await event_emitter.emit('backend-installed', {'error': str(ex)})
                            finally:
                                is_installing = False
                        asyncio.create_task(_do_install())
                    else:
                        # Already installed
                        await event_emitter.emit('backend-installed', {'success': True})

                    return {'result': 'ok'}
                except Exception as e:  
                    return {'error': str(e)}
            case 'eval': 
                script = request.get("script")
                label = request.get("label")
                if label and script: 
                    try:
                        await event_emitter.emit("eval", {"script": script, "label": label})
                    except Exception as e:
                        logger.error(f"Error evaluating script in window {label}: {e}", exc_info=True)
                        return {"error": str(e)}
                return {'result': 'ok'}
            case 'set_active':
                w = request.get("workspace")
                tid = request.get("tab_id")
                if w and tid:
                    tool_manager.set_active(w, tid)
                return {'result': 'ok'}
            case "sqlite":
                res = await sqlite(request)
                if request.get("command") in ("sync_table", "execute") and "error" not in res:
                    try:
                        db = request.get("db")
                        table = request.get("table")
                        if db and table:
                            await trigger_table_update(db, table)
                    except Exception as e:
                        logger.error(f"Failed to trigger table update: {e}", exc_info=True)
                return res
            case "db_subscribe":
                db = request.get("db")
                table = request.get("table")
                if db and table:
                    return await subscribe_db(TAURI_CONN_ID, db, table)
                else:
                    return {"error": "Missing 'db' or 'table' parameter"}
            case "db_unsubscribe":
                db = request.get("db")
                table = request.get("table")
                if db and table:
                    return await unsubscribe_db(TAURI_CONN_ID, db, table)
                else:
                    return {"error": "Missing 'db' or 'table' parameter"}
            case "file":
                return await file_handler(request)
            case "file_subscribe":
                filename = request.get("filename")
                base_dir = request.get("base_dir", ".")
                if filename:
                    return await subscribe_file(TAURI_CONN_ID, filename, base_dir)
                else:
                    return {"error": "Missing 'filename' parameter"}
            case "file_unsubscribe":
                filename = request.get("filename")
                base_dir = request.get("base_dir", ".")
                if filename:
                    return await unsubscribe_file(TAURI_CONN_ID, filename, base_dir)
                else:
                    return {"error": "Missing 'filename' parameter"}
            case "folder":
                return await folder_handler(request)
            case "folder_subscribe":
                path = request.get("path")
                base_dir = request.get("base_dir", ".")
                if path:
                    return await subscribe_folder(TAURI_CONN_ID, path, base_dir)
                else:
                    return {"error": "Missing 'path' parameter"}
            case "folder_unsubscribe":
                path = request.get("path")
                base_dir = request.get("base_dir", ".")
                if path:
                    return await unsubscribe_folder(TAURI_CONN_ID, path, base_dir)
                else:
                    return {"error": "Missing 'path' parameter"}
            case "credentials":
                return await credentials_handler_with_rescan(request)
            # Chat commands
            case "v1/chat/completions":
                msg_id = request.get("id")
                if not msg_id:
                    return {"error": "Missing 'id' parameter"}
                # Start chat processing in background
                # Fire and forget - results will be streamed via events
                asyncio.create_task(handle_pytauri_chat(msg_id, request, app_handle))
                return {"status": "processing", "id": msg_id, "stream_end": False}
            case "v1/chat/stop":
                target_id = request.get("id")
                if not target_id: return {"error": "Missing 'id' parameter"}
                success = stop_stream(target_id)
                return {"success": success, "id": target_id}
            case "v1/chat/status":
                target_id = request.get("id")
                if not target_id: return {"error": "Missing 'id' parameter"}
                active = is_stream_active(target_id)
                return {"active": active, "id": target_id}
            case "v1/models/unload":
                model_id = request.get("model_id")
                if not model_id:
                    return {"error": "Missing 'model_id' parameter"}
                return await model_manager.unload(model_id)
            case "v1/models/unload_all":
                return await model_manager.unload_all()
            case "v1/models/scan":
                return await scan_models()
            case "v1/check":
                result = False                
                if len(active_streams.keys()) == 0:
                    result = True
                return {'result': result}
            # Tool commands
            case "tools":
                return {"tools": tool_manager.get_openai_schemas()}
            case "tools/claude":
                return {"tools": tool_manager.list_tools()}
            case "tools/schemas":
                return {"schemas": tool_manager.get_schemas()}
            case "tools/execute":
                try:
                    tool_name = request.get("tool")
                    workspace = request.get("workspace", "global")
                    tab_id = request.get("tabId", "global")
                    requested_model = request.get("model", None)
                    workspace_ctx.set(workspace)
                    tab_id_ctx.set(tab_id)
                    model_id_ctx.set(requested_model)
                    if not tool_name:
                        return {"error": "Missing 'tool' parameter"}
                    # Extract tool arguments (everything except 'tool')
                    kwargs = {k: v for k, v in request.items() if k != "workspace" and k != "tabId"}
                    return await tool_manager.execute_tool(tool_name, caller="direct", workspace=workspace, tab_id=tab_id, **kwargs)
                except Exception as e:
                    logger.error(f"Failed to execute tool: {e}", exc_info=True)
                    return {"error": str(e)}
            case "tools/reload":
                tool_name = request.get("tool")
                if not tool_name:
                    return {"error": "Missing 'tool' parameter"}
                success = tool_manager.reload_tool(tool_name)
                return {"success": success, "tool": tool_name}
            case "get_last_startup_status":
                return startup_tracker.get_status()
            # Settings commands
            case "settings/get":
                key = request.get("key")
                if not key:
                    return {"error": "Missing 'key' parameter"}
                value = await settings_manager.get(key)
                return {"key": key, "value": value}
            case "settings/get_all":
                settings = await settings_manager.get_all()
                return {"settings": settings}
            case "settings/set":
                key = request.get("key")
                value = request.get("value")
                if not key:
                    return {"error": "Missing 'key' parameter"}
                success = await settings_manager.set(key, value)
                return {"success": success, "key": key}
            case "settings/reset":
                key = request.get("key")
                if not key:
                    return {"error": "Missing 'key' parameter"}
                success = await settings_manager.reset(key)
                return {"success": success, "key": key}
            case "settings/sources":
                sources = await settings_manager.get_sources()
                return {"sources": sources}
            case "settings/subscribe":
                return await subscribe_settings(TAURI_CONN_ID)
            case "settings/unsubscribe":
                return await unsubscribe_settings(TAURI_CONN_ID)
            case "os":
                return {'os': sys.platform}
            case "mcp_tool":
                return {"tools": mcp_manager.get_openai_schemas()}
            case "mcp_tool/reload":
                server_name = request.get("server_name")
                if server_name: 
                    await mcp_manager.reload_mcp_server(server_name)
                    return {'result': 'ok'}
                return {'error': 'server_name is required'}
            case "mcp_tool/statuses":
                return {'statuses': mcp_manager.mcp_statuses}
            case "get_plugin_dirs":
                return get_plugin_dirs()
            case "check_tauri":
                return {"tauri": True}
            case _:
                return {"error": f"Unknown command: {command}"}
    except Exception as e:
        logger.error(f"Error in PyTauri command {command}: {e}", exc_info=True)
        return {"error": str(e)}           
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# API Endpoints
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=

@app.get("/file/{filepath:path}")
async def file_endpoint(
    request: Request,
    filepath: str,
    width: int = 0,
    height: int = 0,
    quality: int = 85,
    bitrate: str = "",
    resolution: str = "",
    fps: int = 0,
    thumbnail: bool = False,
    thumb_time: str = "00:00:01",
    format: str = "",
    download: bool = False,
):
    """Universal file endpoint with async-safe processing"""
    file_path = unquote(filepath)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    mime_type, _ = mimetypes.guess_type(file_path)
    try:
        # Handle images
        if mime_type and mime_type.startswith("image/"):
            if width or height or format:
                # Wrap sync CPU bound processing in thread
                return await asyncio.to_thread(process_image, file_path, width, height, quality, format)
        # Handle audio
        elif mime_type and mime_type.startswith("audio/"):
            if bitrate or format:
                return await asyncio.to_thread(process_audio, file_path, bitrate, format)
            return range_requests_response(request, file_path)
        # Handle video
        elif mime_type and mime_type.startswith("video/"):
            if thumbnail:
                temp_path, mime = await asyncio.to_thread(generate_video_thumbnail, file_path, thumb_time)
                try:
                    # Async read of thumbnail
                    async with aiofiles.open(temp_path, "rb") as f:
                        thumbnail_data = await f.read()
                    return Response(
                        content=thumbnail_data,
                        media_type=mime,
                        headers={"Cache-Control": "max-age=3600"},
                    )
                finally:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)
            if resolution or fps or format:
                temp_path, mime = await asyncio.to_thread(process_video, file_path, resolution, fps, format)
                return stream_processed_video(request, temp_path, mime)
            return range_requests_response(request, file_path)
        # Default file response
        headers = {}
        if download:
            filename = os.path.basename(file_path)
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return FileResponse(file_path, headers=headers)
    except Exception as e:
        logger.error(f"Error processing file {file_path}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/check_backend")
async def check_backend_api():
    """Check if the backend is installed."""
    try:
        installed = is_installed('llama_cpp') and (is_installed('mlx-lm') if sys.platform == "darwin" else True) and (is_installed('mlx-vlm') if sys.platform == "darwin" else True)
        return {'is_installed': installed, 'is_installing': is_installing}
    except Exception as e:
        logger.error(f"Error checking backend: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/install_local_backend")
async def install_local_backend_api():
    """Install the local backend."""
    try:
        packages = []
        if not is_installed('llama_cpp'):
            packages.append('llama-cpp-python')
        if not is_installed('mlx-lm') and sys.platform == "darwin":
            packages.append('mlx-lm')
        if not is_installed('mlx-vlm') and sys.platform == "darwin":
            packages.append('mlx-vlm')

        if packages:
            async def _do_install():
                global is_installing
                try:
                    proc = await asyncio.create_subprocess_exec(
                        uv_path, "add", *packages,
                    )
                    is_installing = True
                    returncode = await proc.wait()
                    if returncode == 0:
                        is_installing = False
                        await event_emitter.emit('backend-installed', {'success': True})
                    else:
                        is_installing = False
                        await event_emitter.emit('backend-installed', {'error': True, 'returncode': returncode})
                except Exception as ex:
                    logger.error(f"install_local_backend_api failed: {ex}", exc_info=True)
                    await event_emitter.emit('backend-installed', {'error': str(ex)})
            asyncio.create_task(_do_install())
        else:
            await event_emitter.emit('backend-installed', {'success': True})

        return {'result': 'ok'}
    except Exception as e:
        logger.error(f"Error installing local backend: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/get_last_startup_status")
async def get_last_startup_status_api():
    """Get the last recorded startup status and logs."""
    return startup_tracker.get_status()

@app.post("/api/folder")
async def folder_endpoint_api(request: dict):
    return await folder_handler(request)

@app.post("/api/file")
async def file_endpoint_api(request: dict):
    return await file_handler(request)

@app.post("/api/sqlite")
async def sqlite_endpoint_api(request: dict):
    response = await sqlite(request)
    db = request.get("db")
    table = request.get("table")
    if request.get("command") in ("sync_table", "execute") and "error" not in response and db and table:
        try:
            await trigger_table_update(db, table)
        except Exception as e:
            logger.error(f"Failed to trigger table update: {e}", exc_info=True)
    return response

@app.post("/api/credentials")
async def credentials_endpoint_api(request: Request):
    """Credentials CRUD operations."""
    try:
        body = await request.json()
    except:
        return {"error": "Invalid JSON body"}
    return await credentials_handler_with_rescan(body)
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Settings API Endpoints
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=

@app.post("/api/settings/get")
async def settings_get_api(request: dict):
    key = request.get("key")
    if not key: return {"error": "Missing 'key' parameter"}
    value = await settings_manager.get(key)
    return {"key": key, "value": value}

@app.post("/api/settings/get_all")
async def settings_get_all_api(request: dict):
    settings = await settings_manager.get_all()
    return {"settings": settings}

@app.post("/api/settings/set")
async def settings_set_api(request: dict):
    key = request.get("key")
    value = request.get("value")
    if not key: return {"error": "Missing 'key' parameter"}
    success = await settings_manager.set(key, value)
    return {"success": success, "key": key}

@app.post("/api/settings/reset")
async def settings_reset_api(request: dict):
    key = request.get("key")
    if not key: return {"error": "Missing 'key' parameter"}
    success = await settings_manager.reset(key)
    return {"success": success, "key": key}

@app.post("/api/settings/sources")
async def settings_sources_api(request: dict):
    sources = await settings_manager.get_sources()
    return {"sources": sources}

@app.api_route("/api/proxy", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_endpoint_api(request: Request):
    return await proxy_handler(request)
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Tools API Endpoints
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=

@app.get("/api/tools")
async def list_tools():
    """List all available tools with their schemas."""
    return {"tools": tool_manager.list_tools()}

@app.get("/api/tools/schemas")
async def get_tool_schemas():
    """Get Claude API compatible tool schemas."""
    return {"schemas": tool_manager.get_schemas()}

@app.post("/api/tools/execute")
async def execute_tool_api(request: Request):
    """
    Execute a tool with explicit tool name in body.
    Body: {"tool": "counter", "action": "increment", "value": 5}
    """
    try:
        body = await request.json()
    except:
        return {"error": "Invalid JSON body"}
    try:
        tool_name = body.get("tool")
        workspace = body.get("workspace", "global")
        tab_id = body.get("tabId", "global")
        requested_model = body.get("model", None)
        workspace_ctx.set(workspace)
        tab_id_ctx.set(tab_id)
        model_id_ctx.set(requested_model)
        if not tool_name:
            return {"error": "Missing 'tool' parameter"}
        # Extract tool arguments (everything except 'tool')
        kwargs = {k: v for k, v in body.items() if k != "workspace" and k != "tabId"}
        return await tool_manager.execute_tool(tool_name, caller="direct", workspace=workspace, tab_id=tab_id, **kwargs)
    except Exception as e:
        logger.error(f"Failed to execute tool: {e}", exc_info=True)
        return {"error": str(e)}

@app.post("/api/tools/reload")
async def reload_tool_api(request: Request):
    """Hot reload a tool. Body: {"tool": "counter"}"""
    try:
        body = await request.json()
    except:
        return {"error": "Invalid JSON body"}
    tool_name = body.get("tool")
    if not tool_name:
        return {"error": "Missing 'tool' parameter"}
    success = tool_manager.reload_tool(tool_name)
    return {"success": success, "tool": tool_name}

@app.get("/Apps/{path_name:path}")
async def serve_app_components(path_name: str):
    # Resolve the full path and ensure it stays within APPS_DIR
    base = os.path.realpath(APPS_DIR)
    file_path = os.path.realpath(os.path.join(base, path_name))
    if not file_path.startswith(base):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"App not found: {path_name}")
    return FileResponse(file_path, media_type="application/typescript")

@app.post("/api/v1/chat/stop")
async def stop_chat_stream_api(request: Request):
    """Stop a running chat stream by ID."""
    try:
        data = await request.json()
        msg_id = data.get("id")
        if not msg_id:
            return {"error": "Missing 'id' parameter"}
        success = stop_stream(msg_id)
        return {"success": success, "id": msg_id}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/v1/chat/status")
async def check_chat_stream_status_api(request: Request):
    """Check if a chat stream is active."""
    try:
        data = await request.json()
        msg_id = data.get("id")
        if not msg_id:
            return {"error": "Missing 'id' parameter"}
        active = is_stream_active(msg_id)
        return {"active": active, "id": msg_id}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/v1/models/unload")
async def unload_model_api(request: Request):
    """Unload a specific model."""
    try:
        data = await request.json()
        model_id = data.get("model_id")
        if not model_id:
            return {"error": "Missing 'model_id' parameter"}
        return await model_manager.unload(model_id)
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/v1/models/unload_all")
async def unload_all_models_api():
    """Unload all models."""
    try:
        return await model_manager.unload_all()
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/v1/models/scan")
async def scan_models_api():
    """Scan for available models and update configuration."""
    return await scan_models()

@app.get("/api/get_plugin_dirs")
async def get_plugin_dirs_api():
    """Return absolute paths for all plugin and data directories."""
    return get_plugin_dirs()

@app.post("/api/v1/check")
async def check_api():
    result = False                
    if len(active_streams.keys()) == 0:
        result = True
    return {'result': result}

@app.post("/api/os")
async def os_api(request: Request):
    return {'os': sys.platform}

@app.post("/api/mcp_tool")
async def mcp_tool_api(request: Request):
    return {"tools": mcp_manager.get_openai_schemas()}

@app.post("/api/mcp_tool/reload")        
async def mcp_tool_reload_api(request: Request):
    try:
        data = await request.json()
        server_name = data.get("server_name")
        if server_name: 
            await mcp_manager.reload_mcp_server(server_name)
            return {'result': 'ok'}
        return {'error': 'server_name is required'}
    except Exception as e:
        return {'error': str(e)}

@app.post("/api/agent/tree")
async def get_agent_tree_api(request: Request):
    """Retrieve agent tree structure."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    agent_id = body.get("agentId", None)
    workspace = body.get("workspace", "global")
    agent_dict = await get_agent_tree_internal(agent_id, workspace)
    return {'tree': agent_dict}

@app.post('/api/eval')
async def eval_api(request: Request):
    """
    Evaluate a script.
    """
    return {'error': 'eval command is not supported from HTTP Request'}

@app.post("/api/mcp_tool/statuses")
async def mcp_tool_statuses_api(request: Request):
    return {'statuses': mcp_manager.mcp_statuses}

@app.post("/api/v1/chat/completions")
async def chat_endpoint_api(request: Request):
    """
    Chat completions with tool support and robust handling loop.
    """
    try:
        data = await request.json()
        agent = data.get("agent", None)
        messages = data.get("messages", [])
        stream = data.get("stream", False)
        msg_id = data.get("id") # Optional message ID for control
        files = data.get("files", [])
        query = data.get("query", None)
        tab_id = data.get("tab_id", "global")
        branch_id = data.get("branch_id", None)
        response_branch = data.get("response_branch", None)
        index = data.get("index", None)
        tb = data.get("tb", None)
        workspace = data.get("workspace", "global")
        app_name = data.get("app_name")
        db = Database(workspace=workspace, tab_id=tab_id)
        if msg_id:
            register_stream(msg_id)
        cancel_event = _register_cancel_event(msg_id) if msg_id else asyncio.Event()
        
        # Check for model parameter and load if needed
        agent_tree = None 
        agent_model_id = None

        if agent:
            agent_tree: Optional[Dict[str, Any]] = (await get_agent_tree_internal(agent_id=agent, workspace=workspace))
            agent_ctx.set(agent_tree)
            if agent_tree:
                current_agent_id = next(iter(agent_tree))
                agent_node = agent_tree.get(current_agent_id)
                if agent_node:
                    agent_model_id = agent_node.get("model", None)

        requested_model = agent_model_id if agent_model_id else data.get("model")       
        if not model_manager.is_loaded(requested_model):
            model_data = await model_manager.get_model_from_config(requested_model)
            if model_data:
                try:
                    filename = model_data.get("filename")
                    backend = model_data.get("backend")
                    name = model_data.get("name", requested_model)
                    model_type = model_data.get("model_type", "llm")
                    model_path = model_data.get("model_path")
                    # Extract other kwargs
                    kwargs = {k: v for k, v in model_data.items() if k not in ["set_as_default", "backend", "model_type", "model_path", "filename", "name", "last_error"]}
                    await model_manager.load(
                            requested_model,
                            filename=filename,
                            backend=backend,
                            name=name,
                            model_type=model_type,
                            model_path=model_path,
                            set_as_default=False,
                            **kwargs,
                    )
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Error loading model {requested_model}: {e}")
            else: 
                raise HTTPException(status_code=400, detail=f"Model {requested_model} not found")
        # Prepare kwargs
        chat_kwargs = {k: v for k, v in data.items() if k not in [
            "model",
            "messages",
            "stream",
            "id",
            "files",
            "query",
            "tab_id",
            "branch_id",
            "response_branch",
            "index",
            "tb",
            "workspace",
            "app_name",
            "pipeline",
            "agent"
        ]}
        pipeline_name = data.get("pipeline", None)
        is_continue = [True]

        pipeline, chat_kwargs = await _setup_pipeline(
            requested_model=requested_model,
            files=files,
            query=query,
            workspace=workspace,
            tab_id=tab_id,
            branch_id=branch_id,
            response_branch=response_branch,
            index=index,
            tb=tb,
            pipeline_name=pipeline_name,
            messages=messages,
            chat_kwargs=chat_kwargs,
            database=db,
            pricing=model_manager.get_pricing(requested_model),
            model_name=model_manager.get_model_name(requested_model),
            set_continue=lambda v: is_continue.__setitem__(0, v),
            cancel_event=cancel_event,
        )
        workspace_ctx.set(workspace)
        tab_id_ctx.set(tab_id)
        model_id_ctx.set(requested_model)
        if stream:
            async def iter_response():
                nonlocal messages, pipeline, chat_kwargs
                try:
                    while is_continue[0]:  
                        is_continue[0] = False   
                        stopped = False
                        chunk_count = 0
                        if pipeline:
                            await pipeline.start(**chat_kwargs)
                            messages = copy.deepcopy(pipeline.messages)
                            chat_kwargs = copy.deepcopy(pipeline.args)
                        if not messages:
                            messages = [
                                {
                                    "role": "system",
                                    "content": "You are a helpful assistant."
                                },
                                {
                                    "role": "user",
                                    "content": query
                                }
                            ]                            
                        logger.info(f"API Stream {msg_id} starting chat with messages: {json.dumps(messages, default=str)}")
                        response_generator = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=True, **chat_kwargs)
                        assert hasattr(response_generator, "__aiter__"), "Expected async generator from model_manager.chat"
                        response_generator = cast(AsyncGenerator[Any, Any], response_generator)
                        async for chunk in response_generator:
                            chunk_count += 1
                            _diag_delta = chunk.get('choices', [{}])[0].get('delta', {}) if isinstance(chunk, dict) else chunk
                            _diag_finish = chunk.get('choices', [{}])[0].get('finish_reason') if isinstance(chunk, dict) else None
                            logger.warning(f"API DIAGNOSTIC | {msg_id} | Chunk {chunk_count} | delta={_diag_delta} | finish_reason={_diag_finish}")
                            # Check if stream was stopped externally
                            if msg_id and not is_stream_active(msg_id):
                                logger.info(f"API Stream {msg_id} stopped externally after {chunk_count} chunks")
                                break
                            if chunk:
                                process_chunk = None
                                if pipeline:
                                    try:
                                        process_chunk = await pipeline.process_chunk(chunk, **chat_kwargs)
                                    except Exception as e:
                                        await pipeline_manager.record_error(pipeline_name, e, "process_chunk")
                                        pipeline = None
                                        stopped = True
                                process_chunk = chunk if not process_chunk else process_chunk
                                if process_chunk is not None:
                                    if isinstance(process_chunk, dict):
                                        delta = process_chunk.get('choices', [{}])[0].get('delta', {})
                                        is_stop = delta.get('stop')
                                        if is_stop:   
                                            yield json.dumps(process_chunk)
                                            stopped = True
                                            break
                                        is_force_stop = delta.get('force_stop')
                                        if is_force_stop:                      
                                            yield json.dumps(process_chunk)
                                            stopped = True
                                            is_continue[0] = False
                                            break     
                                        yield json.dumps(process_chunk)
                                    else:
                                        yield str(process_chunk)
                        if pipeline:
                            await pipeline.end(**chat_kwargs)
                            pipeline.attempt += 1
                        logger.info(f"API Stream {msg_id} loop finished. Total chunks: {chunk_count}")
                        # Only finalize if we didn't stop early due to tool calls or user stop
                        if (not msg_id or is_stream_active(msg_id)) and not stopped and pipeline:
                           try:
                               remaining = await pipeline.finalize(**chat_kwargs)
                               if remaining:
                                    yield json.dumps(remaining) if isinstance(remaining, dict) else str(remaining)
                           except Exception as e:
                               await pipeline_manager.record_error(pipeline_name, e, "finalize")
                        if not is_continue[0]:
                            break
                except Exception as e:                  
                    yield f"Error: {str(e)}"
                finally:
                    if pipeline:
                        await pipeline.stop(**chat_kwargs)
                    if msg_id:
                        unregister_stream(msg_id)
                        _unregister_cancel_event(msg_id)
            return StreamingResponse(iter_response(), media_type="text/plain")
        else:
            try:
                while is_continue[0]:
                    is_continue[0] = False
                    # Non-streaming with potential tool execution loop
                    # model_manager.chat is now async
                    if pipeline:
                        await pipeline.start(**chat_kwargs)
                        messages = copy.deepcopy(pipeline.messages)
                        chat_kwargs = copy.deepcopy(pipeline.args)
                    if not messages:
                        messages = [
                                {
                                    "role": "system",
                                    "content": "You are a helpful assistant."
                                },
                                {
                                    "role": "user",
                                    "content": query
                                }
                            ]
                    response = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=False, **chat_kwargs)
                    pipeline_response = None
                    if pipeline:
                        try:
                            pipeline_response = await pipeline.response(response, **chat_kwargs)
                        except Exception as e:
                            await pipeline_manager.record_error(pipeline_name, e, "response")    
                    if pipeline:
                        await pipeline.end(**chat_kwargs)
                        pipeline.attempt += 1
                    # Process next query from queue or finish
                    if not is_continue[0]:
                        return response
            except Exception as e: 
                raise HTTPException(status_code=500, detail=str(e))
            finally:
                if pipeline:
                    await pipeline.stop(**chat_kwargs)
                if msg_id:
                    unregister_stream(msg_id)
                    _unregister_cancel_event(msg_id)
    except Exception as e:
        logger.error(f"Chat error: {e}")   
        raise HTTPException(status_code=500, detail=str(e))
    
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# WebSocket Handler
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
async def handle_ws_command(conn_id: str, data: dict, send_func: Callable[[dict], Awaitable[bool]]) -> dict:
    """Modular command handler for WebSocket"""
    api = data.get("api")
    body = data.get("body", {})
    msg_id = data.get("id", "")
    try:
        match api:
            case 'emit':
                name = body.get("name")
                payload = body.get("payload")
                if name:                   
                    await event_emitter.emit(name, payload)
                return {'result': 'ok'}
            case 'get_agent_tree':
                agent_id = body.get("agentId", None)
                workspace = body.get("workspace", "global")
                agent_dict = await get_agent_tree_internal(agent_id, workspace)
                return {'tree': agent_dict}
            case 'check_backend':
                try:                    
                    return { 'is_installing': is_installing, 'installed': is_installed('llama_cpp') 
                    and 
                    (is_installed('mlx-lm') if sys.platform == "darwin" else True) 
                    and
                    (is_installed('mlx-vlm') if sys.platform == "darwin" else True)
                    }
                except Exception as e:  
                    return {'error': str(e)}
            case 'install_local_backend':
                try:                    
                    packages = []
                    if not is_installed('llama_cpp'):
                        packages.append('llama-cpp-python')
                    if not is_installed('mlx-lm') and sys.platform == "darwin":
                        packages.append('mlx-lm')
                    if not is_installed('mlx-vlm') and sys.platform == "darwin":
                        packages.append('mlx-vlm')

                    if packages:
                        async def _do_install():
                            global is_installing
                            try:
                                proc = await asyncio.create_subprocess_exec(
                                    uv_path, "add", *packages,
                                )
                                is_installing = True
                                returncode = await proc.wait()
                                if returncode == 0:
                                    is_installing = False
                                    await event_emitter.emit('backend-installed', {'success': True})
                                else:
                                    is_installing = False
                                    await event_emitter.emit('backend-installed', {'error': True, 'returncode': returncode})
                            except Exception as ex:
                                logger.error(f"install_local_backend failed: {ex}", exc_info=True)
                                await event_emitter.emit('backend-installed', {'error': str(ex)})
                            finally:
                                is_installing = False
                        asyncio.create_task(_do_install())
                    else:
                        # Already installed
                        await event_emitter.emit('backend-installed', {'success': True})

                    return {'result': 'ok'}
                except Exception as e:  
                    return {'error': str(e)}
            case 'eval': 
                script = body.get("script")
                label = body.get("label")
                if label and script: 
                    try:
                        await event_emitter.emit("eval", {"script": script, "label": label})
                    except Exception as e:
                        logger.error(f"Error evaluating script in window {label}: {e}", exc_info=True)
                        return {"error": str(e)}
                return {'result': 'ok'}
            case "stream_ready":
                return {"message": "OK"}
            case "sqlite":
                res = await sqlite(body)
                if body.get("command") in ("sync_table", "execute") and "error" not in res:
                    try:
                        await trigger_table_update(body.get("db"), body.get("table"))
                    except Exception as e:
                        logger.error(f"Failed to trigger table update: {e}", exc_info=True)
                return res
            case "db_subscribe":
                return await subscribe_db(conn_id, body.get("db"), body.get("table"))
            case "db_unsubscribe":
                return await unsubscribe_db(conn_id, body.get("db"), body.get("table"))
            case "credentials":
                return await credentials_handler_with_rescan(body)
            case "file":
                return await file_handler(body)
            case "file_subscribe":
                return await subscribe_file(conn_id, body.get("filename"), body.get("base_dir", "."))
            case "file_unsubscribe":
                return await unsubscribe_file(conn_id, body.get("filename"), body.get("base_dir", "."))
            case "folder":
                return await folder_handler(body)
            case "folder_subscribe":
                return await subscribe_folder(conn_id, body.get("path"), body.get("base_dir", "."))
            case "folder_unsubscribe":
                return await unsubscribe_folder(conn_id, body.get("path"), body.get("base_dir", "."))
            case "v1/chat/completions":
                # CRITICAL: use body["id"] (the chat-specific ID the frontend knows)
                # as the stream key, NOT the WS correlation id (data["id"]).
                # v1/chat/stop sends body["id"] = messageState.activeId, so both
                # sides must agree on the same key for stop_stream / is_stream_active.
                effective_id = body.get("id") or msg_id
                asyncio.create_task(handle_ws_chat(effective_id, body, send_func))
                return {"status": "processing", "id": effective_id, "stream_end": False}
            case "v1/chat/stop":
                target_id = body.get("id")
                if not target_id: return {"error": "Missing 'id' parameter"}
                success = stop_stream(target_id)
                return {"success": success, "id": target_id}
            case "v1/chat/status":
                target_id = body.get("id")
                if not target_id: return {"error": "Missing 'id' parameter"}
                active = is_stream_active(target_id)
                return {"active": active, "id": target_id}
            case "v1/models/unload":
                model_id = body.get("model_id")
                if not model_id:
                    return {"error": "Missing 'model_id' parameter"}
                return await model_manager.unload(model_id)
            case "v1/models/unload_all":
                return await model_manager.unload_all()
            case "v1/models/scan":
                return await scan_models()
            # Tool commands (same naming as REST API)
            case "v1/check":
                result = False                
                if len(active_streams.keys()) == 0:
                    result = True
                return {'result': result}
            case "tools":
                return {"tools": tool_manager.list_tools()}
            case "tools/schemas":
                return {"schemas": tool_manager.get_schemas()}
            case "tools/execute":
                try:
                    tool_name = body.get("tool")
                    workspace = body.get("workspace", "global")
                    tab_id = body.get("tabId", None)
                    requested_model = body.get("model", None)
                    workspace_ctx.set(workspace)
                    tab_id_ctx.set(tab_id)
                    model_id_ctx.set(requested_model)
                    if not tool_name:
                        return {"error": "Missing 'tool' parameter"}
                    # Extract tool arguments (everything except 'tool')
                    kwargs = {k: v for k, v in body.items() if k != "workspace" and k != "tabId"}
                    return await tool_manager.execute_tool(tool_name, caller="direct", workspace=workspace, tab_id=tab_id, **kwargs)
                except Exception as e:
                    logger.error(f"Failed to execute tool: {e}", exc_info=True)
                    return {"error": str(e)}
            case "tools/reload":
                tool_name = body.get("tool")
                if not tool_name:
                    return {"error": "Missing 'tool' parameter"}
                success = tool_manager.reload_tool(tool_name)
                return {"success": success, "tool": tool_name}
            case "get_last_startup_status":
                return startup_tracker.get_status()
            # Settings commands
            case "settings/get":
                key = body.get("key")
                if not key: return {"error": "Missing 'key' parameter"}
                value = await settings_manager.get(key)
                return {"key": key, "value": value}
            case "settings/get_all":
                settings = await settings_manager.get_all()
                return {"settings": settings}
            case "settings/set":
                key = body.get("key")
                value = body.get("value")
                if not key: return {"error": "Missing 'key' parameter"}
                success = await settings_manager.set(key, value)
                return {"success": success, "key": key}
            case "settings/reset":
                key = body.get("key")
                if not key: return {"error": "Missing 'key' parameter"}
                success = await settings_manager.reset(key)
                return {"success": success, "key": key}
            case "settings/sources":
                sources = await settings_manager.get_sources()
                return {"sources": sources}
            case "settings/subscribe":
                return await subscribe_settings(conn_id)
            case "settings/unsubscribe":
                return await unsubscribe_settings(conn_id)
            case "os":
                return {'os': sys.platform}
            case "mcp_tool":
                return {"tools": mcp_manager.get_openai_schemas()}
            case "mcp_tool/reload":
                server_name = body.get("server_name")
                if server_name: 
                    await mcp_manager.reload_mcp_server(server_name)
                    return {'result': 'ok'}
                return {'error': 'server_name is required'}
            case "mcp_tool/statuses":
                return {'statuses': mcp_manager.mcp_statuses}
            case "get_plugin_dirs":
                return get_plugin_dirs()
            case _:
                return {"error": f"Unknown command: {api}"}
    except Exception as e:
        logger.error(f"Error in WS command {api}: {e}", exc_info=True)
        return {"error": str(e)}
    
async def handle_ws_chat(msg_id: str, body: dict, send_func: Callable[[dict], Awaitable[bool]]):
    """WebSocket chat handler with tool support."""
    agent = body.get("agent", None)
    messages = body.get("messages", [])
    stream = body.get("stream", True)
    workspace = body.get("workspace", "global")
    # Check for model parameter and load if needed
    agent_tree = None 
    agent_model_id = None
    if agent:
        agent_tree: Optional[Dict[str, Any]] = (await get_agent_tree_internal(agent_id=agent, workspace=workspace))
        agent_ctx.set(agent_tree)
        if agent_tree:
            current_agent_id = next(iter(agent_tree))
            agent_node = agent_tree.get(current_agent_id)
            if agent_node:
                agent_model_id = agent_node.get("model", None)

    requested_model = agent_model_id if agent_model_id else body.get("model", "")     
    files = body.get("files", [])
    query = body.get("query", None)
    tab_id = body.get("tab_id", "global")
    branch_id = body.get("branch_id", None)
    response_branch = body.get("response_branch", None)
    index = body.get("index", None)
    tb = body.get("tb", None)
    app_name = body.get("app_name", None)
    db = Database(workspace=workspace, tab_id=tab_id)
    # Prepare kwargs
    chat_kwargs = {k: v for k, v in body.items() if k not in [
        "model",
        "messages",
        "stream",
        "id",
        "files",
        "query",
        "tab_id",
        "branch_id",
        "response_branch",
        "index",
        "tb",
        "workspace",
        "app_name",
        "pipeline",
        "agent"
    ]}
    pipeline_name = body.get("pipeline", None)
    is_continue = [True]
    cancel_event = _register_cancel_event(msg_id)
    pipeline, chat_kwargs = await _setup_pipeline(
        requested_model=requested_model,
        files=files,
        query=query,
        workspace=workspace,
        tab_id=tab_id,
        branch_id=branch_id,
        response_branch=response_branch,
        index=index,
        tb=tb,
        pipeline_name=pipeline_name,
        messages=messages,
        chat_kwargs=chat_kwargs,
        database=db,
        pricing=model_manager.get_pricing(requested_model),
        model_name=model_manager.get_model_name(requested_model),
        set_continue=lambda v: is_continue.__setitem__(0, v),
        cancel_event=cancel_event,
    )
    workspace_ctx.set(workspace)
    tab_id_ctx.set(tab_id)
    model_id_ctx.set(requested_model)
    try:                 
        if not model_manager.is_loaded(requested_model):
            model_data = await model_manager.get_model_from_config(requested_model)
            if model_data:
                try:
                    filename = model_data.get("filename")
                    backend = model_data.get("backend")
                    name = model_data.get("name", requested_model)
                    model_type = model_data.get("model_type", "llm")
                    model_path = model_data.get("model_path")
                    # Extract other kwargs
                    kwargs = {k: v for k, v in model_data.items() if k not in ["set_as_default", "backend", "model_type", "model_path", "filename", "name", "last_error"]}
                    await model_manager.load(
                            requested_model,
                            filename=filename,
                            backend=backend,
                            name=name,
                            model_type=model_type,
                            model_path=model_path,
                            set_as_default=False,
                            **kwargs,
                    )
                except Exception as e:
                    raise Exception(f"Error loading model {requested_model}: {e}")
            else: 
                raise Exception(f"Model {requested_model} not found")
        if msg_id:
            register_stream(msg_id)
        while is_continue[0]:
            is_continue[0] = False
            stopped = False
            if stream:
                chunk_count = 0
                if pipeline:
                    await pipeline.start(**chat_kwargs)                
                    messages = copy.deepcopy(pipeline.messages)
                    chat_kwargs = copy.deepcopy(pipeline.args)
                if not messages:
                    messages = [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ]                    
                logger.info(f"WS Stream {msg_id} starting chat with messages: {json.dumps(messages, default=str)}")
                gen = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=True, **chat_kwargs)
                assert hasattr(gen, "__aiter__"), "Expected async generator from model_manager.chat"
                gen = cast(AsyncGenerator[Any, Any], gen)
                async for chunk in gen:
                    chunk_count += 1
                    _diag_delta = chunk.get('choices', [{}])[0].get('delta', {}) if isinstance(chunk, dict) else chunk
                    _diag_finish = chunk.get('choices', [{}])[0].get('finish_reason') if isinstance(chunk, dict) else None
                    logger.warning(f"WS DIAGNOSTIC | {msg_id} | Chunk {chunk_count} | delta={_diag_delta} | finish_reason={_diag_finish}")
                    # Check if stream was stopped externally
                    if not is_stream_active(msg_id):
                        logger.info(f"WS Stream {msg_id} stopped externally after {chunk_count} chunks")
                        is_continue[0] = False
                        stopped = True
                        break
                    if chunk:
                        # Run pipeline               
                        process_chunk = None
                        if pipeline:
                            try:
                                process_chunk = await pipeline.process_chunk(chunk, **chat_kwargs)
                            except Exception as e:
                                if pipeline_name:
                                    await pipeline_manager.record_error(pipeline_name, e, "process_chunk")
                                pipeline = None
                                stopped = True
                        process_chunk = chunk if not process_chunk else process_chunk
                        if process_chunk is not None:
                            if isinstance(process_chunk, dict):
                                delta = process_chunk.get('choices', [{}])[0].get('delta', {})
                                is_stop = delta.get('stop')
                                if is_stop:                   
                                    await send_func({"id": msg_id, "response": process_chunk, "stream_end": False})
                                    stopped = True
                                    break
                                is_force_stop = delta.get('force_stop')
                                if is_force_stop:                      
                                    await send_func({"id": msg_id, "response": process_chunk, "stream_end": False})
                                    stopped = True
                                    is_continue[0] = False
                                    break     
                            await send_func({"id": msg_id, "response": process_chunk, "stream_end": False})
                if pipeline:
                    await pipeline.end(**chat_kwargs)
                    pipeline.attempt += 1
                # If the stream was stopped externally, pipeline.end() may have called
                # set_continue(True) because tool_calls were mid-accumulation.
                # Force-override that here so the while loop does NOT restart.
                if stopped:
                    is_continue[0] = False
                logger.info(f"WS Stream {msg_id} loop finished. Total chunks: {chunk_count}")
                # Only finalize if we didn't stop early due to tool calls or user stop
                if is_stream_active(msg_id) and not stopped and pipeline:
                    try:
                        remaining = await pipeline.finalize(**chat_kwargs)
                        if remaining:
                            await send_func({"id": msg_id, "response": remaining, "stream_end": False})
                    except Exception as e:
                        if pipeline_name:
                            await pipeline_manager.record_error(pipeline_name, e, "finalize")
                # Process next query from queue or finish
                if not is_continue[0]:
                    await send_func({"id": msg_id, "stream_end": True})
                    break
            else:
                if pipeline:
                    await pipeline.start(**chat_kwargs)
                    messages = copy.deepcopy(pipeline.messages)
                    chat_kwargs = copy.deepcopy(pipeline.args)
                if not messages:
                    messages = [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ]
                response = await model_manager.chat(messages=copy.deepcopy(messages), model_id=requested_model, stream=True, **chat_kwargs)
                pipeline_response = None
                if pipeline:
                    try:
                        pipeline_response = await pipeline.response(response, **chat_kwargs)
                    except Exception as e:
                        if pipeline_name:
                            await pipeline_manager.record_error(pipeline_name, e, "response")                    
                if pipeline:
                    await pipeline.end(**chat_kwargs)
                    pipeline.attempt += 1
                # Process next query from queue or finish
                if not is_continue[0]:
                    await send_func({"id": msg_id, "response": response, "stream_end": True})
                    break
    except Exception as e:
        logger.error(f"Error in WS chat stream {msg_id}: {e}", exc_info=True)
        await send_func({"id": msg_id, "error": str(e), "stream_end": True})
    finally:
        if pipeline:
            await pipeline.stop(**chat_kwargs)
        if msg_id:
            unregister_stream(msg_id)
            _unregister_cancel_event(msg_id)


@app.websocket("/mcp/ws")
async def mcp_websocket_endpoint(websocket: WebSocket):
    conn_id = await manager.connect(websocket)
    # --- Bidirectional MCP streams ---
    # WebSocket → MCP server (client sends requests here)
    ws_to_mcp_send, ws_to_mcp_recv = anyio.create_memory_object_stream(
        max_buffer_size=64, item_type=JSONRPCMessage
    )
    # MCP server → WebSocket (server writes responses here)
    mcp_to_ws_send, mcp_to_ws_recv = anyio.create_memory_object_stream(
        max_buffer_size=64, item_type=JSONRPCMessage
    )
    async def receive_loop():
        """WebSocket → MCP input stream"""
        try:
            while True:
                text = await websocket.receive_text()
                msg = JSONRPCMessage.model_validate_json(text)
                await ws_to_mcp_send.send(msg)
        except WebSocketDisconnect:
            logger.info(f"[{conn_id}] Client disconnected in receive_loop")
        except Exception as e:
            logger.error(f"[{conn_id}] receive_loop error: {e}")
        finally:
            await ws_to_mcp_send.aclose()
    async def send_loop():
        """MCP output stream → WebSocket"""
        try:
            async for message in mcp_to_ws_recv:
                payload = message.model_dump_json(by_alias=True, exclude_none=True)
                await websocket.send_text(payload)
        except WebSocketDisconnect:
            logger.info(f"[{conn_id}] Client disconnected in send_loop")
        except Exception as e:
            logger.error(f"[{conn_id}] send_loop error: {e}")
        finally:
            await mcp_to_ws_recv.aclose()
    async def mcp_run():
        """Run FastMCP server with the bridged streams"""
        try:
            await mcp_instance._mcp_server.run(
                read_stream=ws_to_mcp_recv,
                write_stream=mcp_to_ws_send,
                initialization_options=mcp_instance._mcp_server.create_initialization_options(),
            )
        except Exception as e:
            logger.error(f"[{conn_id}] mcp_run error: {e}")
        finally:
            await mcp_to_ws_send.aclose()
    try:
        async with anyio.create_task_group() as tg:
            tg.start_soon(receive_loop)
            tg.start_soon(send_loop)
            tg.start_soon(mcp_run)
            # When any task exits (e.g. disconnect), the group cancels the rest
    except Exception as e:
        logger.error(f"[{conn_id}] Task group error: {e}", exc_info=True)
    finally:
        logger.info(f"[{conn_id}] Cleanup")
        manager.disconnect(conn_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    conn_id = await manager.connect(websocket)
    async def safe_send_json(data: dict) -> bool:
        return await manager.send_personal_message(data, websocket)
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=0.05)
            except asyncio.TimeoutError:
                continue
            if message.get("type") == "websocket.disconnect":
                break
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                    # Define a background task for processing
                    async def process_message(data_local: dict):
                        msg_id = data_local.get("id")
                        try:
                            # Offload command processing
                            response_payload = await handle_ws_command(conn_id, data_local, safe_send_json)
                            # If handle_ws_command returns a dict, it means it's a direct response 
                            # (unlike chat which might stream directly to socket)
                            if response_payload is not None and isinstance(response_payload, dict):
                                response = {"id": msg_id}  # Always keep WS correlation id
                                if "error" in response_payload:
                                    response["error"] = response_payload["error"]
                                else:
                                    response["response"] = response_payload
                                    # Propagate protocol flags to the top level
                                    if "stream_end" in response_payload:
                                        response["stream_end"] = response_payload["stream_end"]
                                    if "event" in response_payload:
                                        response["event"] = response_payload["event"]
                                try:
                                    await safe_send_json(response)
                                except (RuntimeError, WebSocketDisconnect) as e:
                                    logger.info(f"Failed to send response to {conn_id}: {e}")
                        except Exception as e:
                            logger.error(f"Error processing message {msg_id}: {e}")
                            try:
                                await websocket.send_json({"id": msg_id, "error": str(e)})
                            except:
                                pass
                    # Fire and forget (background task)
                    asyncio.create_task(process_message(data))
                except json.JSONDecodeError:
                    try:
                        await websocket.send_json({"error": "Invalid JSON"})
                    except (RuntimeError, WebSocketDisconnect):
                        break
                except Exception as e:
                    logger.error(f"WS Text Handler Error: {e}")
    except WebSocketDisconnect:
        logger.info(f"WS Disconnect: {conn_id}")
    except Exception as e:
        logger.error(f"Unexpected WS Error {conn_id}: {e}", exc_info=True)
    finally:
        logger.info(f"Cleanup: {conn_id}")
        remove_db_id(conn_id)
        remove_file_id(conn_id)
        remove_settings_id(conn_id)
        manager.disconnect(conn_id)

@app.get("/health")
async def health_check():
    return {"status": "ok"}
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Frontend Serving
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
if os.path.exists(os.path.join(_PROJECT_ROOT, "frontend", "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(_PROJECT_ROOT, "frontend", "assets")), name="assets")

@app.get("/{path_name:path}")
async def catch_all(path_name: str):
    """
    Catch-all route to serve the frontend index.html for SPA routing.
    Excludes existing API / static routes.
    """
    # List of high-priority prefixes to ignore (already handled by FastAPI)
    if path_name.startswith(("api/", "file/", "ws", "health", "assets/")):
        raise HTTPException(status_code=404)
    index_path = os.path.join(_PROJECT_ROOT, "frontend", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    # If build doesn't exist yet, return a helpful error
    return Response(
        content="Frontend not built. Please run 'npm run build' in the root directory.",
        status_code=404
    )
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
# Pytauri Application Logic
# =+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+==+=+=
task_group: TaskGroup

def single_instance_callback(app_handle: AppHandle, _args: list[str], _cwd: str) -> None:
    main_window = Manager.get_webview_window(app_handle, "main")
    if main_window:
        main_window.set_focus()
server = None

async def run_fastapi():
    """Run the FastAPI server in the background."""
    global server
    print(f"Starting server on {port}")
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()

@asynccontextmanager
async def _get_task_group():
    async with create_task_group() as tg:
        yield tg

def main() -> int:
    """Run the concurrent FastAPI + Tauri application."""
    global task_group
    import concurrent.futures
    import traceback

    # ── Step 0: Environment diagnostics ──────────────────────────────────────
    logger.info("=" * 60)
    logger.info("main() starting – PyTauri + FastAPI launcher")
    logger.info("=" * 60)
    logger.info("[ENV] _PYTAURI_DIST   = %s", os.environ.get("_PYTAURI_DIST", "<not set>"))
    logger.info("[ENV] DEV_MODE        = %s", os.environ.get("DEV_MODE", "<not set>"))
    logger.info("[ENV] VITE_PORT       = %s", os.environ.get("VITE_PORT", "<not set>"))
    logger.info("[ENV] APP_NAME        = %s", os.environ.get("APP_NAME", "<not set>"))
    logger.info("[ENV] OPENCHAD_PROJECT_DIR = %s", os.environ.get("OPENCHAD_PROJECT_DIR", "<not set>"))
    logger.info("[ENV] OPENCHAD_CONFIG_PATH = %s", os.environ.get("OPENCHAD_CONFIG_PATH", "<not set>"))

    SRC_TAURI_DIR = Path(_PROJECT_ROOT)
    tauri_toml = SRC_TAURI_DIR / "Tauri.toml"
    logger.info("[PATH] SRC_TAURI_DIR  = %s  (exists=%s)", SRC_TAURI_DIR, SRC_TAURI_DIR.exists())
    logger.info("[PATH] Tauri.toml     = %s  (exists=%s)", tauri_toml, tauri_toml.exists())

    # ── Step 1: Set BASE_URL ──────────────────────────────────────────────────
    base_url = "localhost:" + (VITE_PORT if DEV_MODE else str(port))
    os.environ["BASE_URL"] = base_url
    logger.info("[STEP 1] BASE_URL set to: %s", base_url)

    frontend_dist = "http://localhost:" + (VITE_PORT if DEV_MODE else str(port))
    tauri_config = {"build": {"frontendDist": frontend_dist}}
    logger.info("[STEP 1] frontendDist  = %s", frontend_dist)

    # ── Step 2: Resolve builder/context factories ─────────────────────────────
    logger.info("[STEP 2] Resolving builder_factory and context_factory ...")
    try:
        _builder  = builder_factory()
        logger.info("[STEP 2] builder_factory() OK  → %r", _builder)
    except Exception as exc:
        logger.error("[STEP 2] builder_factory() FAILED: %s", exc, exc_info=True)
        return 1

    try:
        _context = context_factory(SRC_TAURI_DIR, tauri_config=tauri_config)
        logger.info("[STEP 2] context_factory()  OK  → %r", _context)
    except Exception as exc:
        logger.error("[STEP 2] context_factory() FAILED: %s", exc, exc_info=True)
        return 1

    # ── Step 3: Start blocking portal + task group ────────────────────────────
    logger.info("[STEP 3] Starting anyio blocking portal ...")
    try:
        with start_blocking_portal("asyncio") as portal:
            logger.info("[STEP 3] Portal created OK: %r", portal)
            try:
                with portal.wrap_async_context_manager(_get_task_group()) as task_group:
                    logger.info("[STEP 3] Task group created OK")

                    # ── Step 4: Start FastAPI ─────────────────────────────────
                    logger.info("[STEP 4] Scheduling run_fastapi in background ...")
                    try:
                        portal.start_task_soon(run_fastapi)
                        logger.info("[STEP 4] run_fastapi scheduled OK (non-blocking)")
                    except Exception as exc:
                        logger.error("[STEP 4] Failed to schedule run_fastapi: %s", exc, exc_info=True)
                        return 1


                    # ── Step 5: Build Tauri app ───────────────────────────────
                    logger.info("[STEP 5] Calling builder.build() ...")
                    logger.info("[STEP 5]   context   = %r", _context)
                    logger.info("[STEP 5]   portal    = %r", portal)
                    try:
                        tauri_app = _builder.build(
                            context=_context,
                            invoke_handler=commands.generate_handler(portal),
                            plugins=(
                                single_instance.init(single_instance_callback),
                                dialog.init(),
                                notification.init(),
                                clipboard_manager.init(),
                                fs.init(),
                                opener.init(),
                                autostart.init(),
                                deep_link.init(),
                                http.init(),
                                os_plugin.init(),
                                persisted_scope.init(),
                                positioner.init(),
                                process.init(),
                                shell.init(),
                                upload.init(),
                                websocket.init(),
                                global_shortcut.Builder.build(),
                            ),
                        )
                        logger.info("[STEP 5] build() returned: %r", tauri_app)
                    except Exception as exc:
                        logger.error("[STEP 5] builder.build() FAILED:\n%s", traceback.format_exc())
                        return 1

                    if tauri_app is None:
                        logger.error("[STEP 5] builder.build() returned None – cannot continue")
                        return 1

                    # ── Step 6: Set app handle ────────────────────────────────
                    logger.info("[STEP 6] Setting app handle ...")
                    try:
                        handle = tauri_app.handle()
                        set_app_handle(handle)
                        logger.info("[STEP 6] App handle set OK: %r", handle)
                    except Exception as exc:
                        logger.error("[STEP 6] set_app_handle() FAILED: %s", exc, exc_info=True)
                        return 1

                    # ── Step 7: run_return() — blocks until window is closed ──
                    logger.info("[STEP 7] Calling tauri_app.run_return() — window should open now ...")
                    try:
                        exit_code = tauri_app.run_return()
                        logger.info("[STEP 7] run_return() finished with exit_code=%s", exit_code)
                    except Exception as exc:
                        logger.error("[STEP 7] run_return() FAILED: %s", exc, exc_info=True)
                        exit_code = 1

                    # ── Step 8: Shutdown ──────────────────────────────────────
                    logger.info("[STEP 8] Shutting down FastAPI server ...")
                    if server:
                        server.should_exit = True #pyrefly: ignore
                        logger.info("[STEP 8] server.should_exit = True")
                    else:
                        logger.warning("[STEP 8] server is None – FastAPI may not have started")

                    logger.info("[STEP 8] main() returning exit_code=%s", exit_code)
                    return exit_code

            except concurrent.futures.CancelledError:
                logger.info("[main] Portal task cancelled (normal shutdown)")
                return -1
            except Exception as exc:
                logger.error("[main] Unhandled exception inside portal:\n%s", traceback.format_exc())
                raise

    except Exception as exc:
        logger.error("[main] Fatal error in start_blocking_portal:\n%s", traceback.format_exc())
        return 1

if __name__ == "__main__":
    main()
