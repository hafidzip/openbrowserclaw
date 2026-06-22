from openchadpy.context import agent_ctx
import json
import logging
import os
import re
from openchadpy.tool_base import ToolRegistry
from typing import Any, Optional, List, Dict, Callable, Awaitable, Tuple, TYPE_CHECKING
import asyncio
from pathlib import Path
from .context import workspace_ctx, tab_id_ctx, model_id_ctx
from .database import Database
if TYPE_CHECKING:
    from .model_manager import ModelManager
    from .tool_manager import ToolManager
    from .settings import Settings
    from .event_emitter import EventEmitter
    from .mcp_manager import MCPManager
logger = logging.getLogger(__name__) 
class PipelineBase:
    stream: bool
    attempt: int
    prompt: str
    _stream_start_time: float
    _stream_end_time: float
    _completion_tokens: int
    _prompt_tokens: int
    _costs: List[Dict[str, Any]]
    # Managers
    tool_manager: Optional["ToolManager"]
    model_manager: Optional["ModelManager"]
    settings_manager: Optional["Settings"]
    event_emitter: Optional["EventEmitter"]
    mcp_manager: Optional["MCPManager"]
    workspace: Optional[str]
    history: List[Dict[str, str]]    
    model_responses: List[Dict[str, str]]
    context: str
    query: Optional[str]
    files: Optional[List[str]]
    tab_id: Optional[str]
    branch_id: Optional[str]
    response_branch: Optional[int]
    index: Optional[int]
    tb: Optional[str]
    tab_db: Optional["Database"]
    db: Optional["Database"]
    send_event: Optional[Callable[[str, Dict[str, Any]], Awaitable[None]]]
    messages: List[Dict[str, Any]]
    tools: List[Dict[str, Any]]
    tool_choice: Dict[str, Any]
    tool_calls: Optional[List[Dict[str, Any]]]
    args: Dict[str, Any]
    pricing: Optional[Dict[str, Any]]
    model_name: Optional[str]
    model_id: Optional[str]
    set_continue: Optional[Callable[[bool], None]]
    cancel_event: asyncio.Event
    last_response: str
    async def llm_tool(
        self,
        query: str,
        tool_registry: Optional[Dict[str, ToolRegistry]] = None,
        history_id: Optional[str] = None,
    ) -> Any:
        chat_kwargs: Dict[str, Any] = {}
        mid_ctx = model_id_ctx.get()
        tools: list = []
        context = ""

        # --- History loading ---
        history_messages: List[Dict[str, Any]] = []
        if history_id and self.db:
            try:
                stored = await self.db.get("llm_tool_history", history_id)
                if isinstance(stored, list):
                    history_messages = stored[-8:]
                    logger.info(f"[llm_tool] loaded {len(history_messages)} history messages for id={history_id}")
            except Exception as e:
                logger.warning(f"[llm_tool] could not load history for id={history_id}: {e}")

        async def _save_history(user_query: str, assistant_content: str) -> None:
            """Persist the new turn and keep a rolling window of 8 messages."""
            if not history_id or not self.db:
                return
            try:
                stored = await self.db.get("llm_tool_history", history_id)
                turns: List[Dict[str, Any]] = stored if isinstance(stored, list) else []
                turns.append({"role": "user", "content": user_query})
                turns.append({"role": "assistant", "content": assistant_content})
                turns = turns[-8:]
                await self.db.set("llm_tool_history", history_id, turns)
                logger.info(f"[llm_tool] saved history for id={history_id} ({len(turns)} messages)")
            except Exception as e:
                logger.warning(f"[llm_tool] could not save history for id={history_id}: {e}")
        
        if tool_registry:
            for reg in tool_registry.values():
                tools.append(reg.schema)
        else: 
            if self.tool_manager:
                tools.extend(self.tool_manager.get_openai_schemas())
            if self.mcp_manager:
                tools.extend(self.mcp_manager.get_openai_schemas())
        agent = agent_ctx.get()
        if not tool_registry and agent and isinstance(agent, dict):
            all_tools = list(tools)
            current_agent_id = next(iter(agent))
            agent_node = agent.get(current_agent_id)
            if agent_node:
                # Add agent_query tool schema if children exist
                children = agent_node.get("children")
                if children:  
                    if agent_node.get("allowMultiple", False):
                        tools.append({
                            "type": "function",
                            "function": {
                                "name": "agent_query",
                                "description": "Send queries to one or more agents and retrieve their responses. Use this to delegate subtasks or gather information from specialized agents.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "queries": {
                                            "type": "array",
                                            "description": "List of queries to send to agents. Multiple entries allow querying several agents in a single call.",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "agent_id": {
                                                        "type": "string",
                                                        "description": "The unique identifier of the target agent."
                                                    },
                                                    "tasks": {
                                                        "type": "array",
                                                        "description": "List of tasks or questions to delegate to the target agent.",
                                                        "items": {
                                                            "type": "string",
                                                            "description": "A specific question or instruction for the agent."
                                                        }
                                                    }
                                                },
                                                "required": ["agent_id", "tasks"]
                                            },
                                            "minItems": 1
                                        }
                                    },
                                    "required": ["queries"]
                                }
                            }
                        })
                    else:
                        tools.append({
                                "type": "function",
                                "function": {
                                    "name": "agent_query",
                                    "description": "Send a list of tasks to a specific agent and retrieve its response. Use this to delegate subtasks or gather information from specialized agents.",
                                    "parameters": {
                                        "type": "object",
                                        "properties": {
                                            "agent_id": {
                                                "type": "string",
                                                "description": "The unique identifier of the target agent."
                                            },
                                            "tasks": {
                                                "type": "array",
                                                "description": "List of tasks or questions to delegate to the target agent.",
                                                "items": {
                                                    "type": "string",
                                                    "description": "A specific question or instruction for the agent."
                                                }
                                            }
                                        },
                                        "required": ["agent_id", "tasks"]
                                    }
                                }
                            })
                    # Add the appended agent_query to all_tools
                    all_tools.append(tools[-1])

                # Helper to check if a file exists and is not empty
                def is_file_non_empty(file_path: str) -> bool:
                    if not file_path:
                        return False
                    try:
                        return os.path.isfile(file_path) and os.path.getsize(file_path) > 0
                    except Exception:
                        return False

                # Helper to read full skill content for root agent (depth 0)
                def get_skill_content(skill_path: str) -> str:
                    if not skill_path:
                        return ""
                    try: 
                        with open(skill_path, "r", encoding="utf-8") as f:
                            return f.read().strip()
                    except Exception as e: 
                        logger.error(f"[llm_tool] error when try to get skill path: {e}")
                        return ""

                # Helper to extract skill name and description for sub-agents (depth > 0)
                def get_skill_info(skill_path: str) -> Tuple[str, str]:
                    if not skill_path:
                        return "", ""
                    try:
                        skill_filename = os.path.basename(skill_path)
                    except Exception:
                        skill_filename = "skill.md"
                    try:
                        with open(skill_path, "r", encoding="utf-8") as f:
                            for line in f:
                                stripped = line.strip()
                                if stripped:
                                    # Found the first non-empty line. Strip headers/bullets.
                                    desc = stripped.lstrip("#").lstrip("-").lstrip("*").strip()
                                    return skill_filename, desc
                            return skill_filename, "No description available"
                    except Exception:
                        return skill_filename, "No description available"

                # Recursive agent prompt formatter
                def format_agent(a_id: str, a_node: dict, depth: int) -> str:
                    lines = []
                    
                    # 1. Agent Header
                    if depth == 0:
                        lines.append(f"# Agent `{a_id}`")
                    elif depth == 1:
                        lines.append(f"### `{a_id}`")
                    else:
                        lines.append(f"##### `{a_id}`")
                    lines.append("")

                    # 2. Skills
                    skill_path = a_node.get("skillPath")
                    if skill_path and is_file_non_empty(skill_path):
                        if depth == 0:
                            content = get_skill_content(skill_path)
                            if content:
                                lines.append("## Skills")
                                lines.append(content)
                                lines.append("")
                        else:
                            header = "#### Skills" if depth == 1 else "**Skills**"
                            fname, fdesc = get_skill_info(skill_path)
                            if fname and fdesc:
                                lines.append(header)
                                fdesc = fdesc.strip().rstrip('.')
                                lines.append(f"- `{fname}` — {fdesc}.")
                                lines.append("")

                    # 3. Tools
                    allowed_tools_list = a_node.get("tools", [])
                    a_children = a_node.get("children", {})
                    has_tools = bool(allowed_tools_list) or bool(a_children)
                    if has_tools:
                        if depth == 0:
                            lines.append("## Tools")
                        elif depth == 1:
                            lines.append("#### Tools")
                        else:
                            lines.append("**Tools**")

                        for t_name in allowed_tools_list:
                            t_desc = "No description available"
                            for t in all_tools:
                                if isinstance(t, dict) and t.get("function", {}).get("name") == t_name:
                                    t_desc = t.get("function", {}).get("description") or "No description available"
                                    break
                            t_desc = t_desc.strip().rstrip('.')
                            lines.append(f"- `{t_name}` — {t_desc}.")

                        # Handle agent_query if children exist
                        if a_children:
                            if depth == 0:
                                lines.append("- `agent_query` — Delegate a task to a sub-agent.")
                            else:
                                lines.append("- `agent_query` — Delegate a task to a sub-agent (see below).")
                        lines.append("")

                    # 4. Sub-Agents
                    if a_children and depth < 2:
                        if depth == 0:
                            lines.append("## Sub-Agents")
                        elif depth == 1:
                            lines.append("#### Sub-Agents")
                        else:
                            lines.append("**Sub-Agents**")
                        lines.append("")

                        for child_id, child_node in a_children.items():
                            child_str = format_agent(child_id, child_node, depth + 1)
                            if child_str:
                                lines.append(child_str)
                                lines.append("")

                    return "\n".join(lines).strip()

                # Generate raw prompt and clean up consecutive newlines
                raw_prompt = format_agent(current_agent_id, agent_node, 0)
                context = re.sub(r'\n{3,}', '\n\n', raw_prompt).strip()
                import platform
                from datetime import datetime
                os_info = f"{platform.system()} {platform.release()}"
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                context += (
                    f"\n\n## Environment\n"
                    f"- OS Information: {os_info}\n"
                    f"- Current Date & Time: {now_str}"
                )

                # Ensure agent_query is allowed if children exist
                allowed_tools = set(agent_node.get("tools", []))
                if children:
                    allowed_tools.add("agent_query")

                # Filter tools for the root agent
                tools = [
                    t for t in tools
                    if t.get("function", {}).get("name") in allowed_tools
                ]

        if tools:
            chat_kwargs["tools"] = tools
                
        current_agent_id = next(iter(agent)) if (agent and isinstance(agent, dict)) else None
        
        heartbeat_task = None
        if current_agent_id and self.event_emitter:
            import time
            # Emit immediate heartbeat
            await self.event_emitter.emit("agent_heartbeat", {
                "agent_id": current_agent_id,
                "timestamp": time.time()
            })
            
            async def send_heartbeats():
                try:
                    while True:
                        await asyncio.sleep(1.0)
                        if self.event_emitter:
                            await self.event_emitter.emit("agent_heartbeat", {
                                "agent_id": current_agent_id,
                                "timestamp": time.time()
                            })
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Error in agent heartbeat task: {e}")
            
            heartbeat_task = asyncio.create_task(send_heartbeats())

        try:
            if self.model_manager:
                model_id = mid_ctx if mid_ctx else self.model_manager.get_default_id("llm")
                if model_id:
                    messages = [
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
                        *history_messages,
                        {"role": "user", "content": query},
                    ] if not agent else [
                        {
                            "role": "system",
                            "content": context,
                        },
                        *history_messages,
                        {"role": "user", "content": query},
                    ]
                    
                    multi_step = (agent_ctx.get() is not None)
                    
                    while True:
                        response = await self.model_manager.text_chat(
                            messages=messages,
                            model_id=model_id,
                            stream=False,
                            **chat_kwargs,
                        )
                        
                        assert isinstance(response, dict), f"Expected dict, got {type(response)}"
                        logger.info(f"[llm_tool] query {query}")
                        logger.info(f"[llm_tool] response {type(response)}, {json.dumps(response)}")
                        logger.info(f"[llm_tool] tools available {type(tools)}, {json.dumps(tools)}")
                        try:
                            message = response["choices"][0]["message"]
                            tool_calls = message.get("tool_calls")
                        except (KeyError, IndexError, TypeError):
                            logger.error(f"[llm_tool] error when try to get tool calls")
                            tool_calls = None
                            return {}
                        if not tool_calls:
                            logger.info("[llm_tool] no tool_calls")
                            if multi_step:
                                final_content = message.get("content") or ""
                                await _save_history(query, final_content)
                                return final_content
                            else:
                                return {}
                        if tool_calls and (self.tool_manager or tool_registry):
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
                                    if self.tool_manager:
                                        result = await self.tool_manager.execute_tool(
                                            fn_name,
                                            caller="direct",
                                            workspace=self.workspace,
                                            tab_id=self.tab_id,
                                            **kwargs,
                                        )
                                    else:
                                        return {}
                                results[call_id] = result
                            
                            if not multi_step:
                                return results[next(iter(results))] if len(results) == 1 else results
                            
                            messages.append(message)
                            for call_id, result in results.items():
                                if isinstance(result, dict):
                                    content_str = json.dumps(result)
                                else:
                                    content_str = str(result)
                                    
                                messages.append({
                                    "role": "tool",
                                    "tool_call_id": call_id,
                                    "name": next((c["function"]["name"] for c in tool_calls if c.get("id", c["function"]["name"]) == call_id), ""),
                                    "content": content_str
                                })
                        else:
                            return {}
                else:
                    logger.error("Model ID not found")
                    return {}
            else:
                logger.error("Model manager not found")
                return {}
        finally:
            if heartbeat_task:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass


    
    def __init__(self, **kwargs):
        self.attempt = 0
        # Initialize all attributes
        self.settings_manager = kwargs.get('settings_manager', None)
        self.event_emitter = kwargs.get('event_emitter', None)
        self.mcp_manager = kwargs.get('mcp_manager', None)
        self.tool_manager = kwargs.get('tool_manager', None)
        self.model_manager = kwargs.get('model_manager', None)
        self.messages = kwargs.get('messages', [])
        self.args = kwargs.get('args', {})
        self.workspace = kwargs.get('workspace', None)        
        self.model_responses = []
        self.last_response = ""
        self.tools = []
        self.tool_choice = {}
        self.tool_calls = []
        self.history = []
        self.context = ""
        self.query = kwargs.get('query', None)
        self.files = kwargs.get('files', [])
        self.tab_id = kwargs.get('tab_id', None)
        self.branch_id = kwargs.get('branch_id', None)
        self.response_branch = kwargs.get('response_branch', None)
        self.index = kwargs.get('index', None)
        self.stream = kwargs.get('stream', False)
        self.tb = kwargs.get('tb', None)
        self.tab_db = kwargs.get('database', None)
        self.db = Database(workspace="global", tab_id="global")
        self.pricing = kwargs.get('pricing', None)
        self.model_name = kwargs.get('model_name', None)
        self.model_id = kwargs.get('model_id', None)
        self.set_continue = kwargs.get('set_continue', None)
        self.cancel_event = kwargs.get('cancel_event', asyncio.Event())
        workspace_ctx.set(self.workspace)
        tab_id_ctx.set(self.tab_id)

    async def get_history(self) -> List[Dict[str, str]]:
        """
        Get history
        """
        return []
    
    async def setup(self) -> None:
        """
        Async initialization hook called after __init__.
        Override this to perform async setup like reading from the database.
        """
        pass

    async def process_chunk(self, chunk, **kwargs) -> Any:
        pass
    
    async def finalize(self, **kwargs) -> Any:
        pass
    
    async def response(self, res, **kwargs) -> Any:
        pass
    
    async def start(self, **kwargs) -> None:
        pass
    
    async def end(self, **kwargs) -> None:
        pass
    
    async def stop(self, **kwargs) -> None:
        pass
