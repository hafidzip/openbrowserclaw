from __future__ import annotations
from contextvars import ContextVar
from typing import Any, Dict, List, Optional, TYPE_CHECKING
if TYPE_CHECKING:
    from .pipeline_base import PipelineBase
# Context variable
pipeline_ctx: ContextVar[Optional[PipelineBase]] = ContextVar("pipeline", default=None)
fields_ctx: ContextVar[Dict[str, Any]] = ContextVar("fields", default={})
agent_ctx:ContextVar[Optional[Dict[str, Any]]] = ContextVar("agent", default=None) 
workspace_ctx: ContextVar[Optional[str]] = ContextVar("workspace", default="global")
tab_id_ctx: ContextVar[Optional[str]] = ContextVar("tab_id", default="global")
model_id_ctx: ContextVar[Optional[str]] = ContextVar("model_id", default=None)
max_retries_ctx: ContextVar[int] = ContextVar("max_retries", default=99)
cdp_ports: Dict[str, int] = {}
console_messages: Dict[str, List[Any]] = {}
