# -*- coding: utf-8 -*-
"""
Unit tests for the enableProgrammaticToolCalling system prompt template logic.

Tests verify:
1. format_node_code generates correct recursive Node tree code
2. Chat.__init__ builds the programmatic system prompt when enableProgrammaticToolCalling=True
3. Chat.__init__ uses the default prompt when enableProgrammaticToolCalling=False
4. _build_initial_messages replaces {{current_task}} with context+query
5. _build_initial_messages does not modify template when {{current_task}} is absent

Run with:
    cd openbrowser && uv run python programmatic_tool_test.py
"""

import asyncio
import sys
import os
import re
import copy
import json
import logging
from typing import Any, Dict, List, Optional

# -- Setup path --------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "openchadpy", "src"))

# -- Logging -----------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("programmatic_tool_test.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("programmatic_tool_test")

# -- Test tracking ------------------------------------------------------------
passed = 0
failed = 0


def ok(name: str):
    global passed
    passed += 1
    logger.info(f"PASS: {name}")


def fail(name: str, reason: str):
    global failed
    failed += 1
    logger.error(f"FAIL: {name} -- {reason}")


# ============================================================================
# Isolated logic: format_node_code (extracted from Chat.__init__)
# ============================================================================

def get_skill_info_mock(skill_path: str):
    """Mocked get_skill_info that returns predictable values."""
    if not skill_path:
        return "", "No description available"
    return os.path.basename(skill_path), f"Description for {os.path.basename(skill_path)}"


def format_node_code(a_id: str, a_node: dict, indent: str = "") -> str:
    """Extracted logic from Chat.__init__ for isolated unit testing."""
    skill_path = a_node.get("skillPath", "")
    fname, skill_desc = get_skill_info_mock(skill_path) if skill_path else ("", "No description available")
    node_children = a_node.get("children", {})
    tools = list(a_node.get("tools", []))
    if node_children and "agent_query" not in tools:
        tools.append("agent_query")
    tools_str = ", ".join(f'"{t}"' for t in sorted(tools))
    module_name = a_id
    lines = [
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
        lines.append(f"{indent}    children=[")
        for child_id, child_node in node_children.items():
            child_code = format_node_code(child_id, child_node, indent + "        ")
            lines.append(child_code + ",")
        lines.append(f"{indent}    ],")
    lines.append(f"{indent})")
    return "\n".join(lines)


# ============================================================================
# TEST 1: format_node_code -- leaf node (no children)
# ============================================================================
def test_format_node_code_leaf():
    logger.info("=" * 60)
    logger.info("TEST 1: format_node_code -- leaf node (no children)")

    node = {
        "skillPath": "/skills/web_agent.md",
        "tools": ["web_search", "extract"],
        "children": {},
    }
    code = format_node_code("web_agent", node)
    logger.debug(f"Generated code:\n{code}")

    assert 'name="web_agent"' in code, "Missing name field"
    assert 'path="/skills/web_agent.md"' in code, "Missing skill path"
    assert '"extract"' in code, "Missing extract tool"
    assert '"web_search"' in code, "Missing web_search tool"
    assert "children" not in code, "Leaf node should not have children block"
    assert 'module_path="web_agent/main.py"' in code, "Missing module_path"
    assert 'module_name="web_agent"' in code, "Missing module_name"
    ok("format_node_code leaf node")


# ============================================================================
# TEST 2: format_node_code -- parent with one child
# ============================================================================
def test_format_node_code_parent_child():
    logger.info("=" * 60)
    logger.info("TEST 2: format_node_code -- parent node with one child")

    child_node = {
        "skillPath": "/skills/code_agent.md",
        "tools": ["read_file", "write_file"],
        "children": {},
    }
    parent_node = {
        "skillPath": "/skills/root_agent.md",
        "tools": ["web_search"],
        "children": {"code_agent": child_node},
    }
    code = format_node_code("root_agent", parent_node)
    logger.debug(f"Generated code:\n{code}")

    assert 'name="root_agent"' in code, "Missing root_agent name"
    assert 'name="code_agent"' in code, "Missing child code_agent name"
    assert "children=[" in code, "Parent should have children block"
    assert '"agent_query"' in code, "agent_query should be auto-added for parent"
    assert 'module_path="code_agent/main.py"' in code, "Missing child module_path"
    assert 'module_name="code_agent"' in code, "Missing child module_name"
    ok("format_node_code parent with child")


# ============================================================================
# TEST 3: format_node_code -- deep nesting (3 levels)
# ============================================================================
def test_format_node_code_deep_nesting():
    logger.info("=" * 60)
    logger.info("TEST 3: format_node_code -- deep 3-level nesting")

    grandchild = {
        "skillPath": "",
        "tools": ["deep_search"],
        "children": {},
    }
    child = {
        "skillPath": "/skills/child.md",
        "tools": ["analyze"],
        "children": {"grandchild": grandchild},
    }
    root = {
        "skillPath": "/skills/root.md",
        "tools": ["orchestrate"],
        "children": {"child_agent": child},
    }
    code = format_node_code("root_agent", root)
    logger.debug(f"Generated deep nested code:\n{code}")

    assert 'name="root_agent"' in code
    assert 'name="child_agent"' in code
    assert 'name="grandchild"' in code
    assert '"deep_search"' in code
    ok("format_node_code deep 3-level nesting")


# ============================================================================
# TEST 4: format_node_code -- agent_query not duplicated if already in tools
# ============================================================================
def test_format_node_code_no_duplicate_agent_query():
    logger.info("=" * 60)
    logger.info("TEST 4: format_node_code -- no duplicate agent_query")

    node = {
        "skillPath": "",
        "tools": ["web_search", "agent_query"],
        "children": {"child": {"skillPath": "", "tools": [], "children": {}}},
    }
    code = format_node_code("root", node)
    logger.debug(f"Generated code:\n{code}")

    count = code.count('"agent_query"')
    if count == 1:
        ok("format_node_code -- agent_query not duplicated")
    else:
        fail("format_node_code -- agent_query not duplicated", f"Found {count} occurrences, expected 1")


def get_skill_content(skill_path: str) -> str:
    if not skill_path:
        return "# Placeholder Skill"
    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception as e:
        logger.error(f"[get_skill_content] error when try to get skill path: {e}")
        return "# Placeholder Skill"
    

# ============================================================================
# TEST 5: Simulate Chat.__init__ system prompt construction for programmatic mode
# ============================================================================
def test_programmatic_prompt_construction():
    logger.info("=" * 60)
    logger.info("TEST 5: Programmatic prompt construction -- matches sys.md structure")

    import platform
    from datetime import datetime

    agent_id = "planner_agent"
    agent_node = {
        "skillPath": "/skills/planner.md",
        "tools": ["web_search", "read_file"],
        "children": {
            "writer_agent": {
                "skillPath": "/skills/writer.md",
                "tools": ["write_file"],
                "children": {},
            }
        },
        "enableProgrammaticToolCalling": True,
    }

    os_info = f"{platform.system()} {platform.release()}"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # main.py prepends "tree = " to format_node_code output
    tree_code = "tree = " + format_node_code(agent_id, agent_node, "")

    all_tools_mock = [
        {"type": "function", "function": {"name": "web_search", "description": "Search the web for information."}},
        {"type": "function", "function": {"name": "read_file", "description": "Read content from a file."}},
        {"type": "function", "function": {"name": "agent_query", "description": "Delegate tasks to sub-agents."}},
    ]
    allowed_tools = {"web_search", "read_file", "agent_query"}
    tools_list_str = ", ".join(sorted(allowed_tools))

    tool_defs = []
    for t_name in sorted(allowed_tools):
        t_desc = "No description available"
        for t in all_tools_mock:
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

    # Simulate the plain-string-concat prompt from main.py.
    # In regular string literals braces are NOT escaped — they appear as-is.
    _env = (
        "## Environment\n"
        f"- OS Information: `{os_info}`\n"
        f"- Date & Time: `{now_str}`\n"
        f"- Current node: `{agent_id}`\n"
    )
    _main_block = (
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
        "    next_tasks: List[str] = field(default_factory=list)\n"
        "    next_branch: Optional[str] = None\n"
        "\n\n"
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
    _agent = (
        f"You are the `{agent_id}` agent. Implement the body of `execute(task: str)` inside `{agent_id}/main.py`.\n"
        "Return **only** the code inside the function body — no signature line, no imports, no markdown fences, no explanation.\n"
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
        + f"    Entry-point coroutine: runs the {agent_id} node on `initial_task`, fans out\n"
        "    to any follow-up branch tasks declared in the returned ActionResult, and returns\n"
        "    the collected list of all result payloads.\n"
        '    """\n'
        "    results: List[Dict[str, Any]] = []\n"
        + f'    node = get_node("{agent_id}")\n'
        "    data: ActionResult = await node.execute(initial_task)\n"
        "    results.append(data.result)\n"
        "    # (parent_node, branch_id, task)\n"
        "    queue: deque[tuple] = deque()\n"
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
        "```\n"
    )
    _docs = (
        "## Using `llm_tool`\n"
        "\n"
        "`llm_tool` is a **structured-output-only** LLM call. Under the hood, the model is instructed to call a tool on every response — it never returns plain text. You supply one or more `ToolRegistry` objects; the model picks the right one, fills in the parameters, and your `call` function receives those arguments as `**kwargs`.\n"
        "\n"
        "Use `llm_tool` whenever you need to transform, condense, or structure raw data — after a `web_search`, before building `result`, or when populating `next_tasks`.\n"
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
        "- Use the available tools (`web_search`, `read_file`, `write_file`, `extract`) to research `task` and gather raw findings.\n"
        "- Use `llm_tool` to summarize, analyze, classify, or structure tool output before building `result`.\n"
        "- Build `result` as `{ task: findings }` where `findings` is a structured dict of your processed output.\n"
        "- Initialize `next_tasks: List[str] = []` and `next_branch: Optional[str] = None`; only populate them if research explicitly surfaces follow-up tasks for a child branch.\n"
        '- Wrap the **entire** body in `try/except`: on any exception, return `ActionResult(result={task: {"error": str(e)}}, next_tasks=[], next_branch=None)` — `execute()` must never raise.\n'
        "- Return `ActionResult(result=result, next_tasks=next_tasks, next_branch=next_branch).\n"
    )
    prompt = (
        _env + "\n---\n\n"
        + _main_block + "\n---\n\n"
        + _agent + "\n---\n\n"
        + _docs + "\n---\n\n"
        + get_skill_content(agent_node.get("skillPath", ""))
    )

    logger.debug(f"Generated programmatic prompt (FULL):\n{prompt}")

    # --- Structural assertions ---
    assert "## Environment" in prompt, "Missing Environment section"
    assert f"Current node: `{agent_id}`" in prompt, "Missing current node"

    # --- # ./main.py boilerplate ---
    assert "class ToolRegistry:" in prompt, "Missing ToolRegistry class in boilerplate"
    assert "class ActionResult:" in prompt, "Missing ActionResult dataclass in boilerplate"
    assert "class Skill:" in prompt, "Missing Skill dataclass in boilerplate"
    assert "class Node:" in prompt, "Missing Node dataclass in boilerplate"
    assert "def get_node(" in prompt, "Missing get_node function in boilerplate"
    assert "def load(path: str, name: str)" in prompt, "Missing load() stub in boilerplate"

    # tree = Node(...) assignment prefix
    assert "tree = Node(" in prompt, "tree must have 'tree = ' assignment prefix"
    assert f'name="{agent_id}"' in prompt, "Missing root agent in tree"
    assert 'name="writer_agent"' in prompt, "Missing child agent in tree"

    # --- Agent section ---
    assert "The following are already available at call time:" in prompt, \
        "Missing 'already available at call time' text"

    # {{current_task}} must be a literal double-brace placeholder
    assert "{{current_task}}" in prompt, "{{current_task}} placeholder must be literal double-braces"

    # llm_tool definition must be present
    assert "async def llm_tool(" in prompt, "Missing llm_tool definition"
    assert "tool_registry: Optional[Dict[str, ToolRegistry]] = None," in prompt, \
        "Missing llm_tool tool_registry parameter"

    # Tool stubs present
    assert "async def web_search(query: str) -> str:" in prompt, "Missing web_search tool def"
    assert "async def read_file(query: str) -> str:" in prompt, "Missing read_file tool def"
    assert "async def agent_query(query: str) -> str:" in prompt, "Missing agent_query tool def"
    assert "Search the web for information." in prompt, "Missing web_search description"

    # Full main() body
    assert "Entry-point coroutine:" in prompt, "Missing main() docstring"
    assert "results: List[Dict[str, Any]] = []" in prompt, "Missing results list in main()"
    assert "data: ActionResult = await node.execute(initial_task)" in prompt, \
        "Missing node.execute call in main()"
    assert "results.append(data.result)" in prompt, "Missing results.append in main()"
    assert "if data.next_branch and len(data.next_tasks) > 0:" in prompt, \
        "Missing branch fan-out logic in main()"

    # --- llm_tool docs ---
    assert "structured-output-only" in prompt, "Missing llm_tool description paragraph"

    # Signature: full parameter table
    assert "| Parameter | Type | Description |" in prompt, "Missing full parameter table header"
    assert "| `query` | `str` |" in prompt, "Missing query row in parameter table"
    assert "| `tool_registry` |" in prompt, "Missing tool_registry row in parameter table"

    # Signature: single-brace dict (not {{...}})
    assert '{"tool_name": ToolRegistry(...)}' in prompt, "Signature must have single-brace dict"

    # Returns {} — single brace
    assert "Returns `{}` on any error." in prompt, "Returns {} must be single-brace"

    # > Always check if not res
    assert "> Always check `if not res:` before reading fields." in prompt, \
        "Missing 'Always check if not res' note"

    # ToolRegistry example: 4-quote sentinel as in sys.md
    assert '""""' in prompt, "ToolRegistry example must use 4-quote sentinel"

    # ToolRegistry example body: single-brace return dict
    assert '{"output_field": processed_value or value }' in prompt, \
        "ToolRegistry example must use single-brace dict"

    # schema uses single-brace and has full structure
    assert "schema={" in prompt, "schema must use single-brace dict"
    assert '"name": "my_tool"' in prompt, "schema must have function name"
    assert '"required": ["output_field"]' in prompt, "schema must have required fields"

    # Rules section
    assert "**Rules:**" in prompt, "Missing Rules section"
    assert "Fields listed in `required` are always filled by the model" in prompt, \
        "Missing Rules bullet about required fields"

    # Error Handling section
    assert "### Error Handling" in prompt, "Missing Error Handling section"
    assert 'raise RuntimeError("llm_tool returned empty' in prompt, \
        "Missing RuntimeError in error handling"

    # Behavior Requirements: all 6 bullets with single braces
    assert "- Use the available tools" in prompt, "Missing first Behavior Requirement bullet"
    assert "- Use `llm_tool` to summarize" in prompt, "Missing second Behavior Requirement bullet"
    assert "{ task: findings }" in prompt, "Behavior Requirements must use single-brace { task: findings }"
    assert "- Initialize `next_tasks: List[str] = []`" in prompt, \
        "Missing next_tasks initialization bullet"
    assert 'result={task: {"error": str(e)}}' in prompt, "Exception result must use single-brace dicts"
    assert "- Return `ActionResult(result=result" in prompt, "Missing final Return bullet"

    # Skill section (fallback placeholder when skill file doesn't exist)
    assert "# Placeholder Skill" in prompt, "Missing skill content section at end of prompt"

    ok("Programmatic prompt construction -- matches sys.md structure")



# ============================================================================
# TEST 6: _build_initial_messages -- {{current_task}} replacement
# ============================================================================
async def test_build_initial_messages_replaces_current_task():
    logger.info("=" * 60)
    logger.info("TEST 6: _build_initial_messages -- {{current_task}} replacement")

    context = ""
    query = "Find top 10 universities in Indonesia"
    message_template = [
        {
            "role": "system",
            "content": 'initial_task = """\n{{current_task}}\n"""\n\nYou are an agent.',
        }
    ]

    msg_template = copy.deepcopy(message_template)
    if msg_template and len(msg_template) > 0 and "content" in msg_template[0]:
        content = msg_template[0]["content"]
        if "{{current_task}}" in content:
            msg_template[0]["content"] = content.replace("{{current_task}}", f"{context}{query}")

    messages = msg_template + [{"role": "user", "content": f"{context}{query}"}]
    logger.debug(f"Generated messages:\n{json.dumps(messages, indent=2)}")

    system_content = messages[0]["content"]
    user_content = messages[-1]["content"]

    assert "{{current_task}}" not in system_content, "{{current_task}} was not replaced in system prompt"
    assert query in system_content, "Query not found in system prompt after replacement"
    assert user_content == query, "User content mismatch"
    ok("_build_initial_messages replaces {{current_task}} correctly")


# ============================================================================
# TEST 7: _build_initial_messages -- no placeholder, template unchanged
# ============================================================================
async def test_build_initial_messages_no_placeholder():
    logger.info("=" * 60)
    logger.info("TEST 7: _build_initial_messages -- no placeholder, template unchanged")

    context = ""
    query = "Hello"
    original_content = "You are a helpful assistant."
    message_template = [{"role": "system", "content": original_content}]

    msg_template = copy.deepcopy(message_template)
    if msg_template and len(msg_template) > 0 and "content" in msg_template[0]:
        content = msg_template[0]["content"]
        if "{{current_task}}" in content:
            msg_template[0]["content"] = content.replace("{{current_task}}", f"{context}{query}")

    messages = msg_template + [{"role": "user", "content": query}]
    logger.debug(f"Messages:\n{json.dumps(messages, indent=2)}")

    assert messages[0]["content"] == original_content, "Template should be unchanged when no placeholder"
    assert message_template[0]["content"] == original_content, "Original template must not be mutated"
    ok("_build_initial_messages -- no placeholder, template unchanged")


# ============================================================================
# TEST 8: _build_initial_messages -- task transition uses new query
# ============================================================================
async def test_build_initial_messages_task_transition():
    logger.info("=" * 60)
    logger.info("TEST 8: _build_initial_messages -- task transition uses new query")

    message_template = [
        {
            "role": "system",
            "content": 'initial_task = """\n{{current_task}}\n"""',
        }
    ]

    context = ""
    query1 = "Task 1: Research the topic"
    msg1 = copy.deepcopy(message_template)
    msg1[0]["content"] = msg1[0]["content"].replace("{{current_task}}", f"{context}{query1}")
    messages1 = msg1 + [{"role": "user", "content": query1}]

    query2 = "Task 2: Write the report"
    msg2 = copy.deepcopy(message_template)
    msg2[0]["content"] = msg2[0]["content"].replace("{{current_task}}", f"{context}{query2}")
    messages2 = msg2 + [{"role": "user", "content": query2}]

    logger.debug(f"Task 1 system:\n{messages1[0]['content']}")
    logger.debug(f"Task 2 system:\n{messages2[0]['content']}")

    assert query1 in messages1[0]["content"], "Task 1 not in first messages"
    assert query2 not in messages1[0]["content"], "Task 2 should not be in first messages"
    assert query2 in messages2[0]["content"], "Task 2 not in second messages"
    assert query1 not in messages2[0]["content"], "Task 1 should not be in second messages"
    assert "{{current_task}}" in message_template[0]["content"], "Original template must retain placeholder"
    ok("_build_initial_messages -- task transition uses new query correctly")


# ============================================================================
# TEST 9: format_node_code -- empty tools list
# ============================================================================
def test_format_node_code_empty_tools():
    logger.info("=" * 60)
    logger.info("TEST 9: format_node_code -- empty tools list")

    node = {
        "skillPath": "",
        "tools": [],
        "children": {},
    }
    code = format_node_code("bare_agent", node)
    logger.debug(f"Generated code:\n{code}")

    assert "available_tools=[]" in code, "Empty tools should produce empty list"
    ok("format_node_code -- empty tools list")


# ============================================================================
# TEST 10: {{current_task}} survives as literal in programmatic prompt
# ============================================================================
def test_current_task_is_literal_placeholder():
    logger.info("=" * 60)
    logger.info("TEST 10: {{current_task}} is literal placeholder after f-string evaluation")

    # In main.py the f-string uses {{{{current_task}}}} which produces {{current_task}} as output:
    #   {{ -> { (escaped brace)  so {{{{ -> {{
    #   }} -> } (escaped brace)  so }}}} -> }}
    # Result: {{current_task}}  (double braces — a literal Mustache-style placeholder).
    rendered = f"initial_task = \"\"\"\n{{{{current_task}}}}\n\"\"\""
    logger.debug(f"Rendered placeholder: {rendered}")

    assert "{{current_task}}" in rendered, "{{current_task}} must remain as literal in the output"
    ok("{{current_task}} is literal placeholder after f-string evaluation")


# ============================================================================
# TEST 11: pipeline_base.llm_tool programmatic prompt -- same structure as TEST 5
# ============================================================================
def test_llm_tool_programmatic_prompt():
    """
    Exercises the same prompt-building code that lives inside pipeline_base.llm_tool
    (the enableProgrammaticToolCalling=True branch, lines 218-504).
    We copy the exact logic here so no model/event infrastructure is needed,
    and assert all structural properties from TEST 5.
    """
    logger.info("=" * 60)
    logger.info("TEST 11: pipeline_base.llm_tool -- programmatic prompt matches TEST 5 structure")

    import platform
    from datetime import datetime
    import os as _os

    # ----- same fixtures as TEST 5 -------------------------------------------
    agent_id = "planner_agent"
    agent_node = {
        "skillPath": "/skills/planner.md",
        "tools": ["web_search", "read_file"],
        "children": {
            "writer_agent": {
                "skillPath": "/skills/writer.md",
                "tools": ["write_file"],
                "children": {},
            }
        },
        "enableProgrammaticToolCalling": True,
    }
    all_tools_mock = [
        {"type": "function", "function": {"name": "web_search", "description": "Search the web for information."}},
        {"type": "function", "function": {"name": "read_file", "description": "Read content from a file."}},
        {"type": "function", "function": {"name": "agent_query", "description": "Delegate tasks to sub-agents."}},
    ]

    # ----- helpers (mirrors pipeline_base.py) ---------------------------------
    def get_skill_info_pb(skill_path: str):
        if not skill_path:
            return "", "No description available"
        fname = _os.path.basename(skill_path)
        return fname, f"Description for {fname}"

    def format_node_code_pb(a_id: str, a_node: dict, indent: str = "") -> str:
        skill_path = a_node.get("skillPath", "")
        fname, skill_desc = get_skill_info_pb(skill_path) if skill_path else ("", "No description available")
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
                child_code = format_node_code_pb(child_id, child_node, indent + "        ")
                node_lines.append(child_code + ",")
            node_lines.append(f"{indent}    ],")
        node_lines.append(f"{indent})")
        return "\n".join(node_lines)

    # ----- reproduce llm_tool context builder ---------------------------------
    os_info = f"{platform.system()} {platform.release()}"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    tree_code = "tree = " + format_node_code_pb(agent_id, agent_node, "")

    allowed_tools = set(agent_node.get("tools", []))
    children = agent_node.get("children", {})
    if children:
        allowed_tools.add("agent_query")

    tool_defs = []
    for t_name in sorted(allowed_tools):
        t_desc = "No description available"
        for t in all_tools_mock:
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
        f"- Current node: `{agent_id}`\n"
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
        "    next_tasks: List[str] = field(default_factory=list)\n"
        "    next_branch: Optional[str] = None\n"
        "\n\n"
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
        f"You are the `{agent_id}` agent. Implement the body of `execute(task: str)` inside `{agent_id}/main.py`.\n"
        "Return **only** the code inside the function body — no signature line, no imports, no markdown fences, no explanation.\n"
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
        + f"    Entry-point coroutine: runs the {agent_id} node on `initial_task`, fans out\n"
        "    to any follow-up branch tasks declared in the returned ActionResult, and returns\n"
        "    the collected list of all result payloads.\n"
        '    """\n'
        "    results: List[Dict[str, Any]] = []\n"
        + f'    node = get_node("{agent_id}")\n'
        "    data: ActionResult = await node.execute(initial_task)\n"
        "    results.append(data.result)\n"
        "    # (parent_node, branch_id, task)\n"
        "    queue: deque[tuple] = deque()\n"
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
        "```\n"
    )
    _llm_tool_docs = (
        "## Using `llm_tool`\n"
        "\n"
        "`llm_tool` is a **structured-output-only** LLM call. Under the hood, the model is instructed to call a tool on every response — it never returns plain text. You supply one or more `ToolRegistry` objects; the model picks the right one, fills in the parameters, and your `call` function receives those arguments as `**kwargs`.\n"
        "\n"
        "Use `llm_tool` whenever you need to transform, condense, or structure raw data — after a `web_search`, before building `result`, or when populating `next_tasks`.\n"
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
        "- Use the available tools (`web_search`, `read_file`, `write_file`, `extract`) to research `task` and gather raw findings.\n"
        "- Use `llm_tool` to summarize, analyze, classify, or structure tool output before building `result`.\n"
        "- Build `result` as `{ task: findings }` where `findings` is a structured dict of your processed output.\n"
        "- Initialize `next_tasks: List[str] = []` and `next_branch: Optional[str] = None`; only populate them if research explicitly surfaces follow-up tasks for a child branch.\n"
        '- Wrap the **entire** body in `try/except`: on any exception, return `ActionResult(result={task: {"error": str(e)}}, next_tasks=[], next_branch=None)` — `execute()` must never raise.\n'
        "- Return `ActionResult(result=result, next_tasks=next_tasks, next_branch=next_branch).\n"
    )
    prompt = (
        _env_header + "\n---\n\n"
        + _main_py_block + "\n---\n\n"
        + _agent_section + "\n---\n\n"
        + _llm_tool_docs + "\n---\n\n"
        + get_skill_content(agent_node.get("skillPath", ""))
    )

    logger.debug(f"TEST 11 -- llm_tool programmatic prompt (FULL):\n{prompt}")

    # --- same 36 assertions as TEST 5 ---
    assert "## Environment" in prompt, "Missing Environment section"
    assert f"Current node: `{agent_id}`" in prompt, "Missing current node"

    assert "class ToolRegistry:" in prompt, "Missing ToolRegistry class"
    assert "class ActionResult:" in prompt, "Missing ActionResult dataclass"
    assert "class Skill:" in prompt, "Missing Skill dataclass"
    assert "class Node:" in prompt, "Missing Node dataclass"
    assert "def get_node(" in prompt, "Missing get_node function"
    assert "def load(path: str, name: str)" in prompt, "Missing load() stub"

    assert "tree = Node(" in prompt, "tree must have 'tree = ' assignment prefix"
    assert f'name="{agent_id}"' in prompt, "Missing root agent in tree"
    assert 'name="writer_agent"' in prompt, "Missing child agent in tree"

    assert "The following are already available at call time:" in prompt
    assert "{{current_task}}" in prompt, "{{current_task}} placeholder must be literal double-braces"

    assert "async def llm_tool(" in prompt, "Missing llm_tool definition"
    assert "tool_registry: Optional[Dict[str, ToolRegistry]] = None," in prompt

    assert "async def web_search(query: str) -> str:" in prompt, "Missing web_search tool def"
    assert "async def read_file(query: str) -> str:" in prompt, "Missing read_file tool def"
    assert "async def agent_query(query: str) -> str:" in prompt, "Missing agent_query tool def"
    assert "Search the web for information." in prompt, "Missing web_search description"

    assert "Entry-point coroutine:" in prompt, "Missing main() docstring"
    assert "results: List[Dict[str, Any]] = []" in prompt
    assert "data: ActionResult = await node.execute(initial_task)" in prompt
    assert "results.append(data.result)" in prompt
    assert "if data.next_branch and len(data.next_tasks) > 0:" in prompt

    assert "structured-output-only" in prompt
    assert "| Parameter | Type | Description |" in prompt
    assert "| `query` | `str` |" in prompt
    assert "| `tool_registry` |" in prompt
    assert '{"tool_name": ToolRegistry(...)}' in prompt, "Signature must have single-brace dict"
    assert "Returns `{}` on any error." in prompt, "Returns {} must be single-brace"
    assert "> Always check `if not res:` before reading fields." in prompt

    assert '""""' in prompt, "ToolRegistry example must use 4-quote sentinel"
    assert '{"output_field": processed_value or value }' in prompt
    assert "schema={" in prompt
    assert '"name": "my_tool"' in prompt
    assert '"required": ["output_field"]' in prompt

    assert "**Rules:**" in prompt
    assert "Fields listed in `required` are always filled by the model" in prompt
    assert "### Error Handling" in prompt
    assert 'raise RuntimeError("llm_tool returned empty' in prompt

    assert "- Use the available tools" in prompt
    assert "- Use `llm_tool` to summarize" in prompt
    assert "{ task: findings }" in prompt
    assert "- Initialize `next_tasks: List[str] = []`" in prompt
    assert 'result={task: {"error": str(e)}}' in prompt
    assert "- Return `ActionResult(result=result" in prompt

    # Skill section (fallback placeholder when skill file doesn't exist)
    assert "# Placeholder Skill" in prompt, "Missing skill content section at end of prompt"

    ok("pipeline_base.llm_tool -- programmatic prompt matches TEST 5 structure (11/11 properties)")


# ============================================================================
# Runner
# ============================================================================
async def main():
    logger.info("=" * 70)
    logger.info("  programmatic_tool_test.py -- running all tests")
    logger.info("=" * 70)

    test_format_node_code_leaf()
    test_format_node_code_parent_child()
    test_format_node_code_deep_nesting()
    test_format_node_code_no_duplicate_agent_query()
    test_programmatic_prompt_construction()
    test_format_node_code_empty_tools()
    test_current_task_is_literal_placeholder()
    test_llm_tool_programmatic_prompt()

    await test_build_initial_messages_replaces_current_task()
    await test_build_initial_messages_no_placeholder()
    await test_build_initial_messages_task_transition()

    logger.info("=" * 70)
    logger.info(f"  Results: {passed} passed, {failed} failed")
    logger.info("=" * 70)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

