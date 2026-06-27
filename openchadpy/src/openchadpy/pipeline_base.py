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
    from .code_sandbox import CodeSandbox
    from .model_manager import ModelManager
    from .tool_manager import ToolManager
    from .settings import Settings
    from .event_emitter import EventEmitter
    from .mcp_manager import MCPManager
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Code extraction helper (used by llm_tool in programmatic mode)
# ---------------------------------------------------------------------------
_RE_BACKTICK_FENCE_PB = re.compile(
    r"```(?:[a-zA-Z0-9_+\-]*)?\r?\n(.*?)```",
    re.DOTALL,
)
_RE_THINK_PB  = re.compile(r"<think>.*?</think>|<thinking>.*?</thinking>", re.DOTALL | re.IGNORECASE)
_RE_TOOL_PB   = re.compile(r"<ToolCall\b[^>]*/>", re.DOTALL)
_RE_CBLOCK_PB = re.compile(r"<CodeBlock\b[^>]*>.*?</CodeBlock>", re.DOTALL)

def _extract_code(text: str) -> str:
    """Strip MDX render tags then return the first fenced code block, or the
    whole cleaned text when no fence is present.

    NOTE: end() runs before finalize(), so the parser's pending buffer may
    still hold the closing ``` when this is called.  We handle both the
    complete-fence case (regex match) and the incomplete-fence case (opening
    fence only) so a missing closing ``` never breaks compilation.
    """
    import textwrap
    text = _RE_THINK_PB.sub("", text)
    text = _RE_TOOL_PB.sub("", text)
    text = _RE_CBLOCK_PB.sub(
        lambda m: re.sub(r"<CodeBlock\b[^>]*>", "", m.group(0)).replace("</CodeBlock>", ""),
        text,
    )
    text = text.strip("\r\n")
    matches = _RE_BACKTICK_FENCE_PB.findall(text)
    if matches:
        raw_code = matches[0]
    else:
        # Fallback: closing ``` may still be in the parser's pending buffer.
        # Strip just the opening fence and treat everything after as the body.
        open_match = re.match(r"```(?:[a-zA-Z0-9_+\-]*)?\r?\n(.*)", text, re.DOTALL)
        if open_match:
            raw_code = open_match.group(1)
            # Remove any trailing incomplete ``` that made it in
            raw_code = re.sub(r"\n?```\s*$", "", raw_code, flags=re.DOTALL)
        else:
            raw_code = text
    return textwrap.dedent(raw_code.strip("\r\n")).strip()

def _parse_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() == "true"
    return False



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
    code_sandbox: Optional["CodeSandbox"]
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
                is_programmatic = _parse_bool(agent_node.get("enableProgrammaticToolCalling"))
                allow_multiple = _parse_bool(agent_node.get("allowMultiple"))
                if children:  
                    if allow_multiple:
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
                                    desc = stripped.lstrip("#").lstrip("-").lstrip("*").strip()
                                    return skill_filename, desc
                            return skill_filename, "No description available"
                    except Exception:
                        return skill_filename, "No description available"

                if is_programmatic:
                    # --- Programmatic prompt (same structure as Chat.__init__) ---
                    def format_node_code(a_id: str, a_node: dict, indent: str = "") -> str:
                        skill_path = a_node.get("skillPath", "")
                        fname, skill_desc = get_skill_info(skill_path) if skill_path else ("", "No description available")
                        node_children = a_node.get("children", {})
                        node_tools = list(a_node.get("tools", []))
                        if node_children and "agent_query" not in node_tools:
                            node_tools.append("agent_query")
                        tools_str = ", ".join(f'"{t}"' for t in sorted(node_tools))
                        module_name = a_id.replace("-", "_")
                        node_lines = [
                            f"{indent}Node(",
                            f'{indent}    name="{a_id}",',
                            f"{indent}    skill=Skill(",
                            f'{indent}        path="{skill_path}",',
                            f'{indent}        description="{skill_desc}",',
                            f"{indent}    ),",
                            f"{indent}    available_tools=[{tools_str}],",
                            f'{indent}    module_path="{a_id}/main.py",',
                            f'{indent}    module_name="{module_name}",',
                        ]
                        if node_children:
                            node_lines.append(f"{indent}    children=[")
                            for child_id, child_node in node_children.items():
                                child_code = format_node_code(child_id, child_node, indent + "        ")
                                node_lines.append(child_code + ",")
                            node_lines.append(f"{indent}    ],")
                        node_lines.append(f"{indent})")
                        return "\n".join(node_lines)

                    import platform
                    from datetime import datetime as _datetime
                    os_info = f"{platform.system()} {platform.release()}"
                    now_str = _datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    tree_code = "tree = " + format_node_code(current_agent_id, agent_node, "")

                    # Ensure agent_query is in allowed_tools if children exist
                    allowed_tools = set(agent_node.get("tools", []))
                    if children:
                        allowed_tools.add("agent_query")

                    # Filter tools list to match allowed set
                    tools = [
                        t for t in tools
                        if t.get("function", {}).get("name") in allowed_tools
                    ]

                    tool_defs = []
                    for t_name in sorted(allowed_tools):
                        t_desc = "No description available"
                        for t in all_tools:
                            if isinstance(t, dict) and t.get("function", {}).get("name") == t_name:
                                t_desc = t.get("function", {}).get("description") or "No description available"
                                break
                        t_desc = t_desc.strip()
                        tool_def = (
                            f"async def {t_name}(query: str) -> str:\n"
                            f"    \"\"\"\n"
                            f"    {t_desc}\n"
                            f"    \"\"\"\n"
                            f"    ..."
                        )
                        tool_defs.append(tool_def)
                    tools_code = "\n\n".join(tool_defs)
                    tools_list_str = ", ".join(sorted(allowed_tools))

                    _env_header = (
                        "## Environment\n"
                        f"- OS Information: `{os_info}`\n"
                        f"- Date & Time: `{now_str}`\n"
                        f"- Current node: `{current_agent_id}`\n"
                    )
                    _main_py_block = (
                        "# ./main.py\n\n"
                        "```python\n"
                        "import sys\n"
                        "import importlib.util\n"
                        "from collections import deque\n"
                        "from dataclasses import dataclass, field\n"
                        "from typing import Any, Awaitable, Callable, Dict, List, Optional\n"
                        "\n\n"
                        "class ToolRegistry:\n"
                        "    call: Callable[..., Awaitable[Dict[str, Any]]]\n"
                        "    schema: Dict[str, Any]\n"
                        "\n"
                        "    def __init__(\n"
                        "        self,\n"
                        "        call: Callable[..., Awaitable[Dict[str, Any]]],\n"
                        "        schema: Dict[str, Any],\n"
                        "    ):\n"
                        "        self.call = call\n"
                        "        self.schema = schema\n"
                        "\n"
                        "    async def execute(self, **kwargs) -> Dict[str, Any]:\n"
                        "        return await self.call(**kwargs)\n"
                        "\n\n"
                        "def load(path: str, name: str) -> Any:\n"
                        '    """Dynamically loads a Python module from `path`, registers it in sys.modules under `name`, and returns the loaded module object."""\n'
                        "    ...\n"
                        "\n"
                        "@dataclass\n"
                        "class ActionResult:\n"
                        "    result: Dict[str, Any]\n"
                        + (
                            "    next_branches: Dict[str, List[str]] = field(default_factory=dict)\n"
                            if allow_multiple else
                            "    next_tasks: List[str] = field(default_factory=list)\n"
                            "    next_branch: Optional[str] = None\n"
                        )
                        + "\n\n"
                        "@dataclass\n"
                        "class Skill:\n"
                        "    path: str\n"
                        "    description: str\n"
                        "\n\n"
                        "@dataclass\n"
                        "class Node:\n"
                        "    name: str\n"
                        "    skill: Skill\n"
                        "    available_tools: List[str]\n"
                        "    module_path: str\n"
                        "    module_name: str\n"
                        '    children: List["Node"] = field(default_factory=list)\n'
                        "    _module: Any = field(default=None, init=False, repr=False)\n"
                        "\n"
                        "    @property\n"
                        "    def module(self) -> Any:\n"
                        '        """Lazily load the node\'s module on first access."""\n'
                        "        if self._module is None:\n"
                        "            self._module = load(self.module_path, self.module_name)\n"
                        "        return self._module\n"
                        "\n"
                        '    async def execute(self, task: str = "") -> "ActionResult":\n'
                        "        return await self.module.execute(task)\n"
                        "\n\n"
                        'def get_node(name: str) -> "Node":\n'
                        '    """BFS search for a node by name starting from the root tree."""\n'
                        "    ...\n"
                        "\n\n"
                        'def get_children_node(node: Node, name: str) -> "Node":\n'
                        '    """Search for a children node by name, only search in node->children, non-recursive."""\n'
                        "    ...\n"
                        "\n"                        
                        + tree_code + "\n"
                        "```\n"
                    )
                    _agent_section = (
                        f"You are the `{current_agent_id}` agent. Implement the body of `execute(task: str)` inside `{current_agent_id}/main.py`.\n"
                        "Return **only** the code inside the function body — no signature line, no imports, no explanation, and wrapped it inside a ```python ... ``` block.\n"
                        "\n"
                        "Example of a CORRECT response (your response should look EXACTLY like this - start directly with indented code, with NO markdown backticks/fences, NO import statements, and NO 'def execute' line):\n"
                        "```python\n"
                        "try:\n"
                        "    # your logic"
                        "    return ActionResult(result=res)\n"
                        "except Exception as e:\n"
                        "    return ActionResult(result={task: {\"error\": str(e)}})\n"
                        "```\n"
                        "\n"
                        "The following are already available at call time:\n"
                        "\n"
                        "```python\n"
                        "from main import ToolRegistry, ActionResult, get_node, get_children_node\n"
                        "from typing import Any, Dict, List, Optional\n"
                        "\n"
                        'initial_task = """\n'
                        "{{current_task}}\n"
                        '"""\n'
                        "\n"
                        "async def llm_tool(\n"
                        "    query: str,\n"
                        "    tool_registry: Optional[Dict[str, ToolRegistry]] = None,\n"
                        ") -> Dict[str, Any]:\n"
                        '    """\n'
                        "    Sends `query` to the language model, optionally supplying callable tools from\n"
                        "    `tool_registry`, and returns a dict containing the model's response text and\n"
                        "    any tool-use results.\n"
                        '    """\n'
                        "    ...\n"
                        "\n"
                        "# Tools\n"
                        + tools_code + "\n"
                        "\n"
                        "async def main() -> List[Dict[str, Any]]:\n"
                        '    """\n'
                        + f"    Entry-point coroutine: runs the {current_agent_id} node on `initial_task`, fans out\n"
                        "    to any follow-up branch tasks declared in the returned ActionResult, and returns\n"
                        "    the collected list of all result payloads.\n"
                        '    """\n'
                        "    results: List[Dict[str, Any]] = []\n"
                        + f'    node = get_node("{current_agent_id}")\n'
                        "    data: ActionResult = await node.execute(initial_task)\n"
                        "    results.append(data.result)\n"
                        "    # (parent_node, branch_id, task)\n"
                        "    queue: deque[tuple] = deque()\n"
                        + (
                            "    if data.next_branches:\n"
                            "        for branch_id, tasks in data.next_branches.items():\n"
                            "            for task in tasks:\n"
                            "                queue.append((node, branch_id, task))\n"
                            "    while queue:\n"
                            "        parent_node, branch_id, task = queue.popleft()\n"
                            "        branch_node = get_children_node(parent_node, branch_id)\n"
                            "        branch_data: ActionResult = await branch_node.execute(task)\n"
                            "        results.append(branch_data.result)\n"
                            "        if branch_data.next_branches:\n"
                            "            for br_id, ts in branch_data.next_branches.items():\n"
                            "                for t in ts:\n"
                            "                    queue.append((branch_node, br_id, t))\n"
                            "    return results\n"
                            if allow_multiple else
                            "    if data.next_branch and len(data.next_tasks) > 0:\n"
                            "        for task in data.next_tasks:\n"
                            "            queue.append((node, data.next_branch, task))\n"
                            "    while queue:\n"
                            "        parent_node, branch_id, task = queue.popleft()\n"
                            "        branch_node = get_children_node(parent_node, branch_id)\n"
                            "        branch_data: ActionResult = await branch_node.execute(task)\n"
                            "        results.append(branch_data.result)\n"
                            "        if branch_data.next_branch and len(branch_data.next_tasks) > 0:\n"
                            "            for t in branch_data.next_tasks:\n"
                            "                queue.append((branch_node, branch_data.next_branch, t))\n"
                            "    return results\n"
                        )
                        + "```\n"
                    )
                    _llm_tool_docs = (
                        "## Using `llm_tool`\n"
                        "\n"
                        "`llm_tool` is a **structured-output-only** LLM call. Under the hood, the model is instructed to call a tool on every response — it never returns plain text. You supply one or more `ToolRegistry` objects; the model picks the right one, fills in the parameters, and your `call` function receives those arguments as `**kwargs`.\n"
                        "\n"
                        "Use `llm_tool` whenever you need to transform, condense, or structure raw data.\n"
                        "\n---\n\n"
                        "### Signature\n"
                        "\n"
                        "```python\n"
                        "res: Dict[str, Any] = await llm_tool(\n"
                        '    query="<prompt describing what the model should do>",\n'
                        '    tool_registry={"tool_name": ToolRegistry(...)}\n'
                        ")\n"
                        "```\n"
                        "\n"
                        "| Parameter | Type | Description |\n"
                        "|---|---|---|\n"
                        "| `query` | `str` | The full prompt: include context, instructions, and any content to process. |\n"
                        "| `tool_registry` | `Dict[str, ToolRegistry]` | Maps tool name -> `ToolRegistry`. The **key must exactly match** `function.name` in the schema. |\n"
                        '| **Returns** | `Dict[str, Any]` | The `dict` returned by your `call` function (single tool call). Returns `{}` on any error. |\n'
                        "\n"
                        "> **`llm_tool` returns `{}` on every error** — no model, no tool calls produced, JSON parse failure, etc.\n"
                        "> Always check `if not res:` before reading fields.\n"
                        "\n---\n\n"
                        "### Defining a `ToolRegistry`\n"
                        "\n"
                        "```python\n"
                        '""""\n'
                        "async def my_call(**kwargs) -> Dict[str, Any]:\n"
                        '    value = kwargs.get("input_field", "") # Extract the input parameter sent by the LLM \n'
                        "    # -- Process the value here (OPTIONAL) --\n"
                        "    # Skip this entire block if the tool only needs to echo the LLM's input\n"
                        "    # straight to the output (e.g. the tool's purpose is just to capture or\n"
                        "    # store what the LLM provided, with no transformation needed).\n"
                        "    #\n"
                        "    # Only add processing if you need to:\n"
                        "    #   - Transform the value (string manipulation, validation, computation)\n"
                        "    #   - Run a sub-task via another `llm_tool` (e.g. classification, rewriting)\n"
                        f"    #   - Fetch external data with `await` ({tools_list_str})\n"
                        "    # --\n"
                        '    return {"output_field": processed_value or value }  # return this dict is what llm_tool returns to you\n'
                        '""""\n'
                        "\n"
                        "my_tool = ToolRegistry(\n"
                        "    call=my_call,\n"
                        "    schema={\n"
                        '        "type": "function",\n'
                        '        "function": {\n'
                        '            "name": "my_tool",          # Must match the key in tool_registry dict\n'
                        '            "description": "...",       # Be precise — the model reads this to decide when/how to call\n'
                        '            "parameters": {\n'
                        '                "type": "object",\n'
                        '                "properties": {\n'
                        '                    "output_field": {\n'
                        '                        "type": "string",\n'
                        '                        "description": "Description the model uses to fill this field"\n'
                        "                    }\n"
                        "                },\n"
                        '                "required": ["output_field"]\n'
                        "            }\n"
                        "        }\n"
                        "    }\n"
                        ")\n"
                        "```\n"
                        "\n"
                        "**Rules:**\n"
                        "- The `call` function's return value is what `llm_tool` passes back to you — return only what you need.\n"
                        "- The `description` at both the function level and parameter level directly influences model quality; be explicit.\n"
                        "- Fields listed in `required` are always filled by the model; optional fields may be absent from `kwargs`.\n"
                        "\n---\n\n"
                        "### Error Handling\n"
                        "\n"
                        "`llm_tool` returns `{}` on every internal failure: missing model, no tool calls produced, JSON parse error.\n"
                        "Always guard before reading any field:\n"
                        "\n"
                        "```python\n"
                        'res = await llm_tool(query, tool_registry={"my_tool": my_tool})\n'
                        "\n"
                        "if not res:\n"
                        '    raise RuntimeError("llm_tool returned empty — check model config and tool schema")\n'
                        "\n"
                        'value = res.get("field", default_value)\n'
                        "```\n"
                        "\n"
                        "Inside `execute`, this is already covered by the top-level `try/except` (see Behavior Requirements below), but defensive `.get()` calls with defaults prevent silent data loss.\n"
                        "\n---\n\n"
                        "## Behavior Requirements\n"
                        "\n"
                        f"- Use the available tools ({tools_list_str}) to research `task` and gather raw findings.\n"
                        "- Use `llm_tool` to summarize, analyze, classify, or structure tool output before building `result`.\n"
                        "- Build `result` as `{ task: findings }` where `findings` is a structured dict of your processed output.\n"
                        + (
                            "- Initialize `next_branches: Dict[str, List[str]] = {}`; only populate it if research explicitly surfaces follow-up tasks for child branches — map each child branch ID to its list of tasks.\n"
                            '- Wrap the **entire** body in `try/except`: on any exception, return `ActionResult(result={task: {"error": str(e)}}, next_branches={})` — `execute()` must never raise.\n'
                            "- Return `ActionResult(result=result, next_branches=next_branches)`.\n"
                            if allow_multiple else
                            "- Initialize `next_tasks: List[str] = []` and `next_branch: Optional[str] = None`; only populate them if research explicitly surfaces follow-up tasks for a child branch.\n"
                            '- Wrap the **entire** body in `try/except`: on any exception, return `ActionResult(result={task: {"error": str(e)}}, next_tasks=[], next_branch=None)` — `execute()` must never raise.\n'
                            "- Return `ActionResult(result=result, next_tasks=next_tasks, next_branch=next_branch)`.\n"
                        )
                    )
                    context = (
                        _env_header + "\n---\n\n"
                        + _main_py_block + "\n---\n\n"
                        + _agent_section + "\n---\n\n"
                        + _llm_tool_docs + "\n---\n\n"
                        + get_skill_content(agent_node.get("skillPath", ""))
                    )
                else:
                    # --- Legacy format_agent prompt (non-programmatic mode) ---
                    def format_agent(a_id: str, a_node: dict, depth: int) -> str:
                        lines = []
                        if depth == 0:
                            lines.append(f"# Agent `{a_id}`")
                        elif depth == 1:
                            lines.append(f"### `{a_id}`")
                        else:
                            lines.append(f"##### `{a_id}`")
                        lines.append("")

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
                            if a_children:
                                if depth == 0:
                                    lines.append("- `agent_query` — Delegate a task to a sub-agent.")
                                else:
                                    lines.append("- `agent_query` — Delegate a task to a sub-agent (see below).")
                            lines.append("")

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

                    # Ensure agent_query is allowed if children exist
                    allowed_tools = set(agent_node.get("tools", []))
                    if children:
                        allowed_tools.add("agent_query")

                    # Filter tools list to match allowed set
                    tools = [
                        t for t in tools
                        if t.get("function", {}).get("name") in allowed_tools
                    ]

                    raw_prompt = format_agent(current_agent_id, agent_node, 0)
                    context = re.sub(r'\n{3,}', '\n\n', raw_prompt).strip()
                    import platform
                    from datetime import datetime as _datetime
                    os_info = f"{platform.system()} {platform.release()}"
                    now_str = _datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    context += (
                        f"\n\n## Environment\n"
                        f"- OS Information: {os_info}\n"
                        f"- Current Date & Time: {now_str}"
                    )

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
                            final_content = message.get("content") or ""

                            # ── Programmatic mode: model returns code as text ──
                            _agent_prog = agent_ctx.get()
                            is_prog_mode = (
                                _agent_prog
                                and isinstance(_agent_prog, dict)
                                and _parse_bool(
                                    next(iter(_agent_prog.values()), {}).get(
                                        "enableProgrammaticToolCalling"
                                    )
                                )
                            )
                            if is_prog_mode and final_content.strip():
                                code = _extract_code(final_content)
                                if code.strip():
                                    logger.info(
                                        "[llm_tool] programmatic mode – executing code (%d chars)",
                                        len(code),
                                    )
                                    try:
                                        exec_result = await self.run_code(code, query)
                                    except Exception as _e:
                                        exec_result = {
                                            "output": "",
                                            "error": str(_e),
                                            "result": None,
                                            "success": False,
                                        }
                                    await _save_history(query, final_content)
                                    return exec_result

                            if multi_step:
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

    async def run_code(self, code: str, task: str) -> Dict[str, Any]:
        try:
            if self.code_sandbox and self.workspace and self.tab_id:
                return await self.code_sandbox.execute(code, task, workspace=self.workspace, tab_id=self.tab_id)
            else:
                return {"error": "Setup code_sandbox failed"}
        except Exception as e:
            logger.error(f"Failed to run code: {e}")
            return {"error": str(e)}    
    
    def __init__(self, **kwargs):
        self.attempt = 0
        # Initialize all attributes
        self.code_sandbox = kwargs.get('code_sandbox', None)
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
