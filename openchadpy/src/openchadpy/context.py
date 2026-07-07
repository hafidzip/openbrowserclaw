from __future__ import annotations
from contextvars import ContextVar
from typing import Any, Dict, List, Optional, TYPE_CHECKING, Union
if TYPE_CHECKING:
    from .pipeline_base import PipelineBase
# Context variable
pipeline_ctx: ContextVar[Optional[PipelineBase]] = ContextVar("pipeline", default=None)
fields_ctx: ContextVar[Dict[str, Any]] = ContextVar("fields", default={})
additional_args_ctx: ContextVar[Dict[str, Any]] = ContextVar("additional_args", default={})
agent_ctx:ContextVar[Optional[Dict[str, Any]]] = ContextVar("agent", default=None) 
workspace_ctx: ContextVar[Optional[str]] = ContextVar("workspace", default="global")
tab_id_ctx: ContextVar[Optional[str]] = ContextVar("tab_id", default="global")
model_id_ctx: ContextVar[Optional[str]] = ContextVar("model_id", default=None)
max_retries_ctx: ContextVar[int] = ContextVar("max_retries", default=99)
cdp_ports: Dict[str, int] = {}
console_messages: Dict[str, List[Any]] = {}


def coerce_scalar(v: Any) -> Any:
    """Coerce a *scalar* value to its true Python type.

    Field types from AgentNodeEditor that produce scalars:
      - ``text`` / ``email`` / ``url`` / ``enum`` / ``file`` / ``folder``
        → stored as ``str``; returned unchanged.
      - ``number``  → stored as JS ``number`` (Python ``int``/``float``) or
        ``''`` when the input is cleared; ``''`` is normalised to ``None``.
      - ``boolean`` (AdditionalArgsEditor toggle) → stored as JS ``bool``;
        but defensively also handle the string forms ``"true"``/``"false"``.
      - Already-typed ``bool`` / ``int`` / ``float`` → pass-through.
    """
    # Non-strings are already the right type (bool/int/float/None).
    if not isinstance(v, str):
        return v

    stripped = v.strip()

    # Empty string from a cleared number input → None
    if stripped == "":
        return None

    lower = stripped.lower()

    # Boolean string forms (defensive — normally arrives as real bool)
    if lower == "true":
        return True
    if lower == "false":
        return False

    # Numeric strings  (e.g. array:number items stored as strings)
    try:
        int_val = int(stripped)
        return int_val
    except ValueError:
        pass
    try:
        float_val = float(stripped)
        return float_val
    except ValueError:
        pass

    # Everything else (text, enum, file/folder path, url, email) → str
    return v


def coerce_value(v: Any) -> Any:
    """Coerce any field value, including ``list`` containers produced by
    ``array:*`` field types in AgentNodeEditor.

    - ``array:string`` / ``array:file`` / ``array:folder`` / ``array:enum``
      → ``list[str]``
    - ``array:number``
      → ``list[int | float]``  (each item passed through :func:`_coerce_scalar`)
    - Scalar values → delegated to :func:`_coerce_scalar`.
    """
    if isinstance(v, list):
        return [coerce_scalar(item) for item in v]
    return coerce_scalar(v)


def parse_additional_args() -> Dict[str, Any]:
    """Return ``additional_args_ctx`` with all values coerced to their true
    Python types (``bool``, ``int``, ``float``, ``None``, or ``str``).

    ``additionalArgs`` from AgentNodeEditor is a **flat** dict
    ``{key: str | bool | number}`` typed explicitly by the user via the
    type selector (str / num / bool).  Values that are already the correct
    type pass through unchanged; string-encoded booleans / numbers are
    coerced defensively.

    Safe to unpack into ``model_manager.chat``::

        await model_manager.chat(..., **{**chat_kwargs, **parse_additional_args()})
    """
    raw: Dict[str, Any] = additional_args_ctx.get()
    return {k: coerce_value(v) for k, v in raw.items()}
