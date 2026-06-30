"""
Code Sandbox - Execute LLM-generated Python code with tool access.

No security restrictions - full Python access.
Tools are exposed as async functions the code can call.
"""

from ast import Set
from typing import Union
from ast import Tuple
from dataclasses import field
from dataclasses import dataclass
import json
from openchadpy.context import model_id_ctx
from openchadpy.tool_base import ToolRegistry
import datetime
import re
import asyncio
import io
import traceback
import logging
from typing import Any, Dict, Optional, List, TYPE_CHECKING
from contextlib import redirect_stdout, redirect_stderr
import ast
import textwrap

if TYPE_CHECKING:
    from .tool_manager import ToolManager
    from .model_manager import ModelManager

logger = logging.getLogger(__name__)

def clean_execute_body(code: str) -> str:
    code = re.sub(r'^[a-z]+try:', 'try:', code)
    return code

def extract_execute_body(source: str) -> str:
    """
    Extract the try/except block from the body of an `execute` function.

    Handles both `async def execute` and `def execute`. Searches top-level
    first, falls back to anywhere in the tree. Returns the block dedented.
    If the function is absent, has no try block, or parsing fails entirely,
    returns `source` unchanged.

    Requires Python 3.8+ (ast.get_source_segment, end_lineno).
    """
    # Support ast.TryStar (Python 3.11+ except*)
    _TRY_TYPES = (ast.Try, ast.TryStar) if hasattr(ast, "TryStar") else (ast.Try,)
    _FUNC_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef)

    def _parse(src: str) -> Optional[ast.Module]:
        try:
            return ast.parse(src)
        except SyntaxError:
            return None

    # --- 1. Parse --------------------------------------------------------
    tree = _parse(source)
    working = source

    if tree is None:
        # Pasted/indented code that isn't valid at module level
        working = textwrap.dedent(source)
        tree = _parse(working)

    if tree is None:
        return source  # unparseable even after dedent — give up gracefully

    # --- 2. Locate `execute` ---------------------------------------------
    execute_fn = None

    # Prefer a top-level definition (avoids accidentally grabbing a nested fn)
    for node in tree.body:
        if isinstance(node, _FUNC_TYPES) and node.name == "execute":
            execute_fn = node
            break

    # Fall back to anywhere in the tree (class methods, nested modules, etc.)
    if execute_fn is None:
        for node in ast.walk(tree):
            if isinstance(node, _FUNC_TYPES) and node.name == "execute":
                execute_fn = node
                break

    if execute_fn is None:
        return source  # no `execute` function found

    # --- 3. Find the first try block in the function body ----------------
    try_node = None
    for stmt in execute_fn.body:
        if isinstance(stmt, _TRY_TYPES):
            try_node = stmt
            break

    if try_node is None:
        return source  # body exists but has no try/except

    # --- 4. Extract source text ------------------------------------------
    segment = ast.get_source_segment(working, try_node)

    if not segment:
        # Fallback: slice by line numbers (end_lineno available since 3.8)
        lines = working.splitlines(keepends=True)
        end_line = getattr(try_node, "end_lineno", len(lines))
        segment = "".join(lines[try_node.lineno - 1 : end_line])

    if not segment:
        return source

    return textwrap.dedent(segment)


def heal_indentation(wrapped: str, indent: str = "    ") -> str:
    """
    Re-indent the body of `async def __user_code__():` so it compiles.

    Finds the function header line, strips whatever indentation the body
    currently has, and re-applies `indent` uniformly. Falls back to a
    per-line enforcement pass if the header line is not found.
    """
    lines = wrapped.splitlines(keepends=True)
    header_idx: Optional[int] = None
    for i, line in enumerate(lines):
        if line.lstrip().startswith(("async def __user_code__", "def __user_code__")):
            header_idx = i
            break

    if header_idx is None:
        # Fallback: ensure every non-empty line starts with indent
        out = []
        for line in lines:
            stripped = line.strip()
            if stripped and not line.startswith(indent):
                out.append(indent + stripped + "\n")
            else:
                out.append(line)
        return "".join(out)

    header = "".join(lines[: header_idx + 1])
    body_raw = "".join(lines[header_idx + 1 :])
    body_fixed = textwrap.indent(textwrap.dedent(body_raw).strip("\n"), indent) + "\n"
    return header + body_fixed


class CodeSandbox:
    """
    Execute Python code from LLM with access to tools.
    
    Usage:
        sandbox = CodeSandbox(tool_manager)
        result = await sandbox.execute('''
            result = await counter(action="increment", value=5)
            print(f"Count is now: {result['count']}")
        ''')
    """

    @dataclass
    class ActionResult:
        result: Dict[str, Any]              = field(default_factory=dict)
        next_branches: Dict[str, List[str]] = field(default_factory=dict)
        next_tasks: List[str]               = field(default_factory=list)
        next_branch: Optional[str]          = None
    
    def __init__(self, tool_manager : "ToolManager", model_manager: "ModelManager"):
        self.tool_manager = tool_manager
        self.model_manager = model_manager
        self.timeout = 60  # seconds
    
    def _make_tool_func(self, tool_name: str, workspace: str = "Private", tab_id: Optional[str] = None):
        """Create an async function that calls a specific tool."""
        tool_manager = self.tool_manager
        
        async def tool_func(**kwargs):
            return await tool_manager.execute_tool(
                tool_name, 
                caller="code_execution", 
                workspace=workspace, 
                tab_id=tab_id, 
                **kwargs
            )
        
        tool_func.__name__ = tool_name
        tool_func.__doc__ = f"Call the {tool_name} tool"
        return tool_func
    
    async def execute(self, code: str, task:str, workspace: str = "Private", tab_id: Optional[str] = None, extra_globals: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Execute Python code with tool access.
        
        Args:
            code: Python code to execute
            workspace: Workspace context
            tab_id: Tab ID context
            extra_globals: Additional variables to expose
            
        Returns:
            {
                "output": stdout from execution,
                "error": stderr/exception if any,
                "result": last expression value if any,
                "success": True/False
            }
        """
        # Capture stdout/stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        async def llm_tool(query: str, tool_registry: Optional[Dict[str, "ToolRegistry"]] = None) -> Dict[str, Any]:
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
                                    # Always coerce to dict so callers can safely use .get()
                                    if not isinstance(result, dict):
                                        result = {"result": result}
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
        
        # Build globals with tools
        exec_globals = {
            "__builtins__": __builtins__,
            "asyncio": asyncio,
            "json": json,
            "re": re,
            "datetime": datetime,
            "llm_tool": llm_tool,
            "ToolRegistry": ToolRegistry,
            "ActionResult": self.ActionResult,
            "Any": Any,
            "Dict": Dict,
            "List": List,
            "Optional": Optional,
            "Tuple": Tuple,
            "Union": Union,
            "Set": Set,
            "task": task,
            "initial_task": task
        }
        
        # Add tool functions
        for tool_name in self.tool_manager.all_tools: #pyrefly: ignore
            exec_globals[tool_name] = self._make_tool_func(
                tool_name=tool_name, 
                workspace=workspace, 
                tab_id=tab_id
            )
        
        # Add extra globals
        if extra_globals:
            exec_globals.update(extra_globals)
        
        exec_locals = {}
        result = None
        error = None
        
        try:
            _indent = "    "
            current_code = code
            attempts_history = []
            max_retries = 3
            compiled = None
            wrapped_code = ""

            # Define a tool for healing the code
            corrected_code = None
            async def submit_healed_code(code: str) -> Dict[str, Any]:
                nonlocal corrected_code
                corrected_code = code
                return {"status": "success"}

            heal_tool_schema = {
                "type": "function",
                "function": {
                    "name": "submit_healed_code",
                    "description": "Submit the corrected Python code that fixes the compile error.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "The complete, corrected Python code."
                            }
                        },
                        "required": ["code"]
                    }
                }
            }
            heal_tool = ToolRegistry(submit_healed_code, heal_tool_schema)
            heal_registry = {"submit_healed_code": heal_tool}
            current_code = extract_execute_body(clean_execute_body(current_code))
            current_code = textwrap.indent(textwrap.dedent(current_code).strip("\n"), _indent)
            current_code = f"async def __user_code__():\n{current_code}\n"

            for retry in range(max_retries + 1):
                try:
                    # extract_execute_body returns col-0 dedented code; re-indent for the wrapper

                    logger.info(f"[code_sandbox] wrapped_code length: {len(current_code)} (attempt {retry})")
                    logger.info(f"[code_sandbox] wrapped_code: \n{current_code}")

                    # Compile with heal-on-IndentationError fallback
                    try:
                        compiled = compile(current_code, "<llm_code>", "exec")
                    except IndentationError as _ie:
                        logger.warning(f"[code_sandbox] IndentationError – attempting heal: {_ie}")
                        current_code = heal_indentation(current_code, _indent)
                        logger.info(f"[code_sandbox] healed wrapped_code:\n{current_code}")
                        compiled = compile(current_code, "<llm_code>", "exec")
                    
                    # If compilation succeeds, break from the retry loop
                    break
                except Exception as e:
                    err_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
                    logger.error(f"[code_sandbox] Compile error on attempt {retry}: {err_msg}")
                    
                    if retry >= max_retries:
                        # Max retries reached, raise the exception to be caught by outer try-except block
                        raise
                    
                    attempts_history.append({
                        "attempt": retry,
                        "code": current_code,
                        "error": err_msg
                    })
                    
                    # Construct history text with all previous attempts
                    history_text = ""
                    for att in attempts_history:
                        attempt_num = int(att['attempt']) + 1
                        history_text += f"\n--- Attempt {attempt_num} Code ---\n{att['code']}\n"
                        history_text += f"\n--- Attempt {attempt_num} Compile Error ---\n{att['error']}\n"
                    
                    query = (
                        f"We encountered a compile error when trying to compile the Python code for the task: '{task}'.\n"
                        f"Here is the history of failed attempts and their errors:\n"
                        f"{history_text}\n"
                        f"Please analyze the errors carefully, fix the syntax/indentation/compilation issues, "
                        f"and submit the complete corrected Python code using the `submit_healed_code` tool."
                    )
                    
                    logger.info(f"[code_sandbox] Requesting heal from llm_tool (retry {retry + 1}/{max_retries})")
                    
                    corrected_code = None
                    await llm_tool(query, tool_registry=heal_registry)
                    
                    if corrected_code:
                        # Clean markdown code block wraps if LLM added them inside the string parameter
                        m = re.search(r"```(?:python)?\n(.*?)\n```", corrected_code, re.DOTALL | re.IGNORECASE)
                        if m:
                            corrected_code = m.group(1)
                        else:
                            m_open = re.search(r"```(?:python)?\n(.*)", corrected_code, re.DOTALL | re.IGNORECASE)
                            if m_open:
                                corrected_code = m_open.group(1).rstrip("` \n\r")
                        
                        logger.info(f"[code_sandbox] Received healed code: {corrected_code}")
                        current_code = corrected_code
                    else:
                        logger.error("[code_sandbox] llm_tool failed to return healed code via submit_healed_code")
                        raise
            
            # Execute to define the function
            assert compiled is not None, "compiled code must not be None"
            exec(compiled, exec_globals, exec_locals)
            
            # Get the async function and run it
            user_code_func = exec_locals["__user_code__"]
            
            # Capture output while running
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                result = await user_code_func() #pyrefly: ignore
                if hasattr(result, "__dataclass_fields__"):
                    from dataclasses import asdict
                    try:
                        serialized = json.dumps(asdict(result), default=str)
                        logger.info(f"[code_sandbox] result is ActionResult: {serialized}")
                    except Exception as le:
                        props = {}
                        for field_name in result.__dataclass_fields__:
                            try:
                                props[field_name] = getattr(result, field_name)
                            except Exception:
                                props[field_name] = "<unreadable>"
                        logger.info(f"[code_sandbox] result is ActionResult: {json.dumps(props, default=str)} (fallback due to: {le})")
                else:
                    try:
                        logger.info(f"[code_sandbox] result: {json.dumps(result, default=str)}")
                    except Exception as le:
                        logger.info(f"[code_sandbox] result: {repr(result)} (fallback due to: {le})")
                    
        except Exception as e:
            error = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        
        return {
            "output": stdout_capture.getvalue(),
            "error": error or stderr_capture.getvalue() or None,
            "result": result,
            "success": error is None
        }