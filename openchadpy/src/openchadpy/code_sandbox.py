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

if TYPE_CHECKING:
    from .tool_manager import ToolManager
    from .model_manager import ModelManager

logger = logging.getLogger(__name__)


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
            # Wrap code in async function to support await
            indent = "    "
            indented_code = "\n".join(indent + line for line in code.split("\n"))
            
            wrapped_code = f"""
async def __user_code__():
{indented_code}
""" 
            logger.info(f"[code_sandbox] wrapped_code length: {len(wrapped_code)}")
            logger.info(f"[code_sandbox] wrapped_code: \n{wrapped_code}")
            # Compile the wrapper
            compiled = compile(wrapped_code, "<llm_code>", "exec")
            
            # Execute to define the function
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
