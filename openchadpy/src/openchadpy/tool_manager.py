"""
Tool Manager - Discovers, loads, and manages tools from the Tools/ directory.
"""
import os
import sys
import ast
import logging
import importlib
import importlib.util
import importlib.metadata
import re
import hashlib
import json
import tomllib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING
from pathlib import Path
import asyncio
from .tool_base import ToolBase
from .context import workspace_ctx, tab_id_ctx
if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP
    
logger = logging.getLogger(__name__)

@dataclass
class ToolMetadata:
    """Metadata describing a tool."""
    name: str
    version: str
    description: str
    author: str = ""
    requirements: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "requirements": self.requirements,
        }
    
class ToolManager:
    """Manages the lifecycle of tools."""

    _active_workspace : Optional[str]
    _active_tab_id : Optional[str]

    def __init__(self, tools_directory: str):
        """Initialize the tool manager."""
        self.tools_directory = Path(tools_directory).resolve()
        # Flat registry: tool_instance.name → ToolBase
        self.loaded_tools: Dict[str, ToolBase] = {}
        self._tool_modules: Dict[str, Any] = {}   # module_name → module
        # Maps tool_instance.name → module_name (for cleanup)
        self._tool_module_name: Dict[str, str] = {}
        self.managers: Dict[str, Any] = {}
        self._active_workspace = None
        self._active_tab_id = None
        tools_parent = str(self.tools_directory.parent)
        if tools_parent not in sys.path:
            sys.path.insert(0, tools_parent)
    
    def set_active(self, w:str, tid: str):
        logger.info(f"workspace: {w} tab_id: {tid}")
        self._active_workspace = w
        self._active_tab_id = tid

    @property
    def active_workspace(self) -> str:
        return self._active_workspace or "global"
    
    @property
    def active_tab_id(self) -> str:
        return self._active_tab_id or "global"

    @property
    def all_tools(self) -> List[str]:
        """Return a list of all available tool names (local + MCP)."""
        tools = list(self.loaded_tools.keys())
        mcp = self.managers.get("mcp_manager")
        if mcp:
            for t in getattr(mcp, "mcp_tools", []):
                if t.name not in tools:
                    tools.append(t.name)
        return tools


    # Internal helpers
    def _sanitize_name(self, name: str) -> str:
        """Sanitize a directory name to be a valid Python identifier segment."""
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9_]*$", name):
            logger.warning(f"Invalid name: {name}, generating hash")
            return hashlib.sha256(name.encode()).hexdigest()[:9]
        return name

    def _get_pyproject_toml_path(self) -> Optional[Path]:
        """Get the path to pyproject.toml."""
        proj_dir = os.environ.get("OPENCHAD_UV_PROJECT_DIR")
        if proj_dir:
            path = Path(proj_dir) / "pyproject.toml"
            if path.exists():
                return path
        path = Path(__file__).parent.parent.parent / "pyproject.toml"
        if path.exists():
            return path
        return None

    def _get_pyproject_dependencies(self) -> List[str]:
        """Parse pyproject.toml and return a list of dependency package names."""
        path = self._get_pyproject_toml_path()
        if not path:
            return []
        try:
            with open(path, "rb") as f:
                data = tomllib.load(f)
            deps = data.get("project", {}).get("dependencies", [])
            pkg_names = []
            for dep in deps:
                match = re.match(r"^([a-zA-Z0-9_-]+)", dep)
                if match:
                    pkg_names.append(match.group(1).replace("-", "_"))
            return pkg_names
        except Exception as e:
            logger.warning(f"Failed to read/parse pyproject.toml at {path}: {e}")
            return []

    def _get_site_packages_dirs(self) -> List[Path]:
        """Get the site-packages directories for the current python environment."""
        dirs = []
        sys_prefix = Path(sys.prefix).resolve()
        
        win_path = sys_prefix / "Lib" / "site-packages"
        if win_path.exists():
            dirs.append(win_path)
            
        lib_path = sys_prefix / "lib"
        if lib_path.exists():
            for p in lib_path.glob("python*/site-packages"):
                dirs.append(p)
                
        for p in sys.path:
            p_path = Path(p).resolve()
            if p_path.name == "site-packages" and p_path.exists() and p_path not in dirs:
                dirs.append(p_path)
                
        return dirs

    def _is_valid_tool_class(self, content: str) -> bool:
        """Parse Python content to check if it contains a valid ToolBase subclass with execute and required attributes."""
        try:
            tree = ast.parse(content)
        except Exception:
            return False
            
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                inherits_tool_base = False
                for base in node.bases:
                    if isinstance(base, ast.Name) and base.id == "ToolBase":
                        inherits_tool_base = True
                        break
                    elif isinstance(base, ast.Attribute) and base.attr == "ToolBase":
                        inherits_tool_base = True
                        break
                
                if inherits_tool_base:
                    has_execute = False
                    class_attrs = set()
                    for body_node in node.body:
                        if isinstance(body_node, (ast.FunctionDef, ast.AsyncFunctionDef)) and body_node.name == "execute":
                            has_execute = True
                        elif isinstance(body_node, ast.Assign):
                            for target in body_node.targets:
                                if isinstance(target, ast.Name):
                                    class_attrs.add(target.id)
                        elif isinstance(body_node, ast.AnnAssign):
                            if isinstance(body_node.target, ast.Name):
                                class_attrs.add(body_node.target.id)
                                
                    required_attrs = {"name", "description", "allowed_callers", "input_schema"}
                    if has_execute and required_attrs.issubset(class_attrs):
                        return True
        return False

    def _discover_venv_items(self) -> List[Tuple[str, Path]]:
        """Scan registered pyproject dependencies in site-packages for tools."""
        items: List[Tuple[str, Path]] = []
        deps = self._get_pyproject_dependencies()
        if not deps:
            return items

        for pkg_name in deps:
            # First try using importlib.util.find_spec to locate the package (supports editable installs)
            try:
                spec = importlib.util.find_spec(pkg_name)
                if spec and spec.origin:
                    origin_path = Path(spec.origin)
                    if origin_path.name == "__init__.py":
                        candidate = origin_path.parent / "main.py"
                        if candidate.exists():
                            main_py = candidate
                    elif origin_path.name == "main.py":
                        main_py = origin_path
            except Exception as e:
                logger.debug(f"Failed to find_spec for {pkg_name}: {e}")

            # Fallback to importlib.metadata to locate the package files
            if not main_py:
                try:
                    pkg_files = importlib.metadata.files(pkg_name)
                    if pkg_files:
                        for f in pkg_files:
                            f_path = Path(f)
                            if f_path.name == "main.py":
                                main_py = Path(f.locate())
                                break
                except importlib.metadata.PackageNotFoundError:
                    pass

            # Fallback to direct directory scan in site-packages
            if not main_py:
                site_packages_dirs = self._get_site_packages_dirs()
                for sp_dir in site_packages_dirs:
                    if not sp_dir.exists():
                        continue
                    pkg_dir = sp_dir / pkg_name
                    if pkg_dir.exists() and pkg_dir.is_dir():
                        candidate_main = pkg_dir / "main.py"
                        if candidate_main.exists():
                            main_py = candidate_main
                            break

            if main_py and main_py.exists():
                try:
                    content = main_py.read_text(encoding="utf-8", errors="ignore")
                    if self._is_valid_tool_class(content):
                        storage_key = f"venv_{pkg_name}"
                        items.append((storage_key, main_py))
                        logger.debug(f"Discovered venv tool: {storage_key}")
                except Exception as e:
                    logger.warning(f"Error checking potential tool in {main_py}: {e}")
        return items
    
    # Discovery
    def _discover_local_items(self, directory: Path) -> List[Tuple[str, Path]]:
        """
        Scan directory for tools.
        Returns a list of (storage_key, tool_path) tuples where storage_key is
        ``publisher_plugin``  used only as the Python module name. The actual
        registry key is set later from ``tool_instance.name``.
        """
        items: List[Tuple[str, Path]] = []
        if not directory.exists():
            logger.warning(f"Directory not found: {directory}")
            return items
        for publisher_dir in directory.iterdir():
            if not publisher_dir.is_dir() or publisher_dir.name.startswith((".", "_")):
                continue
            publisher_name = self._sanitize_name(publisher_dir.name)
            for plugin_dir in publisher_dir.iterdir():
                if not plugin_dir.is_dir() or plugin_dir.name.startswith((".", "_")):
                    continue
                main_py = plugin_dir / "main.py"
                if not main_py.exists():
                    continue
                plugin_name = self._sanitize_name(plugin_dir.name)
                storage_key = f"{publisher_name}_{plugin_name}"
                items.append((storage_key, main_py))
                logger.debug(f"Discovered: {storage_key}")
        return items

    def discover_tools(self) -> List[Tuple[str, Path]]:
        """Scan the Tools/ directory and dependencies. Returns (storage_key, main_py_path) pairs."""
        local_tools = self._discover_local_items(self.tools_directory)
        venv_tools = self._discover_venv_items()
        return local_tools + venv_tools
    
    # Manager injection
    def set_managers(self, **kwargs):
        """Set manager references for injection into tools."""
        self.managers.update(kwargs)

    def inject_managers(self, tool_instance: ToolBase):
        """Inject manager references into a tool instance."""
        for name, manager in self.managers.items():
            if hasattr(tool_instance, name):
                setattr(tool_instance, name, manager)
    
    # Load / Unload / Reload
    async def load_tool(self, storage_key: str, _rebuild: bool = True) -> bool:
        """
        Load a tool from disk.
        Args:
            storage_key: ``publisher_plugin`` string  used only to locate the
                         file.  The registry key is set from ``tool_instance.name``.
            _rebuild:    Unused; kept for call-site compatibility with the
                         concurrent loader (which passes ``_rebuild=False``).
        """
        if storage_key.startswith("venv_"):
            pkg_name = storage_key[5:]
            tool_path = None
            
            # First try using importlib.util.find_spec to locate the package (supports editable installs)
            try:
                spec = importlib.util.find_spec(pkg_name)
                if spec and spec.origin:
                    origin_path = Path(spec.origin)
                    if origin_path.name == "__init__.py":
                        candidate = origin_path.parent / "main.py"
                        if candidate.exists():
                            tool_path = candidate
                    elif origin_path.name == "main.py":
                        tool_path = origin_path
            except Exception as e:
                logger.debug(f"Failed to find_spec for {pkg_name}: {e}")

            # Fallback to importlib.metadata to locate the package files
            if not tool_path:
                try:
                    pkg_files = importlib.metadata.files(pkg_name)
                    if pkg_files:
                        for f in pkg_files:
                            f_path = Path(f)
                            if f_path.name == "main.py":
                                tool_path = Path(f.locate())
                                break
                except importlib.metadata.PackageNotFoundError:
                    pass
                
            # Fallback to direct directory scan in site-packages
            if not tool_path:
                for sp_dir in self._get_site_packages_dirs():
                    candidate = sp_dir / pkg_name / "main.py"
                    if candidate.exists():
                        tool_path = candidate
                        break
            
            if not tool_path:
                logger.error(f"Venv tool package '{pkg_name}' main.py not found")
                return False
                
            module_name = f"tool_{storage_key}"
            
            # Ensure site-packages is importable
            if tool_path.parent.name == "site-packages":
                sp_path = str(tool_path.parent.resolve())
            else:
                sp_path = str(tool_path.parent.parent.resolve())
                
            if sp_path not in sys.path:
                sys.path.insert(0, sp_path)
        else:
            parts = storage_key.split("_")
            if len(parts) < 2:
                logger.error(f"Invalid tool key: {storage_key} (expected publisher_plugin)")
                return False
            publisher_name = parts[0]
            plugin_name = "_".join(parts[1:])
            tool_path = self.tools_directory / publisher_name / plugin_name / "main.py"
            module_name = f"tool_{storage_key}"
            if not tool_path.exists():
                logger.error(f"Tool not found: {storage_key} (no main.py at {tool_path})")
                return False
            # Ensure the plugin directory is importable
            plugin_path = str(tool_path.parent.resolve())
            if plugin_path not in sys.path:
                sys.path.insert(0, plugin_path)
                
        # Ensure project root is importable
        project_dir = os.environ.get("OPENCHAD_UV_PROJECT_DIR")
        if project_dir:
            python_path = str(Path(project_dir).resolve())
            if python_path not in sys.path:
                sys.path.insert(0, python_path)
        # Ensure pipelines directory is importable (so tools can import pipelines)
        pipelines_dir = os.environ.get("OPENCHAD_PIPELINES_DIR")
        if pipelines_dir:
            pipelines_path = str(Path(pipelines_dir).resolve())
            if pipelines_path not in sys.path:
                sys.path.insert(0, pipelines_path)
        try:
            spec = importlib.util.spec_from_file_location(module_name, tool_path)
            if spec is None or spec.loader is None:
                logger.error(f"Failed to create spec for {storage_key}")
                return False
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            await asyncio.to_thread(spec.loader.exec_module, module)
            if not hasattr(module, "Tool"):
                logger.error(f"Tool {storage_key} has no 'Tool' class export")
                return False
            tool_class = module.Tool
            if not issubclass(tool_class, ToolBase):
                logger.error(f"Tool {storage_key} does not inherit from ToolBase")
                return False
            tool_instance: ToolBase = tool_class()
            self.inject_managers(tool_instance)
            tool_instance.on_register()
            # Key the registry by the instance's declared name
            tool_name = tool_instance.name
            self.loaded_tools[tool_name] = tool_instance
            self._tool_modules[module_name] = module
            self._tool_module_name[tool_name] = module_name
            logger.info(f"Loaded tool: '{tool_name}' (module: {module_name})")
            return True
        except Exception as e:
            logger.error(f"Failed to load {storage_key}: {e}", exc_info=True)
            return False

    def unload_tool(self, tool_name: str) -> bool:
        """
        Unregister and unload a tool by its declared name, plugin_key, or storage_key.
        Args:
            tool_name: Declared name, plugin_key (publisher/plugin), or storage_key (publisher_plugin).
        """
        tool = self.loaded_tools.get(tool_name)
        
        # If not found, try to resolve from plugin_key / storage_key
        if tool is None:
            if tool_name.startswith("venv_"):
                pkg_name = tool_name[5:]
                target_module_names = [f"{pkg_name}.main", f"tool_venv_{pkg_name}", f"tool_{tool_name}"]
            else:
                storage_key = re.sub(r"[:/\\]", "_", tool_name)
                target_module_names = [f"tool_{storage_key}", f"{storage_key}.main"]
                
            for t_name, m_name in list(self._tool_module_name.items()):
                if m_name in target_module_names:
                    tool_name = t_name
                    tool = self.loaded_tools.get(tool_name)
                    break

        if tool is None:
            logger.warning(f"Cannot unload: tool '{tool_name}' not found")
            return False
        try:
            tool.on_unregister()
        except Exception as e:
            logger.warning(f"on_unregister error for '{tool_name}': {e}")
        del self.loaded_tools[tool_name]
        module_name = self._tool_module_name.pop(tool_name, None)
        if module_name:
            sys.modules.pop(module_name, None)
            self._tool_modules.pop(module_name, None)
        logger.info(f"Unloaded tool: '{tool_name}'")
        return True
    
    def get_tool_by_storage_key(self, storage_key: str) -> Optional[ToolBase]:
        """Retrieve a loaded tool by its storage key (publisher_plugin)."""
        if storage_key.startswith("venv_"):
            pkg_name = storage_key[5:]
            target_module_names = [f"{pkg_name}.main", f"tool_venv_{pkg_name}"]
        else:
            target_module_names = [f"tool_{storage_key}"]
        for t_name, m_name in self._tool_module_name.items():
            if m_name in target_module_names:
                return self.loaded_tools.get(t_name)
        return None

    async def reload_tool(self, tool_name: str) -> bool:
        """
        Hot-reload a tool by its declared name, plugin_key, or storage_key.
        The storage_key (``publisher_plugin``) is reconstructed from the module
        name that was recorded at load time so we can re-locate the file without
        re-scanning the directory.
        """
        # Recover storage_key from the module name recorded at load time
        module_name = self._tool_module_name.get(tool_name)
        if module_name and module_name.startswith("tool_"):
            storage_key = module_name[len("tool_"):]
        elif module_name and module_name.endswith(".main"):
            storage_key = f"venv_{module_name[:-5]}"
        else:
            # Fallback: derive storage_key from tool_name
            storage_key = re.sub(r"[:/\\]", "_", tool_name)
        # Locate the tool directory to purge submodules
        if storage_key.startswith("venv_"):
            pkg_name = storage_key[5:]
            tool_dir = None
            for sp_dir in self._get_site_packages_dirs():
                candidate = sp_dir / pkg_name
                if candidate.exists():
                    tool_dir = candidate
                    break
            tool_dir_str = str(tool_dir.resolve()) if tool_dir else None
            full_module_name = f"{pkg_name}.main"
        else:
            parts = storage_key.split("_")
            if len(parts) >= 2:
                tool_dir = self.tools_directory / parts[0] / "_".join(parts[1:])
                tool_dir_str = str(tool_dir.resolve()) if tool_dir.exists() else None
            else:
                tool_dir_str = None
            full_module_name = f"tool_{storage_key}"
            
        # Purge stale modules (top-level + any helpers the tool imported)
        stale = []
        for k, v in list(sys.modules.items()):
            spec = getattr(v, "__spec__", None)
            origin = getattr(spec, "origin", None)
            origin_str = str(Path(origin).resolve()) if origin else None
            
            if storage_key.startswith("venv_"):
                pkg_name = storage_key[5:]
                is_stale = (
                    k == pkg_name
                    or k.startswith(f"{pkg_name}.")
                    or (tool_dir_str and origin_str and origin_str.startswith(tool_dir_str))
                )
            else:
                is_stale = (
                    k == full_module_name
                    or k.startswith(f"{full_module_name}.")
                    or (tool_dir_str and origin_str and origin_str.startswith(tool_dir_str))
                )
            if is_stale:
                stale.append(k)
                
        for mod in stale:
            sys.modules.pop(mod, None)
        if stale:
            logger.debug(f"Purged {len(stale)} stale module(s) for '{tool_name}'")

        # Unload any tool currently loaded under this storage_key
        if storage_key.startswith("venv_"):
            pkg_name = storage_key[5:]
            target_module_names = [f"{pkg_name}.main", f"tool_venv_{pkg_name}"]
        else:
            target_module_names = [f"tool_{storage_key}"]
            
        old_tool_names = [
            t_name for t_name, m_name in list(self._tool_module_name.items())
            if m_name in target_module_names
        ]
        for old_name in old_tool_names:
            self.unload_tool(old_name)

        # Load fresh copy
        return await self.load_tool(storage_key)
    
    # Bulk operations
    async def discover_and_load_all(self) -> Dict[str, bool]:
        """Discover and load all tools concurrently for fast startup."""
        items = await asyncio.to_thread(self.discover_tools)
        load_tasks = [self.load_tool(storage_key, _rebuild=False) for storage_key, _ in items]
        storage_keys = [storage_key for storage_key, _ in items]
        results: Dict[str, bool] = {}
        if load_tasks:
            outcomes = await asyncio.gather(*load_tasks, return_exceptions=True)
            for storage_key, outcome in zip(storage_keys, outcomes):
                if isinstance(outcome, Exception):
                    logger.error(f"Failed to load {storage_key}: {outcome}")
                    results[storage_key] = False
                else:
                    results[storage_key] = bool(outcome)
        logger.info(
            f"Loaded {sum(1 for v in results.values() if v)}/{len(results)} tools"
        )
        return results
    
    # Execution
    async def execute_tool(
        self, tool_name: str, caller: str = "direct", **kwargs
    ) -> Dict[str, Any]:
        """
        Execute a tool by its declared name.
        Args:
            tool_name: Value of ``tool_instance.name``.
            caller:    Caller context checked against ``tool.allowed_callers``.
            **kwargs:  Arguments forwarded to ``tool.execute``.
        """

        tool = self.loaded_tools.get(tool_name)
        if tool is None:
            _mcp = self.managers["mcp_manager"]
            if _mcp: 
                # check whether it's a mcp tool
                if _mcp.has_tool(tool_name):
                    return await _mcp.execute_tool(tool_name, caller, **kwargs)
            return {"error": f"Tool '{tool_name}' not found."}
        if hasattr(tool, "allowed_callers") and caller not in tool.allowed_callers:
            return {
                "error": f"Caller '{caller}' is not permitted to invoke '{tool_name}'."
            }
        try:
            return await tool.execute(caller=caller, **kwargs)
        except Exception as e:
            logger.error(f"Tool execution error ('{tool_name}'): {e}", exc_info=True)
            return {"error": str(e)}
    
    # MCP export
    def export_all_tools(self, mcp_instance: "FastMCP") -> Dict[str, bool]:
        """
        Register all MCP-eligible tools with a FastMCP server instance.
        Only tools with ``"mcp_client"`` in ``allowed_callers`` are exported.
        """
        mcp_instance._tool_manager._tools.clear()
        results: Dict[str, bool] = {}
        _type_map: Dict[str, str] = {
            "string":  "str",
            "integer": "int",
            "number":  "float",
            "boolean": "bool",
            "array":   "list",
            "object":  "dict",
        }
        for tool_name, tool in self.loaded_tools.items():
            if "mcp_client" not in (tool.allowed_callers or []):
                results[tool_name] = False
                logger.debug(f"export_all_tools: skipped '{tool_name}' (not mcp_client)")
                continue
            try:
                wrapper = self._synthesize_mcp_wrapper(tool, _type_map)
            except Exception as exc:
                results[tool_name] = False
                logger.error(
                    f"export_all_tools: failed to synthesize wrapper for '{tool_name}': {exc}",
                    exc_info=True,
                )
                continue
            try:
                mcp_instance.add_tool(wrapper)
                results[tool_name] = True
                logger.info(f"export_all_tools: registered '{tool_name}'")
            except Exception as exc:
                results[tool_name] = False
                logger.error(
                    f"export_all_tools: failed to register '{tool_name}': {exc}",
                    exc_info=True,
                )
        exported = sum(1 for v in results.values() if v)
        logger.info(
            f"export_all_tools: {exported}/{len(self.loaded_tools)} tools exported to MCP"
        )
        return results

    def _synthesize_mcp_wrapper(
        self, tool: ToolBase, type_map: Dict[str, str]
    ) -> Any:
        """
        Build a genuine async function whose parameters mirror the tool's
        ``input_schema`` so that FastMCP can introspect a real signature.
        """
        properties: Dict[str, Any] = tool.input_schema.get("properties") or {}
        required: List[str]        = tool.input_schema.get("required")    or []
        required_params = [(n, m) for n, m in properties.items() if n     in required]
        optional_params = [(n, m) for n, m in properties.items() if n not in required]
        param_parts: List[str] = []
        for param_name, meta in required_params:
            py_type = type_map.get(meta.get("type", "string"), "Any")
            param_parts.append(f"{param_name}: {py_type}")
        for param_name, meta in optional_params:
            py_type = type_map.get(meta.get("type", "string"), "Any")
            param_parts.append(f"{param_name}: Optional[{py_type}] = None")
        params_str = ", ".join(param_parts)
        fn_name    = re.sub(r"\W|^(?=\d)", "_", tool.name)
        source = (
            f"async def {fn_name}({params_str}):\n"
            f"    return await _execute(**{{k: v for k, v in locals().items() if v is not None}})\n"
        )
        async def _execute(**kwargs) -> Dict[str, Any]:
            return await tool.execute(caller="mcp_client", **kwargs)
        namespace: Dict[str, Any] = {
            "_execute": _execute,
            "Optional": Optional,
            "Any":      Any,
        }
        exec(compile(source, f"<mcp_tool:{fn_name}>", "exec"), namespace)  # noqa: S102
        fn           = namespace[fn_name]
        fn.__name__  = tool.name  # set __name__ back to original name for FastMCP registration
        fn.__doc__   = tool.description
        fn.__module__ = __name__
        return fn
    
    # Introspection helpers
    def has_tool(self, tool_name: str) -> bool:
        """Check if a tool exists by its name (either loaded locally or in MCP)."""
        if tool_name in self.loaded_tools:
            return True
        mcp = self.managers.get("mcp_manager")
        if mcp and hasattr(mcp, "has_tool"):
            return mcp.has_tool(tool_name)
        return False

    def get_tool(self, tool_name: str) -> Optional[ToolBase]:
        """Return a tool instance by its declared name, or None."""
        return self.loaded_tools.get(tool_name)

    def list_tools(self) -> List[Dict[str, Any]]:
        """Return metadata for all loaded tools."""
        return [
            {"id": name, **tool.get_schema()}
            for name, tool in self.loaded_tools.items()
        ]

    def list_tools_extended(self) -> List[Dict[str, Any]]:
        """Return metadata for all loaded tools with source info (local vs venv)."""
        result = []
        for tool_name, tool in self.loaded_tools.items():
            module_name = self._tool_module_name.get(tool_name, "")
            # Determine if tool came from venv or local Tools/ directory
            if module_name.startswith("tool_venv_"):
                pkg_name = module_name[len("tool_venv_"):]
                # Resolve the actual directory in site-packages
                folder_path = None
                for sp_dir in self._get_site_packages_dirs():
                    candidate = sp_dir / pkg_name
                    if candidate.exists():
                        folder_path = str(candidate.resolve())
                        break
                entry = {
                    "name": tool_name,
                    "description": tool.description,
                    "source": "venv",
                    "pkg_name": pkg_name,
                    "folder_path": folder_path,
                    "allowed_callers": getattr(tool, "allowed_callers", []),
                    "fields": getattr(tool, "fields", []) or [],
                }
            else:
                # local tool: storage_key is publisher_plugin
                storage_key = module_name[len("tool_"):] if module_name.startswith("tool_") else ""
                if storage_key:
                    parts = storage_key.split("_")
                    if len(parts) >= 2:
                        tool_dir = self.tools_directory / parts[0] / "_".join(parts[1:])
                        folder_path = str(tool_dir.resolve()) if tool_dir.exists() else None
                    else:
                        folder_path = None
                else:
                    folder_path = None
                entry = {
                    "name": tool_name,
                    "description": tool.description,
                    "source": "local",
                    "pkg_name": None,
                    "folder_path": folder_path,
                    "allowed_callers": getattr(tool, "allowed_callers", []),
                    "fields": getattr(tool, "fields", []) or [],
                }
            result.append(entry)
        return result

    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        """Return OpenAI-compatible function tool schemas for direct-callable tools."""
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in self.loaded_tools.values()
            if "direct" in (tool.allowed_callers or [])
        ]

    def get_schemas(self) -> List[Dict[str, Any]]:
        """Return Claude API compatible tool schemas."""
        return [tool.get_schema() for tool in self.loaded_tools.values() if "direct" in (tool.allowed_callers or [])]