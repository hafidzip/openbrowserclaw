from __future__ import annotations
from openchadpy.context import fields_ctx, coerce_scalar
import inspect
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Callable, Optional, Awaitable, Union, TYPE_CHECKING
from .context import workspace_ctx, tab_id_ctx, model_id_ctx
from .database import Database
if TYPE_CHECKING:
    from .code_sandbox import CodeSandbox
    from .model_manager import ModelManager
    from .tool_manager import ToolManager
    from .settings import Settings
    from .event_emitter import EventEmitter
    from .mcp_manager import MCPManager
CallerType = Literal["direct", "code_execution", "mcp_client"]

logger = logging.getLogger(__name__) 

class ToolRegistry(): 
    call: Callable[..., Awaitable[Dict[str, Any]]]
    schema: Dict[str, Any]

    def __init__(self, call: Callable[..., Awaitable[Dict[str, Any]]], schema: Dict[str, Any]):
        """Initialize instance-specific state and dependencies."""
        self.call = call
        self.schema = schema

    async def execute(self, **kwargs) -> Dict[str, Any]:
        res = self.call(**kwargs)
        if inspect.isawaitable(res):
            return await res
        return res
    
class ToolBase(ABC):
    """
    Base class for Claude-compatible programmatic tools.
    Each tool instance maintains its own state and can be executed
    independently without affecting other tool instances.
    """
    # Class-level metadata (shared across all instances)
    name: str = ""
    description: str = ""
    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {},
        "required": []
    }
    allowed_callers: List[CallerType] = ["direct"]
    app_name: Optional[str] = None
    tool_manager: Optional["ToolManager"]
    model_manager: Optional["ModelManager"]
    settings_manager: Optional["Settings"]
    event_emitter: Optional["EventEmitter"]
    mcp_manager: Optional["MCPManager"]
    code_sandbox: Optional["CodeSandbox"]

    def get_field(self, name: str) -> Any:
        f = fields_ctx.get()
        # Fast path: field is at the top level (already-scoped context).
        val = f.get(name, None)
        if val is None and self.name:
            # Fallback: fields are nested under the tool name,
            # e.g. {'delegate': {'Target Agent': '...'}}
            tool_fields = f.get(self.name)
            if isinstance(tool_fields, dict):
                _v = tool_fields.get(name)
                if _v: 
                    val = coerce_scalar(_v)
                
                
        return val

    async def llm_tool(
        self,
        query: str,
        tool_registry: Optional[Dict[str, ToolRegistry]] = None,
    ) -> Dict[str, Any]:
        chat_kwargs: Dict[str, Any] = {}
        mid_ctx = model_id_ctx.get()
        tools: list = []
        
        if tool_registry:
            for reg in tool_registry.values():
                tools.append(reg.schema)     
            
        if tools:
            chat_kwargs["tools"] = tools
                
        if self.model_manager:
            model_id = mid_ctx if mid_ctx else self.model_manager.get_default_id("llm")
            if model_id:
                response = await self.model_manager.text_chat(
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a tool-calling assistant. You MUST call a tool for every single response"
                                "RULES:\n"
                                "1. Every response must be a tool call.\n"
                                "2. Read each tool's description fully and follow it exactly.\n"
                                "3. Match the user's intent to the correct tool. Do not guess or improvise.\n"
                            ),
                        },
                        {"role": "user", "content": query},
                    ],
                    model_id=model_id,
                    stream=False,
                    **chat_kwargs,
                )
                
                assert isinstance(response, dict), f"Expected dict, got {type(response)}"
                logger.info(f"[llm_tool] query {query}")
                logger.info(f"[llm_tool] response {type(response)}, {json.dumps(response)}")
                logger.info(f"[llm_tool] tools available {type(tools)}, {json.dumps(tools)}")
                try:
                    tool_calls = response["choices"][0]["message"].get("tool_calls")
                except (KeyError, IndexError, TypeError):
                    logger.error(f"[llm_tool] error when try to get tool calls")
                    tool_calls = None
                    return {}
                if not tool_calls:
                    logger.error("[llm_tool] no tool_calls")
                if tool_calls:
                    results = {}
                    for call in tool_calls:
                        fn_name: str = call["function"]["name"]
                        raw_args: str = call["function"].get("arguments", "{}")
                        call_id: str = call.get("id", fn_name)
                        try:
                            kwargs = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                        except json.JSONDecodeError:
                            logger.warning(f"[llm_tool] Failed to parse arguments for {fn_name}: {raw_args}")
                            kwargs = {}
                            return {}
                        logger.info(f"[llm_tool] Executing tool '{fn_name}' with kwargs={kwargs}")
                        if tool_registry and fn_name in tool_registry:
                            result = await tool_registry[fn_name].execute(**kwargs)
                        else:
                            return {}
                        results[call_id] = result
                    return results[next(iter(results))] if len(results) == 1 else results
                return {}
            else:
                logger.error("Model ID not found")
                return {}
        logger.error("Model manager not found")
        return {}

    def html(self, tag: str, **kwargs) -> str:
        children = kwargs.pop('children', None)
        attrs_list = [f'{k}="{v}"' for k, v in kwargs.items()]
        attrs = (" " + " ".join(attrs_list)) if attrs_list else ""
        if tag in ['input', 'br', 'img', 'hr', 'meta', 'link']:
            return f'<{tag}{attrs}/>'
        if children is not None:
            if isinstance(children, list):
                children_str = "\n".join(str(c) for c in children)
            else:
                children_str = str(children)
            indented = "\n".join("  " + line for line in children_str.splitlines())
            return f'<{tag}{attrs}>\n{indented}\n</{tag}>'
        else:
            return f'<{tag}{attrs}></{tag}>'

    def __init__(self):
        """Initialize instance-specific state and dependencies."""
        # Validate required class attributes
        if not self.name:
            raise ValueError(f"{self.__class__.__name__} must define a non-empty 'name' attribute")
        if not self.description:
            raise ValueError(f"{self.__class__.__name__} must define a non-empty 'description' attribute")        
        self.tool_manager = None
        self.model_manager = None
        self.settings_manager = None

    @property
    def tab_db(self) -> Database:
        """Getter for Tab Database"""
        logger.info("Tab Database: Workspace and Tab_Id = {}, {}".format(self.workspace, self.tab_id))
        return Database(workspace=self.workspace, tab_id=self.tab_id)
    
    @property
    def db(self) -> Database:
        """Getter for Database"""
        return Database(workspace="global", tab_id="global")
    
    @property
    def workspace(self) -> str:
        """Getter for workspace name, preferring tool_manager over global context"""
        context_value = workspace_ctx.get()
        
        # If context has "global", prefer tool_manager
        if context_value == "global" and self.tool_manager:
            return self.tool_manager.active_workspace or "global"
        
        # Otherwise use context if available
        return context_value or (self.tool_manager.active_workspace if self.tool_manager else None) or "global"

    @property
    def tab_id(self) -> str:
        """Getter for tab_id, preferring tool_manager over global context"""
        context_value = tab_id_ctx.get()
        
        # If context has "global", prefer tool_manager
        if context_value == "global" and self.tool_manager:
            return self.tool_manager.active_tab_id or "global"
        
        # Otherwise use context if available
        return context_value or (self.tool_manager.active_tab_id if self.tool_manager else None) or "global"

    async def get_all_tasks(self) -> List[Dict[str, Any]]:
        """Get all tasks from the current workspace tasks table."""
        from .sqlite import sqlite
        res = await sqlite({
            "db": self.workspace,
            "command": "query",
            "sql": "SELECT id, metadata FROM tasks"
        })
        if "error" in res:
            logger.error(f"Error getting all tasks: {res['error']}")
            return []
        
        tasks = []
        for row in res.get("data", []):
            task_id = row.get("id")
            metadata_str = row.get("metadata", "{}")
            try:
                metadata = json.loads(metadata_str)
            except Exception:
                metadata = {}
            tasks.append({"id": task_id, **metadata})
        return tasks

    async def get_task(self, id: str) -> Optional[Dict[str, Any]]:
        """Get a specific task by its ID."""
        from .sqlite import sqlite
        res = await sqlite({
            "db": self.workspace,
            "command": "query",
            "sql": "SELECT id, metadata FROM tasks WHERE id = ?",
            "params": [id]
        })
        if "error" in res:
            logger.error(f"Error getting task {id}: {res['error']}")
            return None
        
        rows = res.get("data", [])
        if not rows:
            return None
        
        row = rows[0]
        task_id = row.get("id")
        metadata_str = row.get("metadata", "{}")
        try:
            metadata = json.loads(metadata_str)
        except Exception:
            metadata = {}
        return {"id": task_id, **metadata}

    async def set_task_interval(self, id: str, interval: str) -> bool:
        """Set a task's interval to a valid interval value."""
        valid_intervals = {"once", "infinite", "1h", "1d", "1w", "disabled"}
        if interval not in valid_intervals:
            raise ValueError(f"Invalid interval: '{interval}'. Must be one of {valid_intervals}")
            
        task = await self.get_task(id)
        if not task:
            return False
            
        metadata = {k: v for k, v in task.items() if k != "id"}
        metadata["interval"] = interval
        
        from .sqlite import sqlite
        from .database_manager import trigger_table_update
        
        res = await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "UPDATE tasks SET metadata = ? WHERE id = ?",
            "params": [json.dumps(metadata), id]
        })
        if "error" in res:
            logger.error(f"Error setting task interval for {id}: {res['error']}")
            return False
            
        await trigger_table_update(self.workspace, "tasks")
        return True

    async def set_task_query(self, id: str, query: str) -> bool:
        """Update the query string for a specific task."""
        task = await self.get_task(id)
        if not task:
            return False
            
        metadata = {k: v for k, v in task.items() if k != "id"}
        metadata["query"] = query
        
        from .sqlite import sqlite
        from .database_manager import trigger_table_update
        
        res = await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "UPDATE tasks SET metadata = ? WHERE id = ?",
            "params": [json.dumps(metadata), id]
        })
        if "error" in res:
            logger.error(f"Error setting task query for {id}: {res['error']}")
            return False
            
        await trigger_table_update(self.workspace, "tasks")
        return True

    async def run_task(self, id: str) -> bool:
        """Run the task once by changing its interval to 'once'."""
        return await self.set_task_interval(id, "once")

    async def disable_task(self, id: str) -> bool:
        """Disable a task and stop its stream if it's currently streaming."""
        from .database import generate_id_from_string
        from .sqlite import sqlite
        from .main import stop_stream
        
        init_tb = generate_id_from_string(f"{id}/message_state")
        res = await sqlite({
            "db": self.workspace,
            "table": init_tb,
            "command": "query",
            "sql": f"SELECT id, _v FROM {init_tb} WHERE id IN ('isStreaming', 'activeId')"
        })
        
        rows = res.get("data", [])
        is_streaming = False
        active_id = None
        for row in rows:
            val = row.get("_v")
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except Exception:
                    pass
            if row.get("id") == "isStreaming":
                is_streaming = bool(val)
            elif row.get("id") == "activeId":
                active_id = str(val or "")
                
        if is_streaming and active_id:
            stop_stream(active_id)
            
        return await self.set_task_interval(id, "disabled")

    async def delete_task(self, id: str) -> bool:
        """
        Permanently delete a task from the workspace tasks table.
        If the task is currently streaming, its active stream is stopped first.
        Args:
            id: The task ID to delete.
        Returns:
            True on success, False if the task does not exist or deletion fails.
        """
        task = await self.get_task(id)
        if not task:
            logger.warning(f"delete_task: Task '{id}' not found.")
            return False

        # Stop any active stream first (mirrors Tasks.tsx handleStopStreamingTask)
        from .database import generate_id_from_string
        from .sqlite import sqlite
        from .main import stop_stream

        init_tb = generate_id_from_string(f"{id}/message_state")
        res = await sqlite({
            "db": self.workspace,
            "table": init_tb,
            "command": "query",
            "sql": f"SELECT id, _v FROM {init_tb} WHERE id IN ('isStreaming', 'activeId')"
        })

        rows = res.get("data", [])
        is_streaming = False
        active_id = None
        for row in rows:
            val = row.get("_v")
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except Exception:
                    pass
            if row.get("id") == "isStreaming":
                is_streaming = bool(val)
            elif row.get("id") == "activeId":
                active_id = str(val or "")

        if is_streaming and active_id:
            stop_stream(active_id)

        # Delete from tasks table
        from .database_manager import trigger_table_update

        del_res = await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "DELETE FROM tasks WHERE id = ?",
            "params": [id]
        })
        if "error" in del_res:
            logger.error(f"delete_task: Failed to delete task '{id}': {del_res['error']}")
            return False

        await trigger_table_update(self.workspace, "tasks")
        return True

    def _normalize_agent(self, agent: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize raw SQLite agent node dictionary keys into Python-native types (lists, dicts, booleans).
        """
        node = dict(agent)
        
        # 1. Parse JSON fields
        for field in ("tools", "children", "toolValues", "warnings", "errors", "additionalArgs"):
            val = node.get(field)
            if isinstance(val, str):
                try:
                    node[field] = json.loads(val)
                except Exception:
                    if field in ("tools", "children", "warnings", "errors"):
                        node[field] = []
                    else:
                        node[field] = {}
            elif val is None:
                if field in ("tools", "children", "warnings", "errors"):
                    node[field] = []
                else:
                    node[field] = {}
                    
        # 2. Parse boolean fields
        for field in ("allowMultiple", "enableProgrammaticToolCalling"):
            val = node.get(field)
            if isinstance(val, str):
                node[field] = val.lower() == "true" or val == "1"
            elif isinstance(val, int):
                node[field] = bool(val)
            elif val is None:
                node[field] = False
                
        return node

    async def _find_agent_tree(self, agent_id: str) -> Optional[str]:
        """
        Find the root tree tab ID that contains the specified agent_id.
        """
        from .database import Database
        # 1. Fast path: agent_id is itself a root tab ID.
        db = Database(workspace=self.workspace, tab_id=agent_id)
        agents = await db.get("agents")
        if agents and isinstance(agents, dict) and agent_id in agents:
            return agent_id
            
        # 2. Slow path: scan all root agent trees in the workspace.
        from .sqlite import sqlite
        res = await sqlite({
            "db": self.workspace,
            "command": "query",
            "sql": "SELECT id FROM agents"
        })
        if "error" in res:
            return None
        
        root_ids = [row["id"] for row in res.get("data", []) if row.get("id")]
        for root_id in root_ids:
            try:
                test_db = Database(workspace=self.workspace, tab_id=root_id)
                flat_agents = await test_db.get("agents")
                if flat_agents and isinstance(flat_agents, dict) and agent_id in flat_agents:
                    return root_id
            except Exception:
                continue
                
        return None

    async def get_agent_trees(self) -> List[Dict[str, Any]]:
        """
        Retrieve all agent tree root tabs in the current workspace.
        Returns:
            A list of dictionaries containing tree details (id, name, icon, etc.).
        """
        from .sqlite import sqlite
        res = await sqlite({
            "db": self.workspace,
            "command": "query",
            "sql": "SELECT id, metadata FROM agents"
        })
        if "error" in res:
            logger.error(f"Error getting agent trees: {res['error']}")
            return []
            
        trees = []
        for row in res.get("data", []):
            cid = row.get("id")
            metadata_str = row.get("metadata", "{}")
            try:
                metadata = json.loads(metadata_str)
            except Exception:
                metadata = {}
            trees.append({"id": cid, **metadata})
        return trees

    async def get_agents(self, agent_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Retrieve all agent nodes for the tree containing the specified agent_id.
        Args:
            agent_id: Either the tree/root tab ID itself, or any agent node ID inside that tree.
        Returns:
            A dictionary mapping agent IDs to their AgentNode property dictionaries.
        """
        tree_id = await self._find_agent_tree(agent_id)
        if not tree_id:
            return {}
        from .database import Database
        db = Database(workspace=self.workspace, tab_id=tree_id)
        agents = await db.get("agents")
        if not agents or not isinstance(agents, dict):
            return {}
            
        # Normalize each agent node dictionary
        normalized = {}
        for nid, node in agents.items():
            normalized[nid] = self._normalize_agent(node)
        return normalized

    async def get_agent_tree(self, agent_id: str) -> Dict[str, Any]:
        """
        Build and retrieve the nested agent tree for the tree containing the specified agent_id.
        Converts the flat nodes storage in SQLite into a nested tree where the 'children'
        key of each node is a dictionary of child node IDs mapping to their nested subtree.
        Args:
            agent_id: Either the tree/root tab ID itself, or any agent node ID inside that tree.
        """
        agents = await self.get_agents(agent_id)
        if not agents:
            return {}

        # Identify root nodes
        all_child_ids = {
            cid
            for n in agents.values()
            for cid in n.get("children", [])
        }
        root_ids = [nid for nid in agents if nid not in all_child_ids]

        # Recursively build the tree
        def build_node(nid: str) -> dict:
            if nid not in agents:
                return {}
            n = agents[nid]
            return {
                **{k: v for k, v in n.items() if k != "children"},
                "children": {
                    cid: build_node(cid)
                    for cid in n.get("children", [])
                }
            }

        return {nid: build_node(nid) for nid in root_ids}

    async def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve properties of a specific agent node by automatically locating its tree.
        Args:
            agent_id: The ID of the target agent node.
        Returns:
            The agent property dictionary, or None if not found.
        """
        agents = await self.get_agents(agent_id)
        return agents.get(agent_id)

    async def update_agent(self, agent_id: str, properties: Dict[str, Any]) -> bool:
        """
        Modify/merge properties of an existing agent node.
        Args:
            agent_id: The ID of the target agent node.
            properties: A dictionary of fields to merge/update (e.g. {'model': 'gpt-4o'}).
        Returns:
            True if updated successfully, False if agent does not exist.
        """
        tree_id = await self._find_agent_tree(agent_id)
        if not tree_id:
            logger.warning(f"update_agent: tree containing agent '{agent_id}' not found.")
            return False

        from .database import Database
        db = Database(workspace=self.workspace, tab_id=tree_id)
        agents = await db.get("agents")
        if not agents or agent_id not in agents:
            return False

        # Merge properties into existing AgentNode dictionary
        agents[agent_id].update(properties)
        
        # Save back the single agent key to sync_table
        return await db.set("agents", agent_id, agents[agent_id])

    async def add_agent(
        self,
        agent_id: str,
        name: str,
        parent_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[List[str]] = None,
        allow_multiple: bool = False,
        enable_programmatic_tool_calling: bool = False,
        additional_args: Optional[Dict[str, Any]] = None,
        skill_path: Optional[str] = None
    ) -> bool:
        """
        Create a new agent node. If parent_id is specified, links it to the parent
        under the parent's tree. If parent_id is None, it creates a new root agent tree.
        Args:
            agent_id: Unique string identifier for the new agent.
            name: Human-readable display name.
            parent_id: Optional parent agent ID.
            model: Optional LLM model identifier.
            tools: Optional list of tool names this agent can use.
            allow_multiple: Whether to allow multiple concurrent child runs.
            enable_programmatic_tool_calling: Enable frontier model tool calling.
            additional_args: Key-value settings dictionary.
            skill_path: Path to target SKILL.md file.
        Returns:
            True on success, False if parent does not exist or agent_id is taken.
        """
        import time
        tree_id = None
        if parent_id:
            tree_id = await self._find_agent_tree(parent_id)
            if not tree_id:
                logger.warning(f"add_agent: Parent agent '{parent_id}' not found.")
                return False
        else:
            # No parent: create a new root tree tab
            tree_id = agent_id
            from .sqlite import sqlite
            # Register root tab in agents table
            await sqlite({
                "db": self.workspace,
                "command": "execute",
                "sql": "CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, metadata TEXT)"
            })
            await sqlite({
                "db": self.workspace,
                "command": "execute",
                "sql": "INSERT OR REPLACE INTO agents (id, metadata) VALUES (?, ?)",
                "params": [tree_id, json.dumps({"name": name, "icon": "Drama", "timestamp": int(time.time() * 1000)})]
            })
            # Trigger agents update event on frontend
            from openchadpy.event_emitter import event_emitter
            await event_emitter.emit("agents-update", {})

        agents = await self.get_agents(tree_id)
        if agent_id in agents:
            logger.warning(f"add_agent: Agent '{agent_id}' already exists on tree '{tree_id}'.")
            return False

        new_agent = {
            "id": agent_id,
            "name": name,
            "tools": tools or [],
            "children": [],
            "toolValues": {},
            "allowMultiple": allow_multiple,
            "enableProgrammaticToolCalling": enable_programmatic_tool_calling,
            "model": model,
            "warnings": [],
            "errors": [],
            "skillPath": skill_path,
            "additionalArgs": additional_args or {}
        }

        from .database import Database
        db = Database(workspace=self.workspace, tab_id=tree_id)

        # Update parent's children list if parent specified
        if parent_id:
            parent_node = agents[parent_id]
            parent_children = list(parent_node.get("children", []))
            if agent_id not in parent_children:
                parent_children.append(agent_id)
                parent_node["children"] = parent_children
                # Sync parent node update first
                await db.set("agents", parent_id, parent_node)

        # Sync new agent node
        return await db.set("agents", agent_id, new_agent)

    async def delete_agent(self, agent_id: str) -> bool:
        """
        Delete an agent node from its tree and remove references from its parent.
        If the deleted agent is the root tree node itself, the tree root is deleted as well.
        Args:
            agent_id: The ID of the agent to delete.
        Returns:
            True on success.
        """
        tree_id = await self._find_agent_tree(agent_id)
        if not tree_id:
            return True

        from .database import Database
        db = Database(workspace=self.workspace, tab_id=tree_id)
        agents = await db.get("agents")
        if not agents:
            return True

        # Find and remove reference from parent's children lists
        for pid, pnode in agents.items():
            if agent_id in pnode.get("children", []):
                pnode["children"] = [cid for cid in pnode["children"] if cid != agent_id]
                await db.set("agents", pid, pnode)

        # Delete agent node
        await db.delete("agents", agent_id)

        # If we deleted the root tree node itself, clean up the workspace table entry
        if agent_id == tree_id:
            from .sqlite import sqlite
            await sqlite({
                "db": self.workspace,
                "command": "execute",
                "sql": "DELETE FROM agents WHERE id = ?",
                "params": [tree_id]
            })
            # Trigger agents update event on frontend
            from openchadpy.event_emitter import event_emitter
            await event_emitter.emit("agents-update", {})

        return True

    async def update_agent_tree(self, agent_id: str, tree: Dict[str, Any]) -> bool:
        """
        Replace the subtree rooted at agent_id with a new tree structure.
        - If agent_id is the root: the entire tree is replaced.
        - If agent_id is a child node: only the subtree below that node is replaced.
          The agent_id itself is kept; its children and all descendants are deleted and
          replaced with the children from the new tree definition.
        
        Args:
            agent_id: The ID of the node to use as the root of the replacement subtree.
                      Can be the root tree ID or any child node ID.
            tree: A dictionary representing the new agent subtree (same format as create_agent_tree).
                  Example:
                    {
                        "name": "CEO",
                        "model": "gpt-4o",
                        "tools": ["delegate"],
                        "children": [
                            {"name": "Worker 1"},
                            {"name": "Worker 2", "children": [...]}
                        ]
                    }
        Returns:
            True on success, False if agent_id does not exist.
        """
        if not isinstance(tree, dict):
            logger.error("update_agent_tree: 'tree' argument must be a dictionary.")
            return False

        tree_id = await self._find_agent_tree(agent_id)
        if not tree_id:
            logger.warning(f"update_agent_tree: Agent '{agent_id}' not found in any tree.")
            return False

        import uuid
        from .database import Database

        db = Database(workspace=self.workspace, tab_id=tree_id)
        current_flat = await db.get("agents")
        if not current_flat:
            current_flat = {}

        # 1. Collect all old descendant IDs of agent_id (excluding agent_id itself)
        def collect_descendants(nid: str) -> set:
            visited = set()
            stack = list(current_flat.get(nid, {}).get("children", []))
            if isinstance(stack, str):
                try:
                    import json as _json
                    stack = _json.loads(stack)
                except Exception:
                    stack = []
            while stack:
                cid = stack.pop()
                if cid in visited or cid not in current_flat:
                    continue
                visited.add(cid)
                raw_children = current_flat[cid].get("children", [])
                if isinstance(raw_children, str):
                    try:
                        import json as _json
                        raw_children = _json.loads(raw_children)
                    except Exception:
                        raw_children = []
                stack.extend(raw_children)
            return visited

        old_descendants = collect_descendants(agent_id)

        # 2. Parse the new subtree: agent_id is the root node, children get new UUIDs
        new_flat: Dict[str, Any] = {}

        def parse_node(node_dict: Dict[str, Any], node_id: str) -> str:
            if not isinstance(node_dict, dict):
                node_dict = {}

            name = str(node_dict.get("name") or "Agent")

            raw_tools = node_dict.get("tools")
            tools = []
            if isinstance(raw_tools, list):
                tools = [str(t) for t in raw_tools if t is not None]
            elif isinstance(raw_tools, str):
                tools = [raw_tools]

            child_ids = []
            raw_children = node_dict.get("children")
            if isinstance(raw_children, list):
                for child_dict in raw_children:
                    if isinstance(child_dict, dict):
                        child_uuid = str(uuid.uuid4())
                        parse_node(child_dict, child_uuid)
                        child_ids.append(child_uuid)
            elif isinstance(raw_children, dict):
                for child_uuid, child_dict in raw_children.items():
                    if isinstance(child_dict, dict):
                        parse_node(child_dict, child_uuid)
                        child_ids.append(child_uuid)

            raw_tool_values = node_dict.get("toolValues") or node_dict.get("tool_values")
            tool_values: dict = {}
            if isinstance(raw_tool_values, dict):
                tool_values = {str(k): v for k, v in raw_tool_values.items()}

            allow_multiple = bool(node_dict.get("allowMultiple") or node_dict.get("allow_multiple", False))
            enable_ptc = bool(
                node_dict.get("enableProgrammaticToolCalling") or
                node_dict.get("enable_programmatic_tool_calling", False)
            )

            model = node_dict.get("model")
            model = str(model) if model is not None else None

            warnings_list: list = []
            raw_warn = node_dict.get("warnings")
            if isinstance(raw_warn, list):
                warnings_list = [str(w) for w in raw_warn]

            errors_list: list = []
            raw_err = node_dict.get("errors")
            if isinstance(raw_err, list):
                errors_list = [str(e) for e in raw_err]

            skill_path = node_dict.get("skillPath") or node_dict.get("skill_path")
            skill_path = str(skill_path) if skill_path is not None else None

            additional_args: dict = {}
            raw_args = node_dict.get("additionalArgs") or node_dict.get("additional_args")
            if isinstance(raw_args, dict):
                additional_args = {str(k): v for k, v in raw_args.items()}

            new_flat[node_id] = {
                "id": node_id,
                "name": name,
                "tools": tools,
                "children": child_ids,
                "toolValues": tool_values,
                "allowMultiple": allow_multiple,
                "enableProgrammaticToolCalling": enable_ptc,
                "model": model,
                "warnings": warnings_list,
                "errors": errors_list,
                "skillPath": skill_path,
                "additionalArgs": additional_args
            }
            return node_id

        parse_node(tree, agent_id)

        # 3. Delete all old descendants from db
        for desc_id in old_descendants:
            await db.delete("agents", desc_id)

        # 4. Write all new flat nodes (includes updated agent_id node)
        for nid, node in new_flat.items():
            ok = await db.set("agents", nid, node)
            if not ok:
                logger.error(f"update_agent_tree: Failed to write node '{nid}'.")
                return False

        return True

    async def get_models(self) -> List[Dict[str, Any]]:

        """
        Return all available LLM/VLM models from the python config.json.
        Mirrors the frontend useAvailableModels() hook in index.ts.
        Returns:
            A list of model dictionaries with the following keys:
                id, name, backend, model_type, model_path, mmproj, filename,
                api_base, is_local, is_loaded, last_error
        """
        import os

        # Locate config.json — same logic as main.py
        config_path = os.environ.get("OPENCHAD_CONFIG_PATH")
        if not config_path:
            project_dir = os.environ.get("OPENCHAD_PROJECT_DIR", "")
            python_root = os.path.join(project_dir, "python")
            config_path = os.path.join(python_root, "config.json")

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                parsed = json.load(f)
        except FileNotFoundError:
            logger.warning(f"get_models: config.json not found at '{config_path}'.")
            return []
        except Exception as e:
            logger.error(f"get_models: Failed to read/parse config.json: {e}")
            return []

        available_models = parsed.get("available_models")
        if not available_models or not isinstance(available_models, dict):
            return []

        loaded_models: dict = parsed.get("models") or {}

        result = []
        for model_id, m in available_models.items():
            if not isinstance(m, dict):
                continue
            model_type = m.get("model_type") or []
            backend = m.get("backend")
            # Filter: only LLM/VLM models with a backend (same as frontend filter)
            if not backend:
                continue
            if not any(t in model_type for t in ("llm", "vlm")):
                continue

            loaded_entry = loaded_models.get(model_id, {}) if isinstance(loaded_models, dict) else {}
            last_error = loaded_entry.get("last_error") if isinstance(loaded_entry, dict) else None
            is_loaded = model_id in loaded_models and not last_error

            result.append({
                "id": model_id,
                "name": m.get("name") or "Unknown",
                "backend": backend,
                "model_type": model_type,
                "model_path": m.get("model_path"),
                "mmproj": m.get("mmproj"),
                "filename": m.get("filename"),
                "api_base": m.get("api_base"),
                "is_local": bool(m.get("is_local", False)),
                "is_loaded": is_loaded,
                "last_error": str(last_error) if last_error else None,
            })

        return result

    async def create_task(self, query: str, agent_id: str, interval: Optional[str] = "once") -> Optional[str]:
        """
        Create a new task in the current workspace tasks table.
        Args:
            query: The query text for the task.
            agent_id: The target agent ID that will run the task.
            interval: Optional schedule interval (defaults to 'once').
        Returns:
            The generated task ID string on success, or None on failure.
        """
        import uuid
        import time
        from .sqlite import sqlite
        from .database_manager import trigger_table_update

        task_id = str(uuid.uuid4())
        
        valid_intervals = {"once", "infinite", "1h", "1d", "1w", "disabled"}
        if interval not in valid_intervals:
            raise ValueError(f"Invalid interval: '{interval}'. Must be one of {valid_intervals}")

        metadata = {
            "icon": "AlarmClockCheck",
            "query": query,
            "interval": interval or "once",
            "agent": agent_id,
            "timestamp": int(time.time() * 1000)
        }

        # 1. Ensure tasks table exists
        await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, metadata TEXT)"
        })

        # 2. Insert the task
        res = await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "INSERT OR REPLACE INTO tasks (id, metadata) VALUES (?, ?)",
            "params": [task_id, json.dumps(metadata)]
        })
        if "error" in res:
            logger.error(f"Error creating task: {res['error']}")
            return None

        # 3. Notify table update
        await trigger_table_update(self.workspace, "tasks")
        return task_id

    async def create_agent_tree(self, tree: Dict[str, Any]) -> Optional[str]:
        """
        Create a new root agent tree tab and initialize it with a hierarchical tree structure of agents.
        Each node in the input tree dictionary represents an agent and can have a list of child dictionaries under 'children'.
        IDs for all agents in the tree are automatically generated (UUID4).
        
        Args:
            tree: A dictionary representing the agent tree. Example:
                {
                    "name": "CEO",
                    "model": "gpt-4o",
                    "tools": ["delegate"],
                    "children": [
                        {"name": "Worker 1", "tools": ["web_search"]},
                        {"name": "Worker 2", "children": [...]}
                    ]
                }
        Returns:
            The root tree ID (UUID4 string) on success, or None on failure.
        """
        if not isinstance(tree, dict):
            logger.error("create_agent_tree: 'tree' argument must be a dictionary.")
            return None

        import uuid
        import time
        from .sqlite import sqlite
        from openchadpy.event_emitter import event_emitter
        from .database import Database

        root_tree_id = str(uuid.uuid4())
        root_name = str(tree.get("name") or "Root Agent")

        # 1. Register root tree tab in agents table
        await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, metadata TEXT)"
        })
        res = await sqlite({
            "db": self.workspace,
            "command": "execute",
            "sql": "INSERT OR REPLACE INTO agents (id, metadata) VALUES (?, ?)",
            "params": [root_tree_id, json.dumps({"name": root_name, "icon": "Drama", "timestamp": int(time.time() * 1000)})]
        })
        if "error" in res:
            logger.error(f"Error registering root tree in create_agent_tree: {res['error']}")
            return None

        flat_agents = {}

        def parse_node(node_dict: Dict[str, Any], node_id: str) -> str:
            # Enforce dictionary type
            if not isinstance(node_dict, dict):
                node_dict = {}

            # Sanitize name
            name = str(node_dict.get("name") or "Agent")

            # Sanitize tools: must be list of strings
            raw_tools = node_dict.get("tools")
            tools = []
            if isinstance(raw_tools, list):
                tools = [str(t) for t in raw_tools if t is not None]
            elif isinstance(raw_tools, str):
                tools = [raw_tools]

            # Recursively parse children
            child_ids = []
            raw_children = node_dict.get("children")
            if isinstance(raw_children, list):
                for child_dict in raw_children:
                    if isinstance(child_dict, dict):
                        child_uuid = str(uuid.uuid4())
                        parsed_cid = parse_node(child_dict, child_uuid)
                        child_ids.append(parsed_cid)
            elif isinstance(raw_children, dict):
                for child_uuid, child_dict in raw_children.items():
                    if isinstance(child_dict, dict):
                        parsed_cid = parse_node(child_dict, child_uuid)
                        child_ids.append(parsed_cid)

            # Sanitize toolValues: must be a dict
            raw_tool_values = node_dict.get("toolValues") or node_dict.get("tool_values")
            tool_values = {}
            if isinstance(raw_tool_values, dict):
                tool_values = {str(k): v for k, v in raw_tool_values.items()}

            # Sanitize boolean fields
            allow_multiple = bool(node_dict.get("allowMultiple") or node_dict.get("allow_multiple", False))
            enable_programmatic_tool_calling = bool(
                node_dict.get("enableProgrammaticToolCalling") or 
                node_dict.get("enable_programmatic_tool_calling", False)
            )

            # Sanitize model
            model = node_dict.get("model")
            model = str(model) if model is not None else None

            # Sanitize warnings/errors: must be list of strings
            warnings = []
            raw_warnings = node_dict.get("warnings")
            if isinstance(raw_warnings, list):
                warnings = [str(w) for w in raw_warnings]
            errors = []
            raw_errors = node_dict.get("errors")
            if isinstance(raw_errors, list):
                errors = [str(e) for e in raw_errors]

            # Sanitize skillPath
            skill_path = node_dict.get("skillPath") or node_dict.get("skill_path")
            skill_path = str(skill_path) if skill_path is not None else None

            # Sanitize additionalArgs: must be dict
            additional_args = {}
            raw_args = node_dict.get("additionalArgs") or node_dict.get("additional_args")
            if isinstance(raw_args, dict):
                additional_args = {str(k): v for k, v in raw_args.items()}

            flat_agents[node_id] = {
                "id": node_id,
                "name": name,
                "tools": tools,
                "children": child_ids,
                "toolValues": tool_values,
                "allowMultiple": allow_multiple,
                "enableProgrammaticToolCalling": enable_programmatic_tool_calling,
                "model": model,
                "warnings": warnings,
                "errors": errors,
                "skillPath": skill_path,
                "additionalArgs": additional_args
            }
            return node_id

        # Parse starting from the root tree
        parse_node(tree, root_tree_id)

        # 2. Sync flat agents map to tree database
        db = Database(workspace=self.workspace, tab_id=root_tree_id)
        for nid, agent_node in flat_agents.items():
            ok = await db.set("agents", nid, agent_node)
            if not ok:
                logger.error(f"Error initializing node '{nid}' in create_agent_tree")
                return None

        # Emit frontend updates
        await event_emitter.emit("agents-update", {})
        return root_tree_id

    def get_schema(self) -> Dict[str, Any]:
        """
        Return LLM API compatible tool schema.
        This can be passed directly to the LLM API tools array.
        Returns:
            Schema dictionary containing tool metadata
        """
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "allowed_callers": self.allowed_callers
        }
    @abstractmethod

    async def execute(self, **kwargs) -> Dict[str, Any]:
        """
        Execute the tool with given parameters.
        Must be async to support parallel calling from code execution.
        Subclasses must implement this method to define tool behavior.
        Args:
            **kwargs: Tool-specific parameters matching input_schema
        Returns:
            Dictionary containing the tool result (will be serialized to JSON)
        Raises:
            NotImplementedError: If subclass doesn't implement this method
        """
        pass

    def on_register(self) -> None:
        """
        Called when tool is loaded/registered.
        Override this method to perform setup operations like:
        - Initializing connections
        - Loading resources
        - Validating configuration
        """
        pass

    def on_unregister(self) -> None:
        """
        Called when tool is unloaded/unregistered.
        Override this method to perform cleanup operations like:
        - Closing connections
        - Releasing resources
        - Saving state
        """
        pass

    def __repr__(self) -> str:
        """String representation of the tool."""
        return f"<Tool: {self.name}>"

    def __str__(self) -> str:
        """Human-readable string representation."""
        return f"{self.name}: {self.description[:50]}..." if len(self.description) > 50 else f"{self.name}: {self.description}"