"""
Code Sandbox - Execute LLM-generated Python code with tool access.

No security restrictions - full Python access.
Tools are exposed as async functions the code can call.
"""

import asyncio
import io
import traceback
import logging
from typing import Any, Dict, Optional, TYPE_CHECKING
from contextlib import redirect_stdout, redirect_stderr

if TYPE_CHECKING:
    from .tool_manager import ToolManager

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
    
    def __init__(self, tool_manager : "ToolManager"):
        self.tool_manager = tool_manager
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
    
    async def execute(self, code: str, workspace: str = "Private", tab_id: Optional[str] = None, extra_globals: Optional[Dict] = None) -> Dict[str, Any]:
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
        
        # Build globals with tools
        exec_globals = {
            "__builtins__": __builtins__,
            "asyncio": asyncio,
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
            # Compile the wrapper
            compiled = compile(wrapped_code, "<llm_code>", "exec")
            
            # Execute to define the function
            exec(compiled, exec_globals, exec_locals)
            
            # Get the async function and run it
            user_code_func = exec_locals["__user_code__"]
            
            # Capture output while running
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                result = await user_code_func() #pyrefly: ignore
                    
        except Exception as e:
            error = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        
        return {
            "output": stdout_capture.getvalue(),
            "error": error or stderr_capture.getvalue() or None,
            "result": result,
            "success": error is None
        }
