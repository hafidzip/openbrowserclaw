from openchadpy.context import additional_args_ctx
from typing import Union
from anyio import Path
from openchadpy.tool_base import ToolRegistry
from openchadpy.pipeline_base import PipelineBase
from openchadpy.context import agent_ctx, model_id_ctx, fields_ctx
from openchadpy.main import get_agent_tree_internal
import asyncio
try:
    from parser import Parser
except (ImportError, ValueError):
    from .parser import Parser
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import logging
import json
import time
import copy
import os
import re
import html
import sys
logger = logging.getLogger(__name__)

# If self.query exceeds this character count it will be spooled to disk and
# the LLM will receive a compact file-reference instruction instead.
MAX_QUERY_CHARS: int = 4000

def _escape_for_jsx(text: str) -> str:
    escaped = html.escape(text, quote=True)          # &, <, >, ", '
    escaped = escaped.replace("{", "&#123;").replace("}", "&#125;")
    escaped = escaped.replace("[", "&#91;").replace("]", "&#93;")
    return escaped

def _format_chunk(chunk: Any, max_length: int = 200) -> str:
    """Gracefully format any chunk type for logging."""
    try:
        if chunk is None:
            return "None"
        elif isinstance(chunk, (bytes, bytearray)):
            text = chunk.decode("utf-8", errors="replace")
            preview = text[:max_length]
            suffix = f"... [{len(text)} chars]" if len(text) > max_length else ""
            return f"bytes({preview!r}{suffix})"
        elif isinstance(chunk, str):
            preview = chunk[:max_length]
            suffix = f"... [{len(chunk)} chars]" if len(chunk) > max_length else ""
            return f"str({preview!r}{suffix})"
        elif isinstance(chunk, dict):
            preview = json.dumps(chunk, default=str)
            if len(preview) > max_length:
                preview = preview[:max_length] + f"... [{len(chunk)} keys]"
            return f"dict({preview})"
        elif isinstance(chunk, (list, tuple)):
            type_name = type(chunk).__name__
            sample = chunk[:5]
            preview = json.dumps(list(sample), default=str)
            suffix = f" ... [{len(chunk)} items total]" if len(chunk) > 5 else ""
            return f"{type_name}({preview}{suffix})"
        elif isinstance(chunk, (int, float, bool)):
            return f"{type(chunk).__name__}({chunk})"
        else:
            r = repr(chunk)
            if len(r) > max_length:
                return r[:max_length] + f"... [type={type(chunk).__name__}]"
            return r
    except Exception as e:
        return f"<unformattable chunk type={type(chunk).__name__} error={e}>"

def _sha256_short(input_str: str) -> str:
    """SHA-256 hash truncated to 32 hex chars."""
    return hashlib.sha256(input_str.encode("utf-8")).hexdigest()[:32]

def _make_empty_model_output(model: Optional[str] = "") -> Dict[str, Any]:
    """Create an empty ModelOutput dict."""
    return {
        "isStreaming": True,
        "content": "<div></div>",
        "token_per_second": None,
        "costs": [],
        "model": model or "",
        "date": int(time.time()),
    }

def _extract_content_from_response(response: Any) -> str:
    """Extract the text content from a ModelOutput."""
    if isinstance(response, dict) and "content" in response:
        return response["content"]
    return ""

def _escape_xml_attr(s: str) -> str:
    """Escape a string for use inside a double-quoted XML attribute."""
    return (
        s.replace("&", "&amp;")
         .replace('"', "&quot;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
    )

def _parse_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() == "true"
    return False

_RE_THINK_BLOCK = re.compile(
    r"<think>.*?</think>|<thinking>.*?</thinking>",
    re.DOTALL | re.IGNORECASE,
)
_RE_TOOL_CALL = re.compile(
    r"<ToolCall\b[^>]*/>",
    re.DOTALL,
)
_RE_CODE_BLOCK = re.compile(
    r"<CodeBlock\b[^>]*>.*?</CodeBlock>",
    re.DOTALL,
)

def _clean_assistant_content(text: str) -> str:
    """Strip MDX-rendered tags (think, tool call, code block wrappers) from
    assistant responses before they are inserted into the history context.
    The raw markdown content inside CodeBlock is preserved.
    """
    # Remove think blocks entirely
    text = _RE_THINK_BLOCK.sub("", text)
    # Remove ToolCall self-closing tags
    text = _RE_TOOL_CALL.sub("", text)
    # Unwrap CodeBlock  keep the inner ``` fence
    text = _RE_CODE_BLOCK.sub(lambda m: re.sub(r"<CodeBlock\b[^>]*>", "", m.group(0)).replace("</CodeBlock>", ""), text)
    return text.strip()


def object_to_text_tree(root_id: str, data: Union[str, Dict[str, Any]], spaced: bool = True) -> str:
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            return f"Error parsing JSON: {e}"

    if not isinstance(data, dict) or not data:
        return "Empty or invalid tree structure."

    def normalize_node(name: str, body: Any) -> Dict[str, Any]:
        children_list = []

        if isinstance(body, dict):
            children_data = body.get("children")

            if isinstance(children_data, dict):
                for child_key, child_body in children_data.items():
                    if isinstance(child_body, dict) and "name" in child_body:
                        display_name = f"{child_key} ({child_body['name']})"
                    else:
                        display_name = child_key
                    children_list.append(normalize_node(display_name, child_body))
            elif isinstance(children_data, list):
                for item in children_data:
                    if isinstance(item, dict):
                        for child_key, child_body in item.items():
                            if isinstance(child_body, dict) and "name" in child_body:
                                display_name = f"{child_key} ({child_body['name']})"
                            else:
                                display_name = child_key
                            children_list.append(normalize_node(display_name, child_body))
                    elif isinstance(item, str):
                        children_list.append({"name": item, "children": []})

        return {"name": name, "children": children_list}

    def render_node(node: Dict[str, Any], prefix: str = "", is_last: bool = True, is_root: bool = False) -> List[str]:
        lines = []
        name = node["name"]

        if is_root:
            lines.append(f"{root_id} ({name})")
            next_prefix = ""
        else:
            marker = "└── " if is_last else "├── "
            lines.append(f"{prefix}{marker}{name}")
            next_prefix = prefix + ("    " if is_last else "│   ")

        children = node["children"]
        count = len(children)

        for i, child in enumerate(children):
            is_child_last = (i == count - 1)
            if spaced and is_root:
                lines.append("│")
            lines.extend(render_node(child, next_prefix, is_child_last, is_root=False))

        return lines

    final_output = []

    if "name" in data and isinstance(data["name"], str):
        normalized_root = normalize_node(data["name"], data)
        final_output.extend(render_node(normalized_root, is_root=True))
    else:
        for root_name, root_body in data.items():
            normalized_root = normalize_node(root_name, root_body)
            final_output.extend(render_node(normalized_root, is_root=True))

    return "\n".join(final_output)

_RE_BACKTICK_FENCE = re.compile(
    r"```(?:[a-zA-Z0-9_+\-]*)?\r?\n(.*?)```",
    re.DOTALL,
)

def _extract_code_from_response(text: str) -> str:
    """Extract executable Python code from a model response.
    The model may respond with:
    - Plain code (no backtick fences) — returned as-is after stripping MDX tags.
    - One or more triple-backtick fenced blocks — the content of the last
      Python (or language-unspecified) block is returned.
    MDX rendering wrappers (<Think>, <ToolCall/>, <CodeBlock>) are stripped
    before code extraction so that renderer artefacts do not confuse the
    extraction logic.
    NOTE: end() runs before finalize(), so the parser's pending buffer may
    still hold the closing ``` when this is called.  We handle both the
    complete-fence case (regex match) and the incomplete-fence case (opening
    fence only) so a missing closing ``` never breaks compilation.
    """
    import textwrap
    # 1. Strip renderer tags (Think blocks, ToolCall tags, CodeBlock wrappers)
    text = _RE_THINK_BLOCK.sub("", text)
    text = _RE_TOOL_CALL.sub("", text)
    # Unwrap <CodeBlock …>…</CodeBlock> but keep the inner ``` fence so the
    # backtick-extraction step below can find it.
    text = _RE_CODE_BLOCK.sub(
        lambda m: re.sub(r"<CodeBlock\b[^>]*>", "", m.group(0)).replace("</CodeBlock>", ""),
        text,
    )
    text = text.strip("\r\n")
    # 2. Try to extract code from a complete backtick fence (opening + closing).
    matches = _RE_BACKTICK_FENCE.findall(text)
    if matches:
        raw_code = matches[-1]
    else:
        # Fallback: the closing ``` may still be in the parser's pending buffer
        # (end() runs before finalize()).  Strip the opening fence and treat
        # everything that follows as the code body.
        open_match = re.match(
            r"```(?:[a-zA-Z0-9_+\-]*)?\r?\n(.*)", text, re.DOTALL
        ) or re.match(
            r"```(?:[a-zA-Z0-9_+\-]*)?\n(.*)", text, re.DOTALL
        )
        if open_match:
            raw_code = open_match.group(1)
            # Remove any trailing incomplete ``` that made it in
            raw_code = re.sub(r"\n?```\s*$", "", raw_code, flags=re.DOTALL)
        else:
            raw_code = text
    # 3. Dedent to handle relative indentation correctly
    return textwrap.dedent(raw_code.strip("\r\n")).strip()

def _parse_action_result(raw: Any) -> Optional[Dict[str, Any]]:
    """Normalise a sandbox return value into a plain ActionResult-shaped dict.

    Accepts:
    - An ActionResult dataclass instance (has `.result` attribute)
    - A plain dict with 'result', 'next_tasks', 'next_branch' keys
    - None or anything else → returns None
    """
    if raw is None:
        return None
    # Dataclass instance (ActionResult)
    if hasattr(raw, "result"):
        return {
            "result":        raw.result,
            "next_tasks":    list(getattr(raw, "next_tasks", []) or []),
            "next_branch":   getattr(raw, "next_branch", None),
            "next_branches": dict(getattr(raw, "next_branches", {}) or {}),
        }
    # Plain dict
    if isinstance(raw, dict) and "result" in raw:
        return {
            "result":        raw.get("result", {}),
            "next_tasks":    list(raw.get("next_tasks") or []),
            "next_branch":   raw.get("next_branch"),
            "next_branches": dict(raw.get("next_branches") or {}),
        }
    return None
def _create_agent_query_tool(pipeline: "Chat", agent_node: dict) -> ToolRegistry:
    allow_multiple = _parse_bool(agent_node.get("allowMultiple"))
    if allow_multiple:
        schema = {
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
        }
    else:
        schema = {
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
        }

    async def execute_tool(**kwargs) -> Dict[str, Any]:
        queries = kwargs.get("queries")
        if not queries:
            query_val = kwargs.get("query") or kwargs.get("tasks")
            queries = [{"agent_id": kwargs.get("agent_id"), "tasks": query_val}]
        
        async def run_agent_queries(q_item: dict) -> List[dict]:
            sub_agent_id = q_item.get("agent_id")
            sub_tasks = q_item.get("tasks") or q_item.get("query")
            if not sub_agent_id or not sub_tasks:
                return []
            if isinstance(sub_tasks, str):
                sub_tasks = [sub_tasks]
            
            agent_results = []
            sub_agent_tree = agent_node.get("children", {}).get(sub_agent_id)
            if sub_agent_tree:
                old_agent = agent_ctx.get()
                old_model = model_id_ctx.get()
                old_fields = fields_ctx.get()
                old_additional_args = additional_args_ctx.get()
                
                agent_ctx.set({sub_agent_id: sub_agent_tree})
                sub_model = sub_agent_tree.get("model")
                
                fields_ctx.set(json.loads(sub_agent_tree.get("toolValues", "{}")))
                additional_args_ctx.set(json.loads(sub_agent_tree.get("additionalArgs", "{}")))

                if sub_model:
                    model_id_ctx.set(sub_model)

                
                try:
                    sub_agent_query = _create_agent_query_tool(pipeline, sub_agent_tree) if sub_agent_tree.get("children") else None
                    
                    for task in sub_tasks:
                        if pipeline.cancel_event and pipeline.cancel_event.is_set():
                            logger.info(
                                "[%s] cancel_event set before agent_query sub-task '%s' – aborting",
                                pipeline.__class__.__name__, task,
                            )
                            break
                        
                        tool_registry = {'agent_query': sub_agent_query} if sub_agent_query else None
                        try:
                            llm_task = asyncio.get_event_loop().create_task(
                                pipeline.llm_tool(
                                    history_id=sub_agent_id,
                                    query=task,
                                    tool_registry=tool_registry,
                                ),
                                name=f"agent_query_llm_tool_{id(pipeline)}",
                            )
                            cancel_sentinel = None
                            if pipeline.cancel_event:
                                cancel_sentinel = asyncio.get_event_loop().create_task(
                                    pipeline.cancel_event.wait(),
                                    name=f"cancel_sentinel_aq_{id(pipeline)}",
                                )
                            try:
                                if cancel_sentinel is not None:
                                    done, _ = await asyncio.wait(
                                        {llm_task, cancel_sentinel},
                                        return_when=asyncio.FIRST_COMPLETED,
                                    )
                                    if cancel_sentinel in done:
                                        logger.info(
                                            "[%s] agent_query: cancel_event fired – cancelling sub-task",
                                            pipeline.__class__.__name__,
                                        )
                                        llm_task.cancel()
                                        try:
                                            await llm_task
                                        except (asyncio.CancelledError, Exception):
                                            pass
                                        break
                                    ans = llm_task.result()
                                else:
                                    ans = await llm_task
                            finally:
                                if cancel_sentinel is not None and not cancel_sentinel.done():
                                    cancel_sentinel.cancel()
                                    try:
                                        await cancel_sentinel
                                    except (asyncio.CancelledError, Exception):
                                        pass
                            
                            entry = {
                                "agent_id": sub_agent_id,
                                "response": ans
                            }
                            # Recursive fan-out check for programmatic child
                            if isinstance(ans, dict) and ans.get("success") and ans.get("result") is not None:
                                child_action = _parse_action_result(ans["result"])
                                if child_action:
                                    has_single = child_action.get("next_branch") and child_action.get("next_tasks")
                                    has_multi  = bool(child_action.get("next_branches"))
                                    if has_single or has_multi:
                                        sub_results = await _fan_out_branch(pipeline, child_action)
                                        entry["sub_branch_results"] = sub_results
                            logger.info(f"[agent result] {sub_agent_id}: {entry}")
                            agent_results.append(entry)
                        except Exception as e:
                            logger.exception("Error executing sub-agent task: %s", task)
                            agent_results.append({
                                "agent_id": sub_agent_id,
                                "response": f"Error: {str(e)}"
                            })
                finally:
                    agent_ctx.set(old_agent)
                    model_id_ctx.set(old_model)
                    fields_ctx.set(old_fields)
                    additional_args_ctx.set(old_additional_args)
            else:
                agent_results.append({
                    "agent_id": sub_agent_id,
                    "response": f"Error: Agent '{sub_agent_id}' not found."
                })
            return agent_results

        results = await asyncio.gather(*(run_agent_queries(q) for q in queries))
        flat_results = []
        for r in results:
            flat_results.extend(r)
        return {"results": flat_results} if allow_multiple else (flat_results[0] if flat_results else {})

    return ToolRegistry(call=execute_tool, schema=schema)


async def _fan_out_single_branch(
    pipeline: "Chat",
    child_id: str,
    tasks: List[str],
    cancel_event: Any,
) -> List[Dict[str, Any]]:
    """Run *tasks* against a single child branch (``child_id``).

    Expects ``agent_ctx`` to already be set to the parent node so the child
    node can be resolved from its ``children`` dict.  The context is swapped
    to the child for the duration of the call and restored before returning.

    Returns a list of per-task result dicts.
    """
    agent = agent_ctx.get()
    if not agent or not isinstance(agent, dict):
        logger.warning("[_fan_out_single_branch] no agent_ctx, skipping branch '%s'", child_id)
        return []

    current_id = next(iter(agent))
    current_node = agent[current_id]
    child_node = current_node.get("children", {}).get(child_id)
    if not child_node:
        logger.warning(
            "[_fan_out_single_branch] child node '%s' not found in '%s'",
            child_id, current_id,
        )
        return []

    # Swap agent_ctx / model_id_ctx to the child node for the duration.
    old_agent = agent_ctx.get()
    old_model = model_id_ctx.get()
    old_fields = fields_ctx.get()
    old_additional_args = additional_args_ctx.get()
    
    agent_ctx.set({child_id: child_node})
    child_model = child_node.get("model")
    fields_ctx.set(json.loads(child_node.get("toolValues", "{}")))
    additional_args_ctx.set(json.loads(child_node.get("additionalArgs", "{}")))
    if child_model:
        model_id_ctx.set(child_model)

    branch_results: List[Dict[str, Any]] = []
    try:
        is_child_prog = _parse_bool(child_node.get("enableProgrammaticToolCalling"))
        has_children = bool(child_node.get("children"))
        child_agent_query = None
        if not is_child_prog and has_children:
            child_agent_query = _create_agent_query_tool(pipeline, child_node)

        import inspect
        try:
            sig = inspect.signature(pipeline.llm_tool)
            has_tool_registry = "tool_registry" in sig.parameters or any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            )
        except Exception:
            has_tool_registry = False

        for task in tasks:
            # Pre-task cancel check.
            if cancel_event and cancel_event.is_set():
                logger.info(
                    "[_fan_out_single_branch] cancel_event set before task '%s' – aborting remaining tasks for '%s'",
                    task, child_id,
                )
                break
            try:
                # ── Cancel-aware LLM call (mirrors tool sentinel pattern) ──────
                _llm_sentinel: Optional[asyncio.Task] = None
                if cancel_event:
                    _llm_sentinel = asyncio.get_event_loop().create_task(
                        cancel_event.wait(),
                        name=f"cancel_sentinel_fan_out_{child_id}_{id(pipeline)}",
                    )
                try:
                    llm_kwargs: Dict[str, Any] = {
                        "query": task,
                        "history_id": child_id,
                    }
                    if child_agent_query and has_tool_registry:
                        llm_kwargs["tool_registry"] = {"agent_query": child_agent_query}

                    _llm_task: asyncio.Task = asyncio.get_event_loop().create_task(
                        pipeline.llm_tool(**llm_kwargs),
                        name=f"llm_tool_fan_out_{child_id}_{id(pipeline)}",
                    )
                    try:
                        if _llm_sentinel is not None:
                            # Race: whichever finishes first wins.
                            _done, _ = await asyncio.wait(
                                {_llm_task, _llm_sentinel},
                                return_when=asyncio.FIRST_COMPLETED,
                            )
                            if _llm_sentinel in _done:
                                # Cancel was requested while the LLM call was in flight.
                                logger.info(
                                    "[_fan_out_single_branch] cancel_event fired during llm_tool for task '%s' in branch '%s' – cancelling",
                                    task, child_id,
                                )
                                _llm_task.cancel()
                                try:
                                    await _llm_task
                                except (asyncio.CancelledError, Exception):
                                    pass
                                break  # exit the task loop
                            # LLM call finished normally – retrieve result.
                            ans = _llm_task.result()
                        else:
                            ans = await _llm_task
                    except asyncio.CancelledError:
                        _llm_task.cancel()
                        raise
                    except Exception:
                        raise
                finally:
                    # Always clean up the sentinel so it never leaks.
                    if _llm_sentinel is not None and not _llm_sentinel.done():
                        _llm_sentinel.cancel()
                        try:
                            await _llm_sentinel
                        except (asyncio.CancelledError, Exception):
                            pass
                # ─────────────────────────────────────────────────────────────
                entry: Dict[str, Any] = {"agent_id": child_id, "task": task, "response": ans}

                # Recursive fan-out: if the child returned an ActionResult with
                # next_branch+next_tasks OR next_branches, recurse.
                if isinstance(ans, dict) and ans.get("success") and ans.get("result") is not None:
                    child_action = _parse_action_result(ans["result"])
                    if child_action:
                        has_single = child_action.get("next_branch") and child_action.get("next_tasks")
                        has_multi  = bool(child_action.get("next_branches"))
                        if has_single or has_multi:
                            # Pre-recursion cancel check.
                            if cancel_event and cancel_event.is_set():
                                logger.info(
                                    "[_fan_out_single_branch] cancel_event set before recursive fan-out from '%s' – skipping",
                                    child_id,
                                )
                            else:
                                logger.info(
                                    "[_fan_out_single_branch] recursive fan-out from '%s': next_branch=%s next_branches=%s tasks=%s",
                                    child_id,
                                    child_action.get("next_branch"),
                                    list((child_action.get("next_branches") or {}).keys()),
                                    child_action.get("next_tasks"),
                                )
                                # agent_ctx is currently {child_id: child_node},
                                # so the recursive call resolves grandchildren
                                # from child_node["children"].
                                sub_results = await _fan_out_branch(pipeline, child_action)
                                logger.info(f"[sub branch result] {child_id}: \n {sub_results}")
                                entry["sub_branch_results"] = sub_results

                branch_results.append(entry)
            except Exception as exc:
                logger.exception("[_fan_out_single_branch] task failed | task=%s child=%s", task, child_id)
                branch_results.append({"agent_id": child_id, "task": task, "error": str(exc)})
    finally:
        agent_ctx.set(old_agent)
        model_id_ctx.set(old_model)
        fields_ctx.set(old_fields)
        additional_args_ctx.set(old_additional_args)

    logger.info(
        "[_fan_out_single_branch] completed %d branch tasks for '%s'",
        len(branch_results),
        child_id,
    )
    return branch_results


async def _fan_out_branch(pipeline: "Chat", action_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Delegate tasks to one or more child nodes via ``pipeline.llm_tool``.

    Supports two routing shapes in *action_result*:

    * **Single-branch**: ``{"next_branch": str, "next_tasks": [str, ...]}``
      – all tasks are sent to the one named child.

    * **Multi-branch**: ``{"next_branches": {branch_id: [str, ...], ...}}``
      – tasks are grouped per branch and each group is dispatched in order.

    Both shapes may coexist; ``next_branches`` is processed first, then
    ``next_branch`` / ``next_tasks`` if present.

    Returns a flat list of branch result dicts.  If a child's result is itself
    an ActionResult with ``next_branch`` / ``next_tasks`` or ``next_branches``,
    this function recurses automatically.

    Cancellation: checks ``pipeline.cancel_event`` before every branch and
    every task.  On cancel, returns whatever results were already collected so
    no work is orphaned and the caller can propagate the signal.
    """
    cancel_event = getattr(pipeline, "cancel_event", None)
    all_results: List[Dict[str, Any]] = []

    # ── Multi-branch path (concurrent) ───────────────────────────────────────
    next_branches: Dict[str, List[str]] = action_result.get("next_branches") or {}
    if next_branches:
        if cancel_event and cancel_event.is_set():
            logger.info(
                "[_fan_out_branch] cancel_event set before multi-branch dispatch – aborting",
            )
            return all_results

        async def _run_branch(br_id: str, br_tasks: List[str]) -> List[Dict[str, Any]]:
            if cancel_event and cancel_event.is_set():
                logger.info(
                    "[_fan_out_branch] cancel_event set before branch '%s' – skipping",
                    br_id,
                )
                return []
            logger.info(
                "[_fan_out_branch] multi-branch dispatch (concurrent): branch='%s', tasks=%s",
                br_id, br_tasks,
            )
            return await _fan_out_single_branch(pipeline, br_id, br_tasks, cancel_event)

        branch_results = await asyncio.gather(
            *(_run_branch(br_id, br_tasks) for br_id, br_tasks in next_branches.items()),
            return_exceptions=True,
        )
        for item in branch_results:
            if isinstance(item, BaseException):
                logger.error("[_fan_out_branch] branch raised an exception: %s", item)
            else:
                all_results.extend(item)

    # ── Single-branch path ───────────────────────────────────────────────────
    single_id: str | None = action_result.get("next_branch")
    single_tasks: List[str] = list(action_result.get("next_tasks") or [])
    if single_id and single_tasks:
        if cancel_event and cancel_event.is_set():
            logger.info(
                "[_fan_out_branch] cancel_event set before single branch '%s' – aborting",
                single_id,
            )
            return all_results
        logger.info(
            "[_fan_out_branch] single-branch dispatch: branch='%s', tasks=%s",
            single_id, single_tasks,
        )
        results = await _fan_out_single_branch(pipeline, single_id, single_tasks, cancel_event)
        all_results.extend(results)

    logger.info("[_fan_out_branch] completed total %d results", len(all_results))
    return all_results


def safe_get(data: Any, *keys: Any, default: Any = None) -> Any:
    for key in keys:
        try:
            data = data[key]
        except (KeyError, IndexError, TypeError):
            return default
    return data

# Content segment types
# Each segment is a dict with a "type" key:
#   {"type": "text",       "content": str}
#   {"type": "tool_call",  "id": str, "name": str, "parameters": str}
#   {"type": "code_block", "id": str, "lang": str, "code": str}

class Chat(PipelineBase):
    root_agent: str
    logs: Dict[str, Any]
    r: Dict[str, Any]
    message_template: List[Dict[str, Any]]
    content: str
    tool_logs: List[List[Dict[str, Any]]]
    detect_tool_calls: bool
    _agent_mode: bool
    current_agent_id: str | None
    _programmatic_tool_calling: bool
    _frontend_prefix: str

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._frontend_prefix = ""
        self._agent_mode = False
        self._programmatic_tool_calling = False

        self.prompt = """
        You are a helpful assistant.
        """

        self.message_template = [
            {
                "role": "system",
                "content": self.prompt,
            }
        ]
        self.tools = self.tool_manager.get_openai_schemas() if self.tool_manager else []
        if self.mcp_manager:
            self.tools.extend(self.mcp_manager.get_openai_schemas())
        agent = agent_ctx.get()
        self.detect_tool_calls = True
        if agent and isinstance(agent, dict):
            self._agent_mode = True
            # Backup all available tools before filtering
            all_tools = list(self.tools)
            self.root_agent = next(iter(agent))
            self.current_agent_id = self.root_agent
            agent_node = agent.get(self.current_agent_id)
            if agent_node:
                # Add agent_query tool schema if children exist
                children = agent_node.get("children")
                is_programmatic = _parse_bool(agent_node.get("enableProgrammaticToolCalling"))
                allow_multiple = _parse_bool(agent_node.get("allowMultiple"))
                # Store state needed for _build_system_prompt() rebuilds
                self._agent_node = agent_node
                self._all_tools = all_tools
                self._allow_multiple = allow_multiple
                self._agent_children = children
                self._is_programmatic = is_programmatic
                if children:  
                    if allow_multiple:
                        self.tools.append({
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
                        self.tools.append({
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
                    all_tools.append(self.tools[-1])

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
                        logger.error(f"[Chat] error when try to get skill path: {e}")
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
                        lines.append(f"# Agent `{a_id}` ({a_node.get("name")})")
                    elif depth == 1:
                        lines.append(f"### `{a_id}` ({a_node.get("name")})")
                    else:
                        lines.append(f"##### `{a_id}` ({a_node.get("name")})")
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

                # Store helpers so _build_system_prompt() can call them after __init__
                self._get_skill_content = get_skill_content
                self._get_skill_info = get_skill_info
                self._format_agent = format_agent

                # Ensure agent_query is allowed if children exist
                allowed_tools = set(agent_node.get("tools", []))
                if children:
                    allowed_tools.add("agent_query")
                self._allowed_tools = allowed_tools

                # Filter self.tools for the root agent
                self.tools = [
                    t for t in self.tools
                    if t.get("function", {}).get("name") in allowed_tools
                ]

                logger.warning("Agent Node Information: %s", json.dumps(agent_node))

                self._build_system_prompt()
        
        self.logs = {}
        self.parser = Parser(detect_tool_calls=self.detect_tool_calls, detect_code_blocks=True)
        self._stream_start_time = 0.0
        self._stream_end_time = 0.0
        self._completion_tokens = 0
        self._prompt_tokens = 0
        self._costs = []
        self.r: Dict[str, Any] = {}
        self.content = ""
        self.tool_logs = []
        self._sync_lock = asyncio.Lock()
        self._last_sync_time = 0.0
        # Agent task planning state
        self._agent_tasks: List[str] = []    # tasks from create_tasks
        self._task_context_messages: List[Dict[str, str]] = []  # accumulated prior task messages
        self._current_task_idx: int = 0      # index into _agent_tasks
        self._original_query: str = ""          # Stores original user request before task planning
        self._synthesis_pending: bool = False   # Flag indicating synthesis should start
        self._synthesis_done: bool = False      # Flag indicating synthesis finished
        # Programmatic tool calling state
        # agent_node is only defined when the agent block above was entered;
        # use locals().get() to avoid a NameError when no agent is configured.
        _agent_node_local = locals().get("agent_node")
        self._programmatic_tool_calling: bool = bool(
            _agent_node_local and _parse_bool(_agent_node_local.get("enableProgrammaticToolCalling"))
        )
        # Result from the last run_code() call; injected as context on the next start()
        self._code_exec_result: Optional[Dict[str, Any]] = None
        # Think content is tracked separately and always rendered at the top.
        self._think_content: str = ""       # all completed think block text
        self._think_in_progress: bool = False
        # Ordered content segments (text / tool_call / code_block).
        self._content_segments: List[Dict] = []
        # Text that has been parsed by the parser but not yet flushed into a
        # segment.  Gets flushed whenever a tool_call or code_block finalises.
        self._pending_text: str = ""
        # How many chars of parser.parsed_buffer we have already consumed.
        self._consumed_parsed_len: int = 0
        # Counters for unique element IDs (reset in start()).
        self._tool_call_counter: int = 0
        self._code_block_counter: int = 0
        # Native (provider-level) tool calls that have already been written
        # to _content_segments so we don't duplicate them.
        self._serialized_native_tc_ids: set = set()
        # Native TCs whose args are complete but whose insertion is deferred
        # until content_delta stops flowing, so preceding text is fully flushed.
        self._queued_native_tcs: List[Dict] = []
        
    
    # Content helpers
    
    def _next_tool_id(self) -> str:
        tc_id = f"tc_{self._tool_call_counter}"
        self._tool_call_counter += 1
        return tc_id
    def _next_code_id(self) -> str:
        cb_id = f"cb_{self._code_block_counter}"
        self._code_block_counter += 1
        return cb_id
    def _flush_pending_text(self) -> None:
        """Move accumulated pending text into a text segment (if non-empty)."""
        if self._pending_text:
            self._content_segments.append(
                {"type": "text", "content": self._pending_text}
            )
            self._pending_text = ""
    def _render_tool_call_tag(self, tc_id: str, name: str) -> str:
        """Self-closing tool_call XML tag  always valid, never left open."""
        return (
            f'<ToolCall id="{tc_id}" name="{_escape_xml_attr(name)}"/>'
        )
    def _split_lang_code(self, buf: str):
        """Extract (lang, code) from a code_buffer whose first line is the language tag.
        The parser now stores the language as the first line of code_buffer."""
        first_nl = buf.find("\n")
        if first_nl != -1:
            first_line = buf[:first_nl].strip()
            if re.match(r"^[a-zA-Z0-9_+\-]+$", first_line):
                return first_line, buf[first_nl + 1:]
        return "", buf

    def _render_code_block_tag(self, cb_id: str, lang: str, code: str) -> str:
        """code_block wrapper  always closed even for in-progress content."""
        lang_tag = lang or ""
        return (
            f'<CodeBlock id="{cb_id}">\n'
            f"```{lang_tag}\n{code}\n```\n"
            f"</CodeBlock>"
        )
    def _build_content(
        self,
        *,
        is_parsing_think: bool = False,
        current_think_buf: str = "",
        is_parsing_code: bool = False,
        current_code_buf: str = "",
        code_lang: str = "",
        is_parsing_tool: bool = False,
    ) -> str:
        """
        Assemble the full rendered content string from current state.
        Structure:
          <Think>…</Think>          ← if any think content exists
          content 0
          <ToolCall id=… …/>
          content 1
          <CodeBlock id=…>…</CodeBlock>
          …
          [in-progress code block]  ← always closed
          [in-progress tool call]   ← placeholder, always closed
        """
        parts: List[str] = []
        think_text = self._think_content
        if is_parsing_think and current_think_buf:
            think_text = think_text + current_think_buf
        if think_text.strip():
            parts.append(f"<Think>\n{_escape_for_jsx(think_text)}\n</Think>\n")
        for seg in self._content_segments:
            t = seg["type"]
            if t == "text":
                parts.append(seg["content"])
            elif t == "tool_call":
                parts.append(
                    self._render_tool_call_tag(
                        seg["id"], seg["name"]
                    )
                )
            elif t == "code_block":
                parts.append(
                    self._render_code_block_tag(
                        seg["id"], seg.get("lang", ""), seg["code"]
                    )
                )
        if self._pending_text:
            parts.append(self._pending_text)
        if is_parsing_code and current_code_buf:
            cb_id = f"cb_{self._code_block_counter}"  # peek, don't increment
            _lang, _code = self._split_lang_code(current_code_buf)
            parts.append(self._render_code_block_tag(cb_id, _lang, _code))

        if is_parsing_tool:
            parts.append('<ToolCall id="pending" name="" parameters=""/>')
        # Show placeholders so the UI knows tool calls are coming, even
        # though they haven't been committed to _content_segments yet.
        for qtc in self._queued_native_tcs:
            parts.append(
                self._render_tool_call_tag(qtc["id"], qtc["name"])
            )
        return "\n".join(p for p in parts if p)
    
    # Delta extraction helpers
    
    def _consume_new_parsed_text(self) -> str:
        """
        Return only the *new* text that the parser has confirmed since the last
        call.  Uses parser.parsed_buffer (monotonically growing confirmed text)
        as the source of truth, so we never re-process the same chars.
        Think tags are stripped from the delta here and routed to
        _think_content / _think_in_progress instead.
        """
        raw_delta = self.parser.parsed_buffer[self._consumed_parsed_len:]
        self._consumed_parsed_len = len(self.parser.parsed_buffer)
        if not raw_delta:
            return ""
        completed_thinks = re.findall(
            r"<Think>(.*?)</Think>", raw_delta, flags=re.DOTALL
        )
        for think_text in completed_thinks:
            self._think_content += think_text
        clean_delta = re.sub(r"<Think>.*?</Think>", "", raw_delta, flags=re.DOTALL)
        # (The parser is still inside a think block  content tracked via
        # current_think_buf from the parser return value.)
        clean_delta = re.sub(r"<Think>[^<]*$", "", clean_delta)
        return clean_delta
    
    # Tool-call accumulation (unchanged logic, same as original)
    
    def _update_tool_calls(self, incoming: List[Any]) -> None:
        """Accumulates tool call deltas to maintain full state during streaming."""
        if not incoming:
            return
        if self.tool_calls is None:
            self.tool_calls = []
        for tc in incoming:
            idx = tc.get("index")
            if idx is not None:
                existing = next(
                    (x for x in self.tool_calls if x.get("index") == idx), None
                )
                if not existing:
                    self.tool_calls.append(copy.deepcopy(tc))
                else:
                    if "function" in tc:
                        f_inc = tc["function"]
                        f_ext = existing.setdefault("function", {})
                        if f_inc.get("name"):
                            f_ext["name"] = f_inc["name"]
                        if "arguments" in f_inc:
                            curr_args = f_ext.get("arguments", "")
                            if isinstance(curr_args, str):
                                f_ext["arguments"] = curr_args + (
                                    f_inc["arguments"] or ""
                                )
                            else:
                                f_ext["arguments"] = f_inc["arguments"]
            else:
                name = safe_get(tc, "function", "name")
                if name:
                    is_new = not any(
                        safe_get(e, "function", "name") == name
                        and safe_get(e, "function", "arguments")
                        == safe_get(tc, "function", "arguments")
                        for e in self.tool_calls
                    )
                    if is_new:
                        self.tool_calls.append(copy.deepcopy(tc))
    
    # Cost calculation
    def _calculate_costs(
        self,
        pricing: Optional[Dict[str, Any]],
        prompt_tokens: int,
        completion_tokens: int,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ):
        if not pricing:
            return []
        prompt_price = pricing.get("prompt", 0.0)
        if prompt_tokens and prompt_price:
            self._costs.append(
                {
                    "type": "input",
                    "description": f"Input tokens ({prompt_tokens})",
                    "cost": round(prompt_tokens * prompt_price, 10),
                }
            )
        completion_price = pricing.get("completion", 0.0)
        if completion_tokens and completion_price:
            self._costs.append(
                {
                    "type": "output",
                    "description": f"Output tokens ({completion_tokens})",
                    "cost": round(completion_tokens * completion_price, 10),
                }
            )
        cache_read_price = pricing.get("input_cache_read", 0.0)
        if cache_read_tokens and cache_read_price:
            self._costs.append(
                {
                    "type": "input",
                    "description": f"Cached input read ({cache_read_tokens})",
                    "cost": round(cache_read_tokens * cache_read_price, 10),
                }
            )
        cache_write_price = pricing.get("input_cache_write", 0.0)
        if cache_write_tokens and cache_write_price:
            self._costs.append(
                {
                    "type": "input",
                    "description": f"Cached input write ({cache_write_tokens})",
                    "cost": round(cache_write_tokens * cache_write_price, 10),
                }
            )
        return self._costs

    #  Agent system-prompt builder (callable from __init__ and after next_tasks) 
    def _build_system_prompt(self) -> None:
        """(Re-)build ``self.prompt`` and sync it into ``self.message_template``.

        Uses the state stored during ``__init__``:
        ``_agent_node``, ``_all_tools``, ``_allowed_tools``,
        ``_allow_multiple``, ``_agent_children``, ``_is_programmatic``.
        Safe to call again whenever ``self.current_agent_id`` or
        ``self.attempt`` changes (e.g. after ``next_tasks`` is found).
        """
        agent_node   = getattr(self, "_agent_node", None)
        all_tools    = getattr(self, "_all_tools", [])
        allowed_tools = getattr(self, "_allowed_tools", set())
        allow_multiple = getattr(self, "_allow_multiple", False)
        children     = getattr(self, "_agent_children", None)
        is_programmatic = getattr(self, "_is_programmatic", False)
        get_skill_content = getattr(self, "_get_skill_content", lambda p: "")
        get_skill_info    = getattr(self, "_get_skill_info",    lambda p: ("", ""))
        format_agent      = getattr(self, "_format_agent",      lambda a, n, d: "")

        if agent_node is None:
            return  # No agent context – nothing to build.

        if is_programmatic:
            self.detect_tool_calls = False

            # Recursive tree formatter (mirrors the old inline version)
            def format_node_code(a_id: str, a_node: dict, indent: str = "") -> str:
                skill_path = a_node.get("skillPath", "")
                _, skill_desc = get_skill_info(skill_path) if skill_path else ("", "No description available")
                node_children = a_node.get("children", {})
                tools = list(a_node.get("tools", []))
                
                if _parse_bool(a_node.get("enableProgrammaticToolCalling")):
                    tools.append("agent_query")

                tools_str = ", ".join(f'"{t}"' for t in sorted(tools))
                lines = [
                    f"{indent}Node(",
                    f"{indent}    branch_id=\"{a_id}\",",
                    f"{indent}    name=\"{a_node.get('name', a_id)}\",",
                    f"{indent}    skill=Skill(",
                    f"{indent}        path=\"{skill_path}\",",
                    f"{indent}        description=\"{skill_desc}\",",
                    f"{indent}    ),",
                    f"{indent}    available_tools=[{tools_str}],",
                    f"{indent}    module_path=\"{a_id}/main.py\",",
                    f"{indent}    module_name=\"{a_id.replace('-', '_')}\",",
                ]
                if node_children:
                    lines.append(f"{indent}    children=[")
                    for child_id, child_node in node_children.items():
                        lines.append(format_node_code(child_id, child_node, indent + "        ") + ",")
                    lines.append(f"{indent}    ],")
                lines.append(f"{indent})")
                return "\n".join(lines)

            import platform
            from datetime import datetime
            os_info  = f"{platform.system()} {platform.release()}"
            now_str  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            node_id  = self.current_agent_id if self.attempt > 0 else "root"
            tree_code = format_node_code(self.current_agent_id, agent_node, "        ") #pyrefly: ignore

            tool_defs: List[str] = []
            for t_name in sorted(allowed_tools):
                if t_name == "agent_query":
                    continue
                t_desc = "No description available"
                for t in all_tools:
                    if isinstance(t, dict) and t.get("function", {}).get("name") == t_name:
                        t_desc = t.get("function", {}).get("description") or "No description available"
                        break
                t_desc = t_desc.strip()
                tool_defs.append(
                    f"async def {t_name}(query: str) -> str:\n"
                    f"    \"\"\"\n"
                    f"    {t_desc}\n"
                    f"    \"\"\"\n"
                    f"    ..."
                )
            tools_code     = "\n\n".join(tool_defs)
            logger.info(f"[Chat] tools_code: {tools_code}")
            tools_list_str = ", ".join(f'"{t}"' for t in sorted(agent_node.get("tools", [])))
            skill_path = agent_node.get("skillPath", "")
            _, skill_desc = get_skill_info(skill_path) if skill_path else ("", "No description available")
            _env_header = (
                "## Environment\n"
                f"- OS Information: `{os_info}`\n"
                f"- Current Date & Time: `{now_str}`\n"
                f"- Current Node: `{node_id}`\n"
                f"- Current Python Version: `{sys.version.split()[0]}`\n"
            )
            _main_py_block = (
                "# ./main.py\n\n"
                "```python\n"
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
                    if allow_multiple and self.attempt > 0 else
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
                "    branch_id: str\n"
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
                'def get_node(branch_id: str) -> "Node":\n'
                '    """BFS search for a node by branch_id starting from the root tree."""\n'
                "    ...\n"
                "\n\n"
                'def get_children_node(node: Node, branch_id: str) -> "Node":\n'
                '    """Search for a children node by branch_id, only search in node->children, non-recursive."""\n'
                "    ...\n"
                "\n"
                + (
                    "# IMPORTANT !!!, read tree CAREFULLY before populating "
                    "`next_branches`\n" if allow_multiple and self.attempt > 0
                    else "`next_tasks` and `next_branch`\n" if (self.attempt == 0 or children)
                    else ""
                )
                + "\ntree = Node(\n"
                '    branch_id="root",\n'
                '    skill=Skill(\n'
                f'        path="{skill_path}",\n'
                f'        description="{skill_desc}",\n'
                '    ),\n'
                f'    available_tools=[{tools_list_str}],\n'
                '    module_path="root/main.py",\n'
                '    module_name="root",\n'
                '    children=[\n'
                f'{tree_code}\n'
                '    ],\n'
                ')\n'
                "```\n"
            )
            _agent_section = (
                f"You are the `{node_id}` agent. Implement the body of `execute(task: str)` inside `{node_id}/main.py`.\n"
                "Return **only** the code inside the function body — no signature line, no imports, no explanation, and wrapped it inside a ```python ... ``` block.\n"
                "\n"
                "Example of a CORRECT response (your response should look EXACTLY like this:\n"
                "```python\n"
                "try:\n"
                "    # your logic\n"
                + (
                    "    return ActionResult(result=res, next_branches=next_branches)\n"
                    if allow_multiple and self.attempt > 0 else
                    "    return ActionResult(result=res, next_tasks=next_tasks, next_branch=next_branch)\n"
                )
                + "except Exception as e:\n"
                '    return ActionResult(result={task: {"error": str(e)}})\n'
                "```\n"
                "\n"
                "The following are already available at call time:\n"
                "\n"
                "```python\n"
                "import subprocess\n"
                "import httpx\n"
                "import json\n"
                "import asyncio\n"
                "import re\n"
                "import datetime\n"
                "from main import ToolRegistry, ActionResult, get_node, get_children_node\n"
                "from typing import Any, Dict, List, Optional, Tuple, Union, Set\n"
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
                'def initial_task() -> str:\n'
                f'    """return initial task for {node_id}."""\n'
                "    ...\n"
                "\n"                
                "# Tools\n"
                + tools_code + "\n"
                "\n"
                "async def main() -> List[Dict[str, Any]]:\n"
                '    """\n'
                + f"    Entry-point coroutine: runs the {node_id} node on `initial_task`, fans out\n"
                "    to any follow-up branch tasks declared in the returned ActionResult, and returns\n"
                "    the collected list of all result payloads.\n"
                '    """\n'
                "    results: List[Dict[str, Any]] = []\n"
                + f'    node = get_node("{node_id}")\n'
                "    data: ActionResult = await node.execute(initial_task())\n"
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
                    if allow_multiple and self.attempt > 0 else
                    "    if data.next_branch and data.next_tasks:\n"
                    "        for task in data.next_tasks:\n"
                    "            queue.append((node, data.next_branch, task))\n"
                    "    while queue:\n"
                    "        parent_node, branch_id, task = queue.popleft()\n"
                    "        branch_node = get_children_node(parent_node, branch_id)\n"
                    "        branch_data: ActionResult = await branch_node.execute(task)\n"
                    "        results.append(branch_data.result)\n"
                    "        if branch_data.next_branch and branch_data.next_tasks:\n"
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
                "| `tool_registry` | `Dict[str, ToolRegistry]` | Maps tool name \u2192 `ToolRegistry`. The **key must exactly match** `function.name` in the schema. |\n"
                '| **Returns** | `Dict[str, Any]` | The `dict` returned by your `call` function (single tool call). Returns `{}` on any error. |\n'
                "\n"
                "> **`llm_tool` returns `{}` on every error** \u2014 no model, no tool calls produced, JSON parse failure, etc.\n"
                "> Always check `if not res:` before reading fields.\n"
                "\n---\n\n"
                "### Defining a `ToolRegistry`\n"
                "\n"
                "```python\n"
                '""""\n'
                "async def my_call(**kwargs) -> Dict[str, Any]:\n"
                '    value = kwargs.get("input_field", "") # Extract the input parameter sent by the LLM\n'
                "    # -- Process the value here (OPTIONAL) --\n"
                "    # Only add processing if you need to transform the value (string manipulation, validation, computation) with:\n"
                "    #   - Run a sub-task via another `llm_tool` (e.g. classification, rewriting)\n"
                f"    #  - Fetch external data with `await` ({tools_list_str})\n"
                "    # --\n"
                '    return {"output_field": processed_value or value}\n'
                '""""\n'
                "\n"
                "my_tool = ToolRegistry(\n"
                "    call=my_call,\n"
                "    schema={\n"
                '        "type": "function",\n'
                '        "function": {\n'
                '            "name": "my_tool",\n'
                '            "description": "...",\n'
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
                "- The `call` function **MUST return a `dict`** \u2014 `llm_tool` always returns `Dict[str, Any]`.\n"
                "- The `description` directly influences model quality; be explicit.\n"
                "- Fields listed in `required` are always filled by the model.\n"
                "\n---\n\n"
                "### Reading the Result\n"
                "\n"
                "`llm_tool` **always** returns a `dict`. The keys depend on what your `call` function returns:\n"
                "\n"
                "| `call` returns | `llm_tool` returns | How to read |\n"
                "|---|---|---|\n"
                "| `{\"tasks\": [...]}` | `{\"tasks\": [...]}` | `res.get(\"tasks\", [])` |\n"
                "| `[\"a\", \"b\"]` (list \u2014 **avoid this**) | `{\"result\": [\"a\", \"b\"]}` | `res.get(\"result\", [])` |\n"
                "\n"
                "> **Always return a plain `dict` from `call`.** Never return a list or string directly.\n"
                "\n---\n\n"
                "### Error Handling\n"
                "\n"
                "`llm_tool` returns `{}` on every internal failure.\n"
                "Always guard before reading any field:\n"
                "\n"
                "```python\n"
                'res = await llm_tool(query, tool_registry={"my_tool": my_tool})\n'
                "if not res:\n"
                '    raise RuntimeError("llm_tool returned empty \u2014 check model config and tool schema")\n'
                'value = res.get("field", default_value)\n'
                "```\n"
                "\n---\n\n"
                "## Behavior Requirements\n"
                "\n"
                +
                (
                    f"- You're the `root`, you **MUST** decompose `Current Task` and delegate task(s) to `{self.current_agent_id}` (at least one) "
                    if self.attempt == 0 else 
                    ""
                )
                +
                "- **ALWAYS** wrap it in triple backticks with 'python' language identifier.\n"
                "- When delegating `next_tasks` you **MUST** delegate to your child nodes, **DO NOT** delegate to yourself or other child nodes (look at **Entry-point coroutine** logic).\n"
                "- **NEVER** call `llm_tool` without `tool_registry`\n"   
                +
                (
                    f"- **NEVER** fill `next_branch` with `{node_id}` it **MUST** be your children."
                    if self.attempt == 0 and not allow_multiple else
                    f"- **NEVER** include `{node_id}` in `next_branches` it **MUST** be your children."
                )
                +
                "- `tool_registry` `call` function **MUST** be created with `async def my_tool(**kwargs) -> Dict[str, Any]` and **NEVER** use direct lambda functions.\n"
                "- `tool_registry` `call` function **MUST** return a plain `Dict[str, Any]`, **DO NOT** return `kwargs.get('value')`, list, string, or other type directly — use `{\"key\": value}` to wrap your data.\n"
                "- Use `llm_tool` to transform, summarize, analyze, classify, or structure output.\n"
                f"- Read `tree = Node(...)` carefully, identify `{node_id}` children's tools and skill before populating their ActionResult.\n"
                '- Wrap the **entire** body in `try/except`: on any exception, return `ActionResult(result={task: {"error": str(e)}})` \u2014 `execute()` must never raise.\n'
                + (
                    "- Return `ActionResult(result=result, next_tasks=next_tasks, next_branch=next_branch)`.\n"
                    if self.attempt == 0 or children else
                    "- Return `ActionResult(result=result, next_tasks=[], next_branch=None)`.\n"
                )
            )
            children_values = list(children.values()) if isinstance(children, dict) else children
            _available_branch = (
                f"# Available `next_branch`: \n{''.join(f"- {child['name']}\n" for child in children_values or [{"name": self.current_agent_id}])}"
                if self.attempt == 0 or children else 
                ""
            )

            self.prompt = (
                _env_header + "\n---\n\n"
                + _main_py_block + "\n---\n\n"
                + _agent_section + "\n---\n\n"
                + _llm_tool_docs + "\n---\n\n"
                + _available_branch + "\n---\n\n"
                + get_skill_content(agent_node.get("skillPath", ""))
            )
        else:
            raw_prompt = format_agent(self.current_agent_id, agent_node, 0)
            self.prompt = re.sub(r"\n{3,}", "\n\n", raw_prompt).strip()
            import platform
            from datetime import datetime
            
            os_info = f"{platform.system()} {platform.release()}"
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            children = agent_node.get("children")
            children_values = list(children.values()) if isinstance(children, dict) else children
            agent_tree_structure = object_to_text_tree(self.current_agent_id or "root", agent_node)
            logger.info(f"Agent Tree Structure: \n {agent_tree_structure}")
            self.prompt += (
                f"\n\n## Environment\n"
                f"- OS Information: {os_info}\n"
                f"- Current Date & Time: {now_str}\n"
                f"\n\n---\n\n"
                f"# Agents Tree Structure: \n ```text\n{agent_tree_structure}\n``` \n"
                f"\n\n---\n\n"
            )

            self.prompt += f"- Current Node: `{self.current_agent_id}` ({agent_node.get("name")})\n" if self.attempt > 0 else ""
            self.prompt += f"- Available Next `agent_id` (Your child nodes): `{[child['name'] for child in children_values]}`\n" if self.attempt > 0 and children else ""
            self.prompt += f"- **ALWAYS** check your child nodes and assign tasks to them when needed.\n"  if self.attempt > 0 and children else ""
            self.prompt += f"- **ALWAYS** respond in (1-5) sentences, ensure it's concise and **MUST** avoid long outputs.\n"  if self.attempt > 0 else ""
            
        self.message_template[0]["content"] = self.prompt
        logger.info("[%s] _build_system_prompt: rebuilt for node='%s' attempt=%d",
                    self.__class__.__name__, self.current_agent_id, self.attempt)

    #  Agent task-planning helpers 
    async def _build_initial_messages(self) -> None:
        """Build the initial message list from history and current query.
        Extracted so it can be reused when transitioning between agent tasks."""
        cleaned_history: List[Dict[str, str]] = []
        context = ""
        if self.tab_db and self.tb:
            tab_info = await self.tab_db.get("message_state")
            if isinstance(tab_info["context"], str):
                context = tab_info["context"]
        for turn in (self.history or []):
            if turn.get("role") == "assistant":
                cleaned_history.append({
                    "role": "assistant",
                    "content": _clean_assistant_content(turn.get("content", "")),
                })
            else:
                cleaned_history.append(turn)
        msg_template = copy.deepcopy(self.message_template)
        self.messages = (
            msg_template
            + cleaned_history
            + self._task_context_messages
            + [
                {
                    "role": "user",
                    "content": f"{context}{self.query}",
                }
            ]
        )

    async def _process_query(self, query: str) -> str:
        request: Dict[str, Any] = {"query": query}
        files = re.findall(r'\[file=(.*?)\]', query)
        async def analyze_text(**kwargs) -> Dict[str, Any]:
            query_val = kwargs.get("query")
            file_arg = kwargs.get("file")
            if not file_arg:
                return {"error": "No file path provided."}
            
            from pathlib import Path as StdPath
            file_path = StdPath(file_arg)
            if not file_path.is_absolute():
                project_root = os.getenv("OPENCHAD_PROJECT_DIR")
                if project_root and self.workspace:
                    if self.tab_id:
                        storage_dir = StdPath(project_root) / "Workspaces" / self.workspace / self.tab_id
                    else:
                        storage_dir = StdPath(project_root) / "Workspaces" / self.workspace
                    resolved_path = storage_dir / file_path
                    if resolved_path.exists():
                        file_path = resolved_path
                    else:
                        resolved_path_no_tab = StdPath(project_root) / "Workspaces" / self.workspace / file_path
                        if resolved_path_no_tab.exists():
                            file_path = resolved_path_no_tab
            
            if not file_path.exists():
                cwd_path = StdPath.cwd() / file_arg
                if cwd_path.exists():
                    file_path = cwd_path
                else:
                    return {"error": f"File not found: {file_arg}"}
            
            if file_path.is_dir():
                return {"error": f"Path is a directory: {file_arg}"}

            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                return {"error": f"Failed to read file: {str(e)}"}

            if not content.strip():
                return {
                    "file": file_arg,
                    "analysis": "File is empty.",
                    "status": "success"
                }

            file_len = len(content)
            chunk_size = 12000
            overlap = 2000
            max_chunks = 15
            
            if file_len > chunk_size:
                estimated_chunks = file_len / (chunk_size - overlap)
                if estimated_chunks > max_chunks:
                    chunk_size = int(file_len / max_chunks) + overlap
                    chunk_size = min(chunk_size, 60000)

            chunks = []
            start = 0
            while start < file_len:
                end = start + chunk_size
                chunks.append(content[start:end])
                start += chunk_size - overlap
                if start >= file_len:
                    break

            extracted_results = []
            
            async def extract_information(**kwargs_extract) -> Dict[str, Any]:
                info = kwargs_extract.get("information", "")
                extracted_results.append(info)
                return {"status": "extracted"}

            extract_registry = {
                "extract_information": ToolRegistry(
                    call=extract_information,
                    schema={
                        "type": "function",
                        "function": {
                            "name": "extract_information",
                            "description": "Extract relevant details, structure, code, or context from the file chunk that are needed to fulfill the user's request.",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "information": {
                                        "type": "string",
                                        "description": "Extracted key details, functions, code snippets, or context from this chunk that are relevant to the user request."
                                    }
                                },
                                "required": ["information"]
                            }
                        }
                    }
                )
            }

            chunk_tasks = []
            for i, chunk in enumerate(chunks):
                chunk_prompt = (
                    f"You are analyzing a chunk of the file: {file_path.name}\n"
                    f"Chunk {i + 1} of {len(chunks)}:\n"
                    f"```\n{chunk}\n```\n\n"
                    f"User request: {query_val}\n\n"
                    f"Extract all information, key functions, classes, definitions, or context "
                    f"from this chunk that is relevant to the user request. "
                    f"Call the extract_information tool with the extracted information."
                )
                chunk_tasks.append(
                    self.llm_tool(
                        query=chunk_prompt,
                        tool_registry=extract_registry
                    )
                )

            chunk_results = await asyncio.gather(*chunk_tasks, return_exceptions=True)
            for res in chunk_results:
                if isinstance(res, Exception):
                    logger.error(f"Chunk extraction error: {res}")

            # Combine the results
            combined_analysis = "\n\n".join([
                f"--- Chunk {idx + 1} Analysis ---\n{res}"
                for idx, res in enumerate(extracted_results)
                if res and res.strip()
            ])

            if not combined_analysis.strip():
                combined_analysis = f"No specific relevant information extracted from {file_path.name}. Here is the start of the file:\n{content[:2000]}"

            return {
                "file": file_arg,
                "analysis": combined_analysis,
                "status": "success"
            }

        analyses = await asyncio.gather(
            *[self.llm_tool(
                query=(
                    f"Please analyze the file located at: {file}\n"
                ),
                tool_registry={"analyze_text": ToolRegistry(call=analyze_text, schema={
                    "type": "function",
                    "function": {
                        "name": "analyze_text",
                        "description": "Read and analyze the content of a text file (), return structured relevant information.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Specific query or instruction on what to extract from the file"
                                },
                                "file": {
                                    "type": "string",
                                    "description": "The path of the file to analyze"
                                }
                            },
                            "required": ["query", "file"]
                        }
                    }
                })},
            ) for file in files],
            return_exceptions=True,
        )

        request["files_context"] = [
            {"file": file, "content": analysis}
            if not isinstance(analysis, Exception)
            else {"file": file, "error": str(analysis)}
            for file, analysis in zip(files, analyses)
        ]

        return json.dumps(request)

    async def _execute_create_tasks(self, query: str) -> List[str]:
        """Use LLM to break down a user query into sequential tasks.
        Returns a list of task strings.  Falls back to [query] on failure."""
        captured_tasks: List[str] = []

        async def _create_tasks_callback(**kwargs) -> Dict[str, Any]:
            tasks = kwargs.get("tasks", [])
            captured_tasks.extend(tasks)
            return {"tasks": tasks, "status": "created"}
        

        create_tasks_tool = ToolRegistry(
            call=_create_tasks_callback,
            schema={
                "type": "function",
                "function": {
                    "name": "create_tasks",
                    "description": (
                        "Decompose the user request into one or more discrete, actionable tasks "
                        "to be executed by sub-agents. Each task must be self-contained and "
                        "achievable independently. Use a single task when the request is atomic; "
                        "use multiple tasks when the request has sequential "
                        "subtasks with distinct scopes. Avoid vague tasks — each must specify "
                        "what to do, what to operate on, and the expected output or outcome."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "tasks": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "a clear task(s) to instruct the agent"
                            }
                        },
                        "required": ["tasks"]
                    }
                }
            }
        )

        
        old_agent = agent_ctx.get()
        agent_ctx.set(None)
        try:
            processed_query = await self._process_query(query)
            #  Cancel check before task creation LLM call 
            if self.cancel_event and self.cancel_event.is_set():
                logger.info("[%s] _execute_create_tasks: cancel_event already set – skipping", self.__class__.__name__)
                return []

            llm_task = asyncio.get_event_loop().create_task(
                self.llm_tool(
                    query=(
                        "Use `create_tasks` tool to analyze the following user request and decompose into task(s):"
                        f"{processed_query}"
                    ),
                    tool_registry={"create_tasks": create_tasks_tool},
                ),
                name=f"create_tasks_llm_tool_{id(self)}",
            )
            cancel_sentinel = None
            if self.cancel_event:
                cancel_sentinel = asyncio.get_event_loop().create_task(
                    self.cancel_event.wait(),
                    name=f"cancel_sentinel_create_tasks_{id(self)}",
                )
            try:
                if cancel_sentinel is not None:
                    done, _ = await asyncio.wait(
                        {llm_task, cancel_sentinel},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if cancel_sentinel in done:
                        logger.info("[%s] _execute_create_tasks: cancel_event fired during llm_tool – cancelling", self.__class__.__name__)
                        llm_task.cancel()
                        try:
                            await llm_task
                        except (asyncio.CancelledError, Exception):
                            pass
                        return []
                else:
                    await llm_task
            finally:
                if cancel_sentinel is not None and not cancel_sentinel.done():
                    cancel_sentinel.cancel()
                    try:
                        await cancel_sentinel
                    except (asyncio.CancelledError, Exception):
                        pass
        except Exception as e:
            logger.error(
                "[%s] _execute_create_tasks failed: %s",
                self.__class__.__name__, e,
            )
        finally:
            agent_ctx.set(old_agent)

        if captured_tasks:
            return captured_tasks
        # Fallback: if task planning failed, use the original query as a single task
        return [query]
    
    def _get_parent_branch_id(self) -> str:
        if self.tb:
            parts = self.tb.split("_")
            if len(parts) >= 3:
                return "_".join(parts[1:-1])
        return _sha256_short("0")



    async def _sync_message_to_db(self):
        if not self.tab_db or not self.tb or not self.branch_id:
            return
        
        async with self._sync_lock:
            now = time.time()
            elapsed = now - self._last_sync_time
            if elapsed < 0.25:
                await asyncio.sleep(0.25 - elapsed)
            self._last_sync_time = time.time()

            branch_data = self.r.get("content", {}).get(self.branch_id)
            if not branch_data:
                return
                
            parent_branch_id = self._get_parent_branch_id()
            try:
                msg_index = int(self.tb.rsplit("_", 1)[-1])
            except (ValueError, IndexError):
                msg_index = 0
                
            query = branch_data.get("query")
            # Suppress intermediate DB writes during agent sub-task processing.
            # Only write the final synthesis to the database messages table when self._synthesis_done is True.
            # if self.attempt == 0 and self._agent_mode:
            #     placeholder = _make_empty_model_output(self.model_name)
            #     placeholder["content"] = (
            #         '<Tasker>'
            #         '<Spinner />'
            #         '<span className="shiny-text">Creating tasks</span>'
            #         '</Tasker>'
            #     )
            #     responses = json.dumps([placeholder])
            # elif self._agent_tasks and not self._synthesis_done:
            #     placeholder = _make_empty_model_output(self.model_name)
            #     placeholder["content"] = (
            #         f'<Tasker>'
            #         f'<Spinner />'
            #         f'<span className="flex-1 shiny-text truncate">{self._escape_for_jsx(self._agent_tasks[self._current_task_idx])}</span>'
            #         f'</Tasker>'
            #     )
            #     responses = json.dumps([placeholder])
            # else:
            #     responses = json.dumps(branch_data.get("responses", []))
            responses = json.dumps(branch_data.get("responses", []))
            response_branch = int(branch_data.get("response_branch", 0))
            timestamp = int(time.time())
            
            await self.tab_db.execute(
                "messages",
                """
                INSERT OR REPLACE INTO {table} (
                    parent_branch_id,
                    child_branch_id,
                    msg_index,
                    query,
                    responses,
                    response_branch,
                    timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [parent_branch_id, self.branch_id, msg_index, query, responses, response_branch, timestamp]
            )
            
            selected_branch_index = int(self.r.get("branch", 0))
            await self.tab_db.execute(
                "conversation_branches",
                """
                INSERT OR REPLACE INTO {table} (        
                    parent_branch_id,
                    msg_index,
                    selected_branch_index
                ) VALUES (?, ?, ?)
                """,
                [parent_branch_id, msg_index, selected_branch_index]
            )

    async def get_history(self) -> List[Dict[str, Any]]:
        """Walk the recursive message chain from the DB using recursive CTE.
        Returns a list of {role, content} dicts in chronological order,
        up to (but not including) the current request being processed.
        Only the last MAX_HISTORY_TURNS exchanges are collected.
        """
        MAX_HISTORY_TURNS = 2
        result: List[Dict[str, str]] = []
        if not self.tb or not isinstance(self.tb, str):
            logger.error("[%s] get_history called without valid tb | self.tb=%s", self.__class__.__name__, self.tb)
            return []
        
        parent_id = self._get_parent_branch_id()
        logger.info("[%s] get_history starting | self.tb=%s parent_id=%s",
                    self.__class__.__name__, self.tb, parent_id)
        
        if not self.tab_db:
            logger.error("[%s] get_history called without valid tab_db | self.tab_db=%s", self.__class__.__name__, self.tab_db)
            return []
            
        sql = """
        WITH RECURSIVE chat_chain AS (
            SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp, 1 as depth
            FROM {table}
            WHERE child_branch_id = SUBSTR(?, 1, 32)
            
            UNION ALL
            
            SELECT m.parent_branch_id, m.child_branch_id, m.msg_index, m.query, m.responses, m.response_branch, m.timestamp, c.depth + 1
            FROM {table} m
            JOIN chat_chain c ON m.child_branch_id = SUBSTR(c.parent_branch_id, 1, 32)
            WHERE c.depth < ?
        )
        SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp 
        FROM chat_chain 
        ORDER BY msg_index ASC;
        """
        try:
            rows = await self.tab_db.query("messages", sql, [parent_id, MAX_HISTORY_TURNS])
            for row in rows:
                query = row.get("query")
                if not query:
                    continue
                
                # Add user query
                result.append({"role": "user", "content": query})
                
                # Add assistant response if exists
                res_str = row.get("responses")
                responses_list = []
                if res_str:
                    try:
                        responses_list = json.loads(res_str)
                    except Exception:
                        responses_list = []
                
                resp_idx = row.get("response_branch", 0)
                candidate = None
                if isinstance(responses_list, list) and 0 <= resp_idx < len(responses_list):
                    candidate = responses_list[resp_idx]
                elif isinstance(responses_list, dict):
                    candidate = responses_list.get(str(resp_idx))
                    
                response_text = None
                if candidate is not None:
                    text = _extract_content_from_response(candidate)
                    if isinstance(candidate, str) and not text:
                        text = candidate
                    if text and text.strip() and text.strip() != "<div></div>":
                        response_text = text
                        
                if response_text:
                    result.append({"role": "assistant", "content": _clean_assistant_content(response_text)})
        except Exception as e:
            logger.error("[%s] get_history SQL error: %s", self.__class__.__name__, e)
            
        logger.info("[%s] get_history complete | collected %d messages (last %d turns)", self.__class__.__name__, len(result) // 2, MAX_HISTORY_TURNS)
        return result
    async def setup(self) -> None:
        # --- Long-query guard ---------------------------------------------------
        # If the incoming query is too large to include verbatim in the message
        # context, spool it to a file and give the LLM a file-reference prompt.
        if self.query and len(self.query) > MAX_QUERY_CHARS:
            try:
                project_root = os.getenv("OPENCHAD_PROJECT_DIR")
                if project_root and self.workspace and self.tab_id:
                    from pathlib import Path as _Path
                    storage_dir = _Path(project_root, "Workspaces", self.workspace, self.tab_id)
                    storage_dir.mkdir(parents=True, exist_ok=True)
                    query_file = storage_dir / "query_input.txt"
                    query_file.write_text(self.query, encoding="utf-8")
                    abs_path = str(query_file.resolve())
                    logger.info(
                        "[%s] setup | query too long (%d chars) – spooled to %s",
                        self.__class__.__name__,
                        len(self.query),
                        abs_path,
                    )
                    self.query = (
                        f"The user's input is too long to include directly. \n"
                        f"Please use the relevant tools to read and analyze the file's full content, then create a task plan based on it.\n"
                        f"[file={abs_path}]"
                    )
                else:
                    logger.warning(
                        "[%s] setup | query too long but storage path unavailable; truncating",
                        self.__class__.__name__,
                    )
            except Exception as _e:
                logger.exception("[%s] setup | long-query spool failed: %s", self.__class__.__name__, _e)
        # --- End long-query guard -----------------------------------------------
        if not self.tab_db:
            raise RuntimeError("[setup] database (tab_db) is not configured or is None")
        # Ensure database tables exist
        try:
            await self.tab_db.execute(
                "messages",
                """
                CREATE TABLE IF NOT EXISTS {table} (
                    parent_branch_id TEXT NOT NULL,
                    child_branch_id TEXT NOT NULL PRIMARY KEY,
                    msg_index INTEGER NOT NULL,
                    query TEXT,
                    responses TEXT,
                    response_branch INTEGER DEFAULT 0,
                    timestamp INTEGER NOT NULL
                );
                """
            )
            await self.tab_db.execute(
                "messages",
                "CREATE INDEX IF NOT EXISTS idx_messages_parent ON {table} (parent_branch_id);"
            )
            await self.tab_db.execute(
                "conversation_branches",
                """
                CREATE TABLE IF NOT EXISTS {table} (
                    parent_branch_id TEXT NOT NULL,
                    msg_index INTEGER NOT NULL,
                    selected_branch_index INTEGER DEFAULT 0,
                    PRIMARY KEY (parent_branch_id, msg_index)
                );
                """
            )
        except Exception as e:
            logger.error("[%s] Failed to create tables: %s", self.__class__.__name__, e)
            
        try:
            if self.branch_id:
                rows = await self.tab_db.query(
                    "messages",
                    "SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp FROM {table} WHERE child_branch_id = ?",
                    [self.branch_id]
                )
                if rows and len(rows) > 0:
                    row = rows[0]
                    res_str = row.get("responses")
                    responses_list = []
                    if res_str:
                        try:
                            responses_list = json.loads(res_str)
                        except Exception:
                            responses_list = []
                    self.r = {
                        "branch": row.get("msg_index", 0),
                        "content": {
                            self.branch_id: {
                                "query": row.get("query"),
                                "responses": responses_list,
                                "response_branch": row.get("response_branch", 0),
                            }
                        }
                    }
        except Exception as e:
            logger.error("[%s] Failed to load existing record for branch %s: %s", self.__class__.__name__, self.branch_id, e)
            
        try:
            if not self.r or not isinstance(self.r, dict):
                self.r = {"branch": 0, "content": {}}
            if "content" in self.r and isinstance(self.r["content"], str):
                try:
                    self.r["content"] = json.loads(self.r["content"])
                except Exception:
                    self.r["content"] = {}
            if "content" not in self.r or not isinstance(self.r["content"], dict):
                self.r["content"] = {}
        except Exception as e:
            raise RuntimeError(
                f"[setup] STEP 2 - r structure check failed | r type={type(self.r)} r value={self.r!r}: {e}"
            ) from e
        try:
            if self.branch_id not in self.r["content"]:
                self.r["content"][self.branch_id] = {
                    "query": self.query,
                    "responses": [],
                    "response_branch": 0,
                }
            else:
                self.r["content"][self.branch_id]["query"] = self.query
        except Exception as e:
            raise RuntimeError(
                f"[setup] STEP 3 - branch_id init failed | content type={type(self.r['content'])} content value={self.r['content']!r}: {e}"
            ) from e
        try:
            self.history = await self.get_history()
            logger.info("[%s] !!!!HISTORY!!!!! | %s", self.__class__.__name__, str(self.history))
        except Exception as e:
            raise RuntimeError(f"[setup] STEP 4 - get_history failed: {e}") from e
        try:
            self.r["branch"] = int(self.index or 0)
            self.r["content"][self.branch_id]["response_branch"] = int(
                self.response_branch or 0
            )
        except Exception as e:
            raise RuntimeError(
                f"[setup] STEP 5 - branch assignment failed | branch_id={self.branch_id!r} content={self.r['content']!r}: {e}"
            ) from e
        try:
            responses = self.r["content"][self.branch_id].get("responses", [])
            target_res_branch = int(self.response_branch or 0)
            while len(responses) <= target_res_branch:
                responses.append(_make_empty_model_output(self.model_name))
            self.r["content"][self.branch_id]["responses"] = responses
        except Exception as e:
            raise RuntimeError(
                f"[setup] STEP 6 - responses padding failed | branch_id={self.branch_id!r}: {e}"
            ) from e
        idx: Optional[int] = None
        responses_len: int = 0
        try:
            idx = int(self.response_branch or 0)
            responses_len = len(responses) if 'responses' in locals() else 0
            self.r["content"][self.branch_id]["responses"][idx] = (
                _make_empty_model_output(self.model_name)
            )
            if target_res_branch < len(responses):
                existing_content = _extract_content_from_response(
                    responses[target_res_branch]
                )
                if existing_content and existing_content != "<div></div>":
                    self.content = existing_content
        except Exception as e:
            raise RuntimeError(
                f"[setup] STEP 7 - content extraction failed | idx={idx} responses len={responses_len}: {e}"
            ) from e
        try:
            if self.tab_db and self.tb:
                await self._sync_message_to_db()
        except Exception as e:
            raise RuntimeError(f"[setup] STEP 8 - _sync_message_to_db failed: {e}") from e
        logger.info(
            "[%s] setup complete | branch_id=%s history_len=%d",
            self.__class__.__name__,
            self.branch_id,
            len(self.history),
        )
    
    # process_chunk [core streaming handler]
    async def process_chunk(self, chunk, **kwargs) -> Any:
        if not isinstance(chunk, dict):
            return chunk
        idx = int(self.response_branch or 0)
        current_responses = self.r["content"][self.branch_id]["responses"]
        model_output = current_responses[idx]
        choices = chunk.get("choices", [{}])
        delta = choices[0].get("delta", {}) if choices else {}
        content_delta = delta.get("content", "")
        usage_this_chunk = chunk.get("usage")
        has_explicit_usage = isinstance(usage_this_chunk, dict)
        if has_explicit_usage:
            self._prompt_tokens = usage_this_chunk.get(
                "prompt_tokens", self._prompt_tokens
            )
            ct = usage_this_chunk.get("completion_tokens", 0)
            if ct > 0:
                self._completion_tokens = ct
        # Some providers (e.g. DeepSeek) stream reasoning separately.
        reasoning_delta = delta.get("reasoning_content") or delta.get("reasoning") or ""
        if reasoning_delta:
            self._think_content += reasoning_delta
            self._think_in_progress = True  # will be closed at stream end
        is_parsing_tool = False
        is_parsing_code = False
        current_code_buf = ""
        current_think_buf = ""
        if content_delta:
            try:
                if self._stream_start_time == 0.0:
                    self._stream_start_time = time.time()
                # Parser returns 9 values:
                #   parsed_snapshot      – full text snapshot (confirmed + pending)
                #   tool_calls           – tool calls completed THIS chunk
                #   code_blocks          – code blocks completed THIS chunk
                #   thinks               – think blocks completed THIS chunk
                #   is_parsing_tool      – bool: currently inside a tool call
                #   is_parsing_code      – bool: currently inside a code block
                #   is_parsing_think     – bool: currently inside a think block
                #   current_code_buf     – partial code content being buffered
                #   current_think_buf    – partial think content being buffered
                (
                    _parsed_snapshot,
                    tool_calls,
                    code_blocks_this_chunk,
                    thinks_this_chunk,
                    is_parsing_tool,
                    is_parsing_code,
                    is_parsing_think,
                    current_code_buf,
                    current_think_buf,
                ) = self.parser.process_chunk(content_delta)
                self._think_in_progress = is_parsing_think
                for think_text in thinks_this_chunk:
                    self._think_content += think_text
                new_text = self._consume_new_parsed_text()
                if new_text:
                    self._pending_text += new_text
                for cb in code_blocks_this_chunk:
                    # Detect language: first line of code_buffer is the lang tag
                    lang = ""
                    code = cb
                    first_nl = cb.find("\n")
                    if first_nl != -1:
                        first_line = cb[:first_nl].strip()
                        if re.match(r"^[a-zA-Z0-9_+\-]+$", first_line):
                            lang = first_line
                            code = cb[first_nl + 1:]
                    self._flush_pending_text()
                    cb_id = self._next_code_id()
                    self._content_segments.append(
                        {"type": "code_block", "id": cb_id, "lang": lang, "code": code}
                    )
                    self.logs.setdefault("code_blocks", []).append(cb)
                if tool_calls:
                    self._update_tool_calls(tool_calls)
                    for tc in tool_calls:
                        name = safe_get(tc, "function", "name", default="")
                        args = safe_get(tc, "function", "arguments", default={})
                        if isinstance(args, dict):
                            params_str = json.dumps(args)
                        elif isinstance(args, str):
                            params_str = args
                        else:
                            params_str = "{}"
                        self._flush_pending_text()
                        tc_id = self._next_tool_id()
                        self._content_segments.append(
                            {
                                "type": "tool_call",
                                "id": tc_id,
                                "name": name,
                                "parameters": params_str,
                            }
                        )
                self._stream_end_time = time.time()
                if not has_explicit_usage:
                    self._completion_tokens += 1
            except (KeyError, IndexError, TypeError) as e:
                logger.warning(
                    "[%s] accumulation skipped: %s", self.__class__.__name__, e
                )
        native_tcs = delta.get("tool_calls")
        if isinstance(native_tcs, list):
            self._update_tool_calls(native_tcs)
            for tc in self.tool_calls or []:
                tc_provider_id = tc.get("id") or safe_get(tc, "function", "name")
                if tc_provider_id in self._serialized_native_tc_ids:
                    continue
                name = safe_get(tc, "function", "name", default="")
                args = safe_get(tc, "function", "arguments", default="")
                # Only serialise once the arguments are valid JSON (complete)
                if isinstance(args, str):
                    if not args:
                        continue  # args not yet streamed, wait for more chunks
                    try:
                        json.loads(args)
                    except json.JSONDecodeError:
                        continue  # still streaming argument fragments
                elif not isinstance(args, dict):
                    continue  # unexpected type, skip
                params_str = (
                    json.dumps(args) if isinstance(args, dict) else (args or "{}")
                )
                self._serialized_native_tc_ids.add(tc_provider_id)
                seg_id = tc.get("id") or self._next_tool_id()
                self._queued_native_tcs.append(
                    {"id": seg_id, "name": name, "parameters": params_str}
                )

        rendered = self._build_content(
            is_parsing_think=self._think_in_progress,
            current_think_buf=current_think_buf,
            is_parsing_code=is_parsing_code,
            current_code_buf=current_code_buf,
            is_parsing_tool=is_parsing_tool,
        )

        # Fallback: never write an empty string to the DB
        model_output["content"] = f"{self._frontend_prefix}{rendered or "<div></div>"}"
        self.logs["content_segments_count"] = len(self._content_segments)
        self.logs["think_content_len"] = len(self._think_content)
        if self.tab_db and self.tb:
            await self._sync_message_to_db()
            if self.tab_id:
                await self.tab_db.sync(self.tab_id + "_log", self.logs)
        # Suppress streaming chunk to the frontend during sub-task execution
        if self._agent_tasks and not self._synthesis_pending and not self._synthesis_done:
            dummy_chunk = copy.deepcopy(chunk)
            if "choices" in dummy_chunk and isinstance(dummy_chunk["choices"], list) and len(dummy_chunk["choices"]) > 0:
                dummy_chunk["choices"][0]["delta"] = {"content": ""}
            return dummy_chunk
        return chunk
    
    async def finalize(self, **kwargs) -> Any:
        idx = int(self.response_branch or 0)
        total_len = 0
        try:
            model_output = self.r["content"][self.branch_id]["responses"][idx]
            if isinstance(model_output, dict):
                total_len = len(model_output.get("content", ""))
                elapsed = (
                    (self._stream_end_time - self._stream_start_time)
                    if self._stream_start_time
                    else 0
                )
                if elapsed > 0 and self._completion_tokens > 0:
                    model_output["token_per_second"] = int(
                        self._completion_tokens / elapsed
                    )
                model_output["costs"] = self._calculate_costs(
                    self.pricing,
                    self._prompt_tokens,
                    self._completion_tokens,
                )
                model_output["date"] = int(time.time())
            elif isinstance(model_output, str):
                total_len = len(model_output)
        except (KeyError, IndexError, TypeError):
            pass
        logger.info(
            "[%s] finalize | branch_id=%s response_branch=%s | total_length=%d",
            self.__class__.__name__,
            self.branch_id,
            self.response_branch,
            total_len,
        )
        # Flush any remaining parser output
        remaining_raw = self.parser.finalize()
        # Consume any leftover confirmed text
        leftover_text = self._consume_new_parsed_text()
        if leftover_text:
            self._pending_text += leftover_text
        # Close the think block if we were still inside one
        if self._think_in_progress and self.parser.think_buffer:
            self._think_content += self.parser.think_buffer
            self._think_in_progress = False
        # Close any in-progress code block
        if self.parser.in_code_block and self.parser.code_buffer:
            cb_id = self._next_code_id()
            self._flush_pending_text()
            _lang, _code = self._split_lang_code(self.parser.code_buffer)
            self._content_segments.append(
                {
                    "type": "code_block",
                    "id": cb_id,
                    "lang": _lang,
                    "code": _code,
                }
            )
        # Flush remaining pending text
        self._flush_pending_text()
        # Commit any native TCs that were queued but never drained
        # (edge case: stream ended while content_delta was still active).
        for qtc in self._queued_native_tcs:
            self._flush_pending_text()
            self._content_segments.append(
                {
                    "type": "tool_call",
                    "id": qtc["id"],
                    "name": qtc["name"],
                    "parameters": qtc["parameters"],
                }
            )
        self._queued_native_tcs = []
        # Final render (no more in-progress states)
        final_rendered = self._build_content()
        idx = int(self.response_branch or 0)
        try:
            model_output = self.r["content"][self.branch_id]["responses"][idx]
            if isinstance(model_output, dict) and final_rendered:
                model_output["content"] = final_rendered
        except (KeyError, IndexError, TypeError):
            pass

        if self.tab_db and self.tb:
            await self._sync_message_to_db()
        if remaining_raw or final_rendered:
            self.logs["final_content"] = final_rendered
            if self.tab_db and self.tab_id:
                await self.tab_db.sync(self.tab_id + "_log", self.logs)
        return remaining_raw or None
    
    # response [non-streaming path]
    async def response(self, res, **kwargs) -> Any:
        """Accumulate content and sync for non-streaming completions."""
        if isinstance(res, dict):
            choices = res.get("choices", [])
            if choices:
                msg_content = choices[0].get("message", {}).get("content", "")
                if msg_content:
                    idx = int(self.response_branch or 0)
                    try:
                        usage = res.get("usage", {})
                        if isinstance(usage, dict):
                            self._prompt_tokens = usage.get("prompt_tokens", 0)
                            self._completion_tokens = usage.get("completion_tokens", 0)
                        else:
                            self._prompt_tokens = (
                                getattr(usage, "prompt_tokens", 0) if usage else 0
                            )
                            self._completion_tokens = (
                                getattr(usage, "completion_tokens", 0) if usage else 0
                            )
                        model_output = _make_empty_model_output(self.model_name)
                        model_output["content"] = self.content + msg_content
                        self.last_response = msg_content
                        model_output["costs"] = self._calculate_costs(
                            self.pricing,
                            self._prompt_tokens,
                            self._completion_tokens,
                        )
                        model_output["date"] = int(time.time())
                        self.r["content"][self.branch_id]["responses"][idx] = (
                            model_output
                        )
                        logger.info(
                            "[%s] response | received full content (%d chars)",
                            self.__class__.__name__,
                            len(msg_content),
                        )
                    except (KeyError, IndexError, TypeError):
                        pass
        if self.tab_db and self.tb:
            await self._sync_message_to_db()
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(
                "[%s] response | branch_id=%s response_branch=%s | response=%s",
                self.__class__.__name__,
                self.branch_id,
                self.response_branch,
                _format_chunk(res),
            )
        # Suppress non-streaming response to the frontend during sub-task execution
        if self._agent_tasks and not self._synthesis_pending and not self._synthesis_done:
            dummy_res = copy.deepcopy(res)
            if isinstance(dummy_res, dict) and "choices" in dummy_res:
                choices = dummy_res.get("choices", [])
                if choices and isinstance(choices, list):
                    choices[0]["message"] = {"role": "assistant", "content": ""}
            return dummy_res
        return res
    
    # start [reset state for a new attempt]
    async def start(self, **kwargs) -> None:
        root_agent = getattr(self, "root_agent", None)
        logger.info(f"Root agent: {root_agent}")
        
        if root_agent and self.event_emitter and not hasattr(self, "_root_heartbeat_task"):
            import time
            await self.event_emitter.emit("agent_heartbeat", {
                "agent_id": root_agent,
                "timestamp": time.time()
            })
            async def send_root_heartbeats():
                try:
                    while True:
                        await asyncio.sleep(1.0)
                        if self.event_emitter:
                            await self.event_emitter.emit("agent_heartbeat", {
                                "agent_id": root_agent,
                                "timestamp": time.time()
                            })
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Error in root agent heartbeat task: {e}")
            self._root_heartbeat_task = asyncio.create_task(send_root_heartbeats())


        if not self.messages:
            # Build history context: clean think/tool tags from assistant turns
            await self._build_initial_messages()
            # Force task planning on first attempt when agent is set
            agent = agent_ctx.get()
            if agent and isinstance(agent, dict) and self.attempt == 0:
                self._original_query = self.query or ""
                self.tools.append({
                    "type": "function",
                    "function": {
                        "name": "create_tasks",
                        "description": (
                            "Analyze the user's intent and create a list of sequential "
                            "tasks. You MUST call this tool with the user's query to "
                            "plan the execution."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "The user's query to analyze and break into tasks"
                                }
                            },
                            "required": ["query"]
                        }
                    }
                })

                logger.info(
                    "[%s] start | attempt 0 agent mode – forcing create_tasks",
                    self.__class__.__name__,
                )
        elif self.tool_calls and isinstance(self.tool_calls, list):
            #  Intercept create_tasks for agent task planning 
            _ct_call = next(
                (tc for tc in self.tool_calls
                 if safe_get(tc, "function", "name") == "create_tasks"),
                None,
            )
            if _ct_call:
                args_val = safe_get(
                    _ct_call, "function", "arguments", default="{}"
                )
                if isinstance(args_val, dict):
                    p_args = args_val
                elif isinstance(args_val, str):
                    try:
                        p_args = json.loads(args_val)
                    except json.JSONDecodeError:
                        p_args = {}
                else:
                    p_args = {}
                query = p_args.get("query", self.query or "")

                # Remove create_tasks from tools so sub-tasks never see it
                self.tools = [
                    t for t in self.tools
                    if not (isinstance(t, dict) and t.get("function", {}).get("name") == "create_tasks")
                ]

                # Execute task planning via llm_tool
                tasks = await self._execute_create_tasks(query)
                self._agent_tasks = tasks
                self._current_task_idx = 0

                logger.info(
                    "[%s] create_tasks returned %d tasks: %s",
                    self.__class__.__name__,
                    len(tasks),
                    [t[:80] for t in tasks],
                )

                # Set up for first task execution
                self.query = self._agent_tasks[0]
                self.tool_calls = None
                self._task_context_messages = []
                self.messages = []

                # Rebuild messages with first task as the query
                await self._build_initial_messages()
            else:
                #  Normal tool-call processing 
                self.messages.append(
                    {
                        "role": "assistant",
                        "tool_calls": self.tool_calls,
                        "content": "",
                    }
                )
                self.tool_logs.append(copy.deepcopy(self.tool_calls))
                cancel_sentinel: Optional[asyncio.Task] = None
                if self.cancel_event:
                    cancel_sentinel = asyncio.get_event_loop().create_task(
                        self.cancel_event.wait(),
                        name=f"cancel_sentinel_{id(self)}",
                    )
                try:
                    for tool_call in self.tool_calls:
                        # Fast-path: already cancelled before we even start the next tool.
                        if self.cancel_event and self.cancel_event.is_set():
                            logger.info(
                                "[%s] start | cancelled before tool '%s'  aborting loop",
                                self.__class__.__name__,
                                safe_get(tool_call, "function", "name", default="?"),
                            )
                            break
                        name = safe_get(tool_call, "function", "name", default=None)
                        args_val = safe_get(tool_call, "function", "arguments", default="")
                        tool_result = None
                        if args_val and name:
                            if isinstance(args_val, dict):
                                p_args = args_val
                            elif isinstance(args_val, str):
                                try:
                                    p_args = json.loads(args_val)
                                except json.JSONDecodeError:
                                    p_args = None
                            else:
                                p_args = None
                            if isinstance(p_args, dict):
                                # Wrap the real tool call in a cancellable task.
                                if self.tool_manager:
                                    async def execute_tool(**kwargs) -> Dict[str, Any]:
                                        call_args = kwargs if kwargs else p_args
                                        if name == "agent_query":   
                                            agent = agent_ctx.get()
                                            schema = None
                                            agent_query = None
                                            results = []
                                            if agent and isinstance(agent, dict):
                                                current_agent_id = next(iter(agent))
                                                agent_node = agent.get(current_agent_id)
                                                if agent_node:
                                                    if agent_node.get("children"):  
                                                        if agent_node.get("allowMultiple", False):
                                                            schema = {
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
                                                            }
                                                        else:
                                                            schema = {
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
                                                            }
                                                        
                                                        if schema:
                                                            agent_query = ToolRegistry(call=execute_tool, schema=schema)
                                                        
                                                        queries = call_args.get("queries")
                                                        if not queries:
                                                            query_val = call_args.get("query") or call_args.get("tasks")
                                                            queries = [{"agent_id": call_args.get("agent_id"), "tasks": query_val}]
                                                        
                                                        async def run_agent_queries(q_item: dict) -> List[dict]:
                                                            sub_agent_id = q_item.get("agent_id")
                                                            sub_tasks = q_item.get("tasks") or q_item.get("query")
                                                            if not sub_agent_id or not sub_tasks:
                                                                return []
                                                            if isinstance(sub_tasks, str):
                                                                sub_tasks = [sub_tasks]
                                                            
                                                            agent_results = []
                                                            sub_agent_tree = agent_node.get("children", {}).get(sub_agent_id)
                                                            if sub_agent_tree:
                                                                old_agent = agent_ctx.get()
                                                                old_model = model_id_ctx.get()
                                                                old_fields = fields_ctx.get()
                                                                old_additional_args = additional_args_ctx.get()
                                                                
                                                                agent_ctx.set({sub_agent_id: sub_agent_tree})
                                                                sub_model = sub_agent_tree.get("model")
                                                                fields_ctx.set(json.loads(sub_agent_tree.get("toolValues", "{}")))
                                                                additional_args_ctx.set(json.loads(sub_agent_tree.get("additionalArgs", "{}")))
                                                                if sub_model:
                                                                    model_id_ctx.set(sub_model)
                                                                
                                                                try:
                                                                    for task in sub_tasks:
                                                                        #  Cancel check before each sub-task 
                                                                        if self.cancel_event and self.cancel_event.is_set():
                                                                            logger.info(
                                                                                "[%s] cancel_event set before agent_query sub-task '%s' – aborting",
                                                                                self.__class__.__name__, task,
                                                                            )
                                                                            break
                                                                        if agent_query:
                                                                            try:
                                                                                llm_task = asyncio.get_event_loop().create_task(
                                                                                    self.llm_tool(
                                                                                        history_id=sub_agent_id,
                                                                                        query=task, 
                                                                                        tool_registry={
                                                                                            'agent_query' : agent_query
                                                                                        }
                                                                                    ),
                                                                                    name=f"agent_query_llm_tool_{id(self)}",
                                                                                )
                                                                                cancel_sentinel = None
                                                                                if self.cancel_event:
                                                                                    cancel_sentinel = asyncio.get_event_loop().create_task(
                                                                                        self.cancel_event.wait(),
                                                                                        name=f"cancel_sentinel_aq_{id(self)}",
                                                                                    )
                                                                                try:
                                                                                    if cancel_sentinel is not None:
                                                                                        done, _ = await asyncio.wait(
                                                                                            {llm_task, cancel_sentinel},
                                                                                            return_when=asyncio.FIRST_COMPLETED,
                                                                                        )
                                                                                        if cancel_sentinel in done:
                                                                                            logger.info(
                                                                                                "[%s] agent_query: cancel_event fired – cancelling sub-task",
                                                                                                self.__class__.__name__,
                                                                                            )
                                                                                            llm_task.cancel()
                                                                                            try:
                                                                                                await llm_task
                                                                                            except (asyncio.CancelledError, Exception):
                                                                                                pass
                                                                                            break
                                                                                        ans = llm_task.result()
                                                                                    else:
                                                                                        ans = await llm_task
                                                                                finally:
                                                                                    if cancel_sentinel is not None and not cancel_sentinel.done():
                                                                                        cancel_sentinel.cancel()
                                                                                        try:
                                                                                            await cancel_sentinel
                                                                                        except (asyncio.CancelledError, Exception):
                                                                                            pass

                                                                                entry = {
                                                                                    "agent_id": sub_agent_id,
                                                                                    "response": ans
                                                                                }
                                                                                # Recursive fan-out check for programmatic child
                                                                                if isinstance(ans, dict) and ans.get("success") and ans.get("result") is not None:
                                                                                    child_action = _parse_action_result(ans["result"])
                                                                                    if child_action:
                                                                                        has_single = child_action.get("next_branch") and child_action.get("next_tasks")
                                                                                        has_multi  = bool(child_action.get("next_branches"))
                                                                                        if has_single or has_multi:
                                                                                            sub_results = await _fan_out_branch(self, child_action)
                                                                                            entry["sub_branch_results"] = sub_results
                                                                                logger.info(f"[agent result] {sub_agent_id}: \n {entry}")
                                                                                agent_results.append(entry)
 
                                                                            except Exception as e:
                                                                                logger.exception("Error executing sub-agent task: %s", task)
                                                                                logger.info(f"[agent result error]: \n {str(e)}")
                                                                                agent_results.append({
                                                                                    "agent_id": sub_agent_id,
                                                                                    "response": f"Error: {str(e)}"
                                                                                })
                                                                        else:
                                                                            logger.info(f"[agent result error]: Error: Agent query schema not found.")
                                                                            agent_results.append({
                                                                                "agent_id": sub_agent_id,
                                                                                "response": "Error: Agent query schema not found."
                                                                            })
                                                                finally:
                                                                    agent_ctx.set(old_agent)
                                                                    model_id_ctx.set(old_model)
                                                                    fields_ctx.set(old_fields)
                                                                    additional_args_ctx.set(old_additional_args)
                                                            else:
                                                                logger.info(f"[agent result error]: Error: Agent '{sub_agent_id}' not found.")
                                                                agent_results.append({
                                                                    "agent_id": sub_agent_id,
                                                                    "response": f"Error: Agent '{sub_agent_id}' not found."
                                                                })
                                                            return agent_results
                                                        
                                                        tasks_to_run = []
                                                        for q_item in queries:
                                                            tasks_to_run.append(
                                                                asyncio.create_task(run_agent_queries(q_item))
                                                            )
                                                        
                                                        if tasks_to_run:
                                                            grouped_results = await asyncio.gather(*tasks_to_run)
                                                            results = [res for agent_res in grouped_results for res in agent_res]
                                                            content_str = json.dumps(results)
                                                            if len(content_str) > 10000:
                                                                import os
                                                                from pathlib import Path

                                                                project_root = os.getenv("OPENCHAD_PROJECT_DIR")
                                                                if project_root and self.workspace:
                                                                    storage_path = Path(project_root, "Workspaces", self.workspace, ".agent", self.root_agent, current_agent_id)
                                                                    storage_path.mkdir(parents=True, exist_ok=True)
                                                                    logger.info(f"[Chat] Workspace storage path: {storage_path}")

                                                                    output_task_storage_file = storage_path / "output.txt"
                                                                    try:
                                                                        with open(output_task_storage_file, 'w', encoding='utf-8') as f:
                                                                            f.write(f"{content_str}\n")
                                                                            results = [{
                                                                                "agent_id": current_agent_id,
                                                                                "response": f"Task Output Too Long, check file {str(output_task_storage_file.resolve())}\n",
                                                                                "preview": f"{content_str[:512]}..." 
                                                                            }]
                                                                        logger.info(f"[Chat] Saved output to {output_task_storage_file}")
                                                                    except Exception as e:
                                                                        logger.exception("[Chat] Error writing task file: %s", e)
                                                        else:
                                                            results = []
                                                        
                                                        if "queries" in call_args:
                                                            return {"responses": results} if len(results) > 1 else results[0]
                                                        else:
                                                            return results[0] if results else {"error": "No query executed"}
                                            return {"error": "No query executed"}
                                        else: 
                                            return await self.tool_manager.execute_tool(name, **p_args)
                                        
                                    tool_task: asyncio.Task = asyncio.get_event_loop().create_task(
                                        execute_tool(),
                                        name=f"tool_{name}_{id(self)}",
                                    )
                                    try:
                                        if cancel_sentinel is not None:
                                            # Race: whichever finishes first wins.
                                            done, _ = await asyncio.wait(
                                                {tool_task, cancel_sentinel},
                                                return_when=asyncio.FIRST_COMPLETED,
                                            )
                                            if cancel_sentinel in done:
                                                # Stop was requested while the tool was in flight.
                                                logger.info(
                                                    "[%s] start | cancel_event fired during tool '%s'  cancelling task",
                                                    self.__class__.__name__,
                                                    name,
                                                )
                                                tool_task.cancel()
                                                try:
                                                    await tool_task
                                                except (asyncio.CancelledError, Exception):
                                                    pass
                                                break  # exit the tool loop
                                            # Tool finished normally  retrieve result.
                                            tool_result = tool_task.result()
                                        else:
                                            tool_result = await tool_task
                                    except asyncio.CancelledError:
                                        # The outer coroutine itself was cancelled.
                                        tool_task.cancel()
                                        raise
                                    except Exception as e:
                                        tool_result = str(e)
                                else:
                                    tool_result = "Tool manager is not available"
                        if tool_result:
                            self.messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call["id"],
                                    "content": json.dumps(tool_result),
                                }
                            )
                finally:
                    # Always clean up the sentinel so it never leaks.
                    if cancel_sentinel is not None and not cancel_sentinel.done():
                        cancel_sentinel.cancel()
                        try:
                            await cancel_sentinel
                        except (asyncio.CancelledError, Exception):
                            pass
                self.logs["messages"] = self.messages
        if getattr(self, '_code_deferred', False) and self._programmatic_tool_calling and len(self._content_segments) > 0:     
            logger.info(f"System message: \n{self.r["content"][self.branch_id]["responses"][self.response_branch]["content"]}")
            code = _extract_code_from_response(self.r["content"][self.branch_id]["responses"][self.response_branch]["content"])
            
            self.parser = Parser(detect_tool_calls=self.detect_tool_calls, detect_code_blocks=True)
            self._content_segments = []
            self._think_content = ""
            self._think_in_progress = False
            self.tool_calls = []
            self._serialized_native_tc_ids = set()
            self._queued_native_tcs = []
            self._pending_text = ""

            self.r["content"][self.branch_id]["responses"][self.response_branch]["content"] = ""

            if code and code.strip():
                logger.info(
                    "[%s] programmatic mode – running deferred code (%d chars)",
                    self.__class__.__name__,
                    len(code),
                )
                cancel_sentinel: Optional[asyncio.Task] = None
                if self.cancel_event:
                    cancel_sentinel = asyncio.get_event_loop().create_task(
                        self.cancel_event.wait(),
                        name=f"cancel_sentinel_run_code_{id(self)}",
                    )
                try:
                    if self.cancel_event and self.cancel_event.is_set():
                        logger.info(
                            "[%s] start | cancelled before deferred code execution",
                            self.__class__.__name__,
                        )
                        exec_result = {"output": "", "error": "Cancelled", "result": None, "success": False}
                    else:
                        run_code_task: asyncio.Task = asyncio.get_event_loop().create_task(
                            self.run_code(code, task=self.query or ""),
                            name=f"run_code_{id(self)}",
                        )
                        try:
                            if cancel_sentinel is not None:
                                done, _ = await asyncio.wait(
                                    {run_code_task, cancel_sentinel},
                                    return_when=asyncio.FIRST_COMPLETED,
                                )
                                if cancel_sentinel in done:
                                    logger.info(
                                        "[%s] start | cancel_event fired during run_code  cancelling task",
                                        self.__class__.__name__,
                                    )
                                    run_code_task.cancel()
                                    try:
                                        await run_code_task
                                    except (asyncio.CancelledError, Exception):
                                        pass
                                    exec_result = {"output": "", "error": "Cancelled", "result": None, "success": False}
                                else:
                                    exec_result = run_code_task.result()
                            else:
                                exec_result = await run_code_task
                        except asyncio.CancelledError:
                            run_code_task.cancel()
                            raise
                        except Exception as e:
                            exec_result = {"output": "", "error": str(e), "result": None, "success": False}
                finally:
                    if cancel_sentinel is not None and not cancel_sentinel.done():
                        cancel_sentinel.cancel()
                        try:
                            await cancel_sentinel
                        except (asyncio.CancelledError, Exception):
                            pass

                self._code_exec_result = exec_result
                self.logs["code_exec_deferred"] = {
                    "code": code,
                    "success": exec_result.get("success"),
                    "error": exec_result.get("error"),
                    "output": exec_result.get("output"),
                }

                if exec_result.get("success"):
                    logger.info(
                        "[%s] deferred code succeeded",
                        self.__class__.__name__,
                    )
                    action_result = _parse_action_result(exec_result.get("result"))
                    
                    is_attempt_0 = (self.attempt == 1)
                    if is_attempt_0:
                        next_tasks = action_result.get("next_tasks") if action_result else None
                        if next_tasks:
                            self._original_query = self.query or ""
                            
                            # Robustly parse next_tasks
                            cleaned_tasks = []
                            if isinstance(next_tasks, list):
                                for item in next_tasks:
                                    if item is not None:
                                        cleaned_tasks.append(str(item).strip())
                            elif isinstance(next_tasks, str) and next_tasks.strip():
                                cleaned_tasks.append(next_tasks.strip())
                            elif next_tasks:
                                cleaned_tasks.append(str(next_tasks).strip())
                            
                            # Filter out empty strings
                            cleaned_tasks = [t for t in cleaned_tasks if t]
                            
                            if cleaned_tasks:
                                self._agent_tasks = cleaned_tasks
                                self._current_task_idx = 0
                                logger.info(
                                    "[%s] programmatic mode – attempt 0: next_tasks parsed: %s",
                                    self.__class__.__name__,
                                    self._agent_tasks,
                                )
                                # Switch to the child agent context
                                next_branch = action_result.get("next_branch") if action_result else None
                                if next_branch:
                                    self.current_agent_id = next_branch
                                    # Rebuild _agent_node to point at the child
                                    parent_node = getattr(self, "_agent_node", {})
                                    child_node = (parent_node.get("children") or {}).get(next_branch)
                                    if child_node:
                                        self._agent_node = child_node
                                        self._allow_multiple = _parse_bool(child_node.get("allowMultiple"))
                                        self._agent_children = child_node.get("children")
                                        self._is_programmatic = _parse_bool(child_node.get("enableProgrammaticToolCalling"))
                                        self._programmatic_tool_calling = self._is_programmatic
                                        child_tools = set(child_node.get("tools", []))
                                        if self._agent_children:
                                            child_tools.add("agent_query")
                                        self._allowed_tools = child_tools
                                # Rebuild system prompt for the child agent
                                self._build_system_prompt()
                                # Set up message list for first task execution
                                self.query = self._agent_tasks[0]
                                self.tool_calls = None
                                self._task_context_messages = []
                                self.messages = []
                                await self._build_initial_messages()
                            else:
                                # when no valid next_tasks found, hard cancel it
                                logger.warning(
                                    "[%s] programmatic mode – attempt 0: no valid next_tasks found, performing hard cancel",
                                    self.__class__.__name__,
                                )
                                exec_result["success"] = False
                                exec_result["error"] = "Hard cancelled: no valid next_tasks found in attempt 0 result."
                                self._code_exec_result = exec_result
                                self._hard_cancelled = True
                                if self.set_continue:
                                    self.set_continue(False)
                                raise RuntimeError("Hard cancel: No valid next_tasks found in attempt 0 result")
                        else:
                            # when no next_tasks found, hard cancel it
                            logger.warning(
                                "[%s] programmatic mode – attempt 0: no next_tasks found, performing hard cancel",
                                self.__class__.__name__,
                            )
                            exec_result["success"] = False
                            exec_result["error"] = "Hard cancelled: no next_tasks found in attempt 0 result."
                            self._code_exec_result = exec_result
                            self._hard_cancelled = True
                            if self.set_continue:
                                self.set_continue(False)
                            raise RuntimeError("Hard cancel: No next_tasks found in attempt 0 result")
                    else:
                        if action_result:
                            has_branches = bool(
                                action_result.get("next_branches")
                                or (action_result.get("next_branch") and action_result.get("next_tasks"))
                            )
                            if has_branches:
                                # _fan_out_branch handles both next_branches and
                                # next_branch+next_tasks (and any mix of both).
                                if self.cancel_event and self.cancel_event.is_set():
                                    logger.info(
                                        "[%s] cancel_event set before fan-out – aborting",
                                        self.__class__.__name__,
                                    )
                                else:
                                    fan_results = await _fan_out_branch(self, action_result)
                                    if fan_results:
                                        exec_result["branch_results"] = fan_results  #pyrefly: ignore
                                        self._code_exec_result = exec_result
                else:
                    logger.warning(
                        "[%s] deferred code failed | performing hard cancel | error=%s",
                        self.__class__.__name__,
                        (exec_result.get("error") or "")[:300], #pyrefly: ignore
                    )
                    # self._hard_cancelled = True
                    # if self.set_continue:
                    #     self.set_continue(False)
                    # raise RuntimeError(f"Hard cancel: Code execution failed: {exec_result.get('error') or 'Unknown error'}")
            else:
                logger.info(
                    "[%s] deferred code: no extractable code in response",
                    self.__class__.__name__,
                )

        if self._programmatic_tool_calling:
            self.args["tools"] = []
            if self._code_exec_result is not None:
                result = self._code_exec_result
                if result.get("success"):
                    # Build plain-prose feedback
                    feedback_parts = ["Code executed successfully."]
                    exec_output = result.get("output") or ""
                    exec_return = result.get("result")
                    if exec_output:
                        feedback_parts.append(f"stdout:\n{exec_output}")
                    if exec_return is not None:
                        if hasattr(exec_return, "__dataclass_fields__"):
                            from dataclasses import asdict
                            try:
                                val_str = json.dumps(asdict(exec_return), default=str)
                            except Exception:
                                val_str = str(exec_return)
                        else:
                            val_str = json.dumps(exec_return, default=str)
                        feedback_parts.append(f"Return value: {val_str}")
                    branch_results = result.get("branch_results")
                    if branch_results:
                        def _format_branch_results(results: list, indent: str = "  ") -> None:
                            for br in results:
                                agent_id = br.get("agent_id", "unknown")
                                task = br.get("task", "")
                                if "error" in br:
                                    feedback_parts.append(
                                        f"{indent}- Agent '{agent_id}' on task '{task}': failed with error: {br['error']}"
                                    )
                                else:
                                    resp = br.get("response", "")
                                    if isinstance(resp, dict):
                                        resp_str = json.dumps(resp, default=str)
                                    else:
                                        resp_str = str(resp)
                                    feedback_parts.append(
                                        f"{indent}- Agent '{agent_id}' on task '{task}': {resp_str}"
                                    )
                                sub = br.get("sub_branch_results")
                                if sub:
                                    feedback_parts.append(f"{indent}  Sub-branch results:")
                                    _format_branch_results(sub, indent + "    ")
                        feedback_parts.append("Branch task results:")
                        _format_branch_results(branch_results)

                    feedback_msg = "\n".join(feedback_parts)
                else:
                    error = result.get("error") or "Unknown error"
                    feedback_msg = f"Code execution failed.\nError:\n{error}"
                logger.info("[%s] injecting code exec feedback: %s", self.__class__.__name__, feedback_msg)
                self.messages.append({"role": "assistant", "content": self.r["content"][self.branch_id]["responses"][-1]["content"]})
                self.messages.append({"role": "user", "content": feedback_msg})
                if self._task_context_messages and self._task_context_messages[-1]["role"] == "assistant":
                    self._task_context_messages[-1]["content"] = feedback_msg
                self._code_exec_result = None
        else:
            self.args["tools"] = self.tools

        if self._synthesis_pending and not self._synthesis_done and self._current_task_idx >= len(self._agent_tasks)-1:
            logger.info("[%s] Executing synthesis step...", self.__class__.__name__)
            synthesis_query = (
                f"Original user request: {self._original_query}\n\n"
                f"The following tasks were completed:\n\n{"\n-".join(self._agent_tasks)}\n\n"
                f"Result preview (5000 chars max): {json.dumps(self._task_context_messages)[:5000]}\n\n"
                "Synthesize all the above into a single, concise, well-organized response "
                "that directly answers the original user request."
            )
            self.messages = [
                {
                    "role": "system",
                    "content": "You are a helpful assistant that synthesizes task results into a single concise response."
                },
                {
                    "role": "user",
                    "content": synthesis_query
                }
            ]
            self.tools = []
            self.detect_tool_calls = False
            self.args["tools"] = []
            self._synthesis_done = True
            self._synthesis_pending = False
            
            self._think_in_progress = False
            self._pending_text = ""
            self._consumed_parsed_len = 0
            self._serialized_native_tc_ids = set()
            self._queued_native_tcs = []
            self._content_segments = []
            self._think_content = ""
            self.last_response = ""
            self.parser = Parser(detect_tool_calls=self.detect_tool_calls, detect_code_blocks=True)
            return


        self.tool_calls = None
        self.last_response = ""
        self._flush_pending_text()
        self._think_in_progress = False
        self._pending_text = ""
        self._consumed_parsed_len = 0 
        self._serialized_native_tc_ids = set() 
        self._queued_native_tcs = []
        self.parser = Parser(detect_tool_calls=self.detect_tool_calls, detect_code_blocks=True) # fresh parser for this attempt
        logger.info(
            "[%s] messages: %s tools: %s",
            self.__class__.__name__,
            json.dumps(self.messages),
            json.dumps(self.tools),
        )
    
    async def end(self, **kwargs) -> None:
        self.content += self.last_response
        is_continue = False
        self.logs["tools_called_" + str(self.attempt)] = json.dumps(self.tool_calls)
        if self.tool_calls:
            is_continue = True

        if self._programmatic_tool_calling and not self.tool_calls and not self._synthesis_done and not getattr(self, "_hard_cancelled", False):
            try:
                self._deferred_code_branch_idx = int(self.response_branch or 0)
            except (TypeError, ValueError):
                self._deferred_code_branch_idx = 0
            self._code_deferred = True
            logger.info(
                "[%s] programmatic mode – deferring code execution to start() (attempt %d)",
                self.__class__.__name__,
                self.attempt,
            )
            # Force one more iteration so start() gets called with the complete content.
            is_continue = True
        else:
            logger.info(
                "[%s] programmatic mode – no code to defer (tool_calls=%s synthesis_done=%s)",
                self.__class__.__name__,
                bool(self.tool_calls),
                self._synthesis_done,
            )

        #  Transition to next agent task if current task completed 

        if (
            not self.tool_calls
            and self._agent_tasks
            and self._current_task_idx + 1 < len(self._agent_tasks)
            and not (self._programmatic_tool_calling and self._code_exec_result and not self._code_exec_result.get("success"))
            and not getattr(self, "_hard_cancelled", False)
        ):
            if self._programmatic_tool_calling and self._code_exec_result is not None:
                _exec_r = self._code_exec_result
                if _exec_r.get("success"):
                    _fb = ["Code executed successfully."]
                    if _exec_r.get("output"):
                        _fb.append(f"stdout:\n{_exec_r['output']}")
                    if _exec_r.get("result") is not None:
                        try:
                            _fb.append(f"Return value: {json.dumps(_exec_r['result'], default=str)}")
                        except Exception:
                            _fb.append(f"Return value: {_exec_r['result']}")
                    _task_assistant_content = "\n".join(_fb)
                else:
                    _task_assistant_content = f"Code execution failed.\nError:\n{_exec_r.get('error') or 'Unknown error'}"
            else:
                _task_assistant_content = self.last_response or ""
                if not _task_assistant_content:
                    try:
                        idx = int(self.response_branch or 0)
                        _task_assistant_content = (
                            self.r["content"][self.branch_id]["responses"][idx].get("content", "")
                            or ""
                        )
                    except (KeyError, IndexError, TypeError):
                        pass
            self._task_context_messages.append({
                "role": "user",
                "content": self.query or "",
            })
            self._task_context_messages.append({
                "role": "assistant",
                "content": _clean_assistant_content(_task_assistant_content),
            })
            self._current_task_idx += 1
            self.query = self._agent_tasks[self._current_task_idx]
            self.messages = []  # will be rebuilt in start()
            is_continue = True
            logger.info(
                "[%s] transitioning to task %d/%d: %s",
                self.__class__.__name__,
                self._current_task_idx + 1,
                len(self._agent_tasks),
                str(self.query or "")[:100],
            )
        elif (
            not self.tool_calls
            and self._agent_tasks
            and self._current_task_idx + 1 >= len(self._agent_tasks)
            and not self._synthesis_done
            and not self._synthesis_pending
            and not (self._programmatic_tool_calling and self._code_exec_result and not self._code_exec_result.get("success"))
            and not getattr(self, "_hard_cancelled", False)
        ):
            # All tasks completed. Append the last task's response to task context messages.
            # In programmatic mode, prefer the actual code-execution output.
            if self._programmatic_tool_calling and self._code_exec_result is not None:
                _exec_r = self._code_exec_result
                if _exec_r.get("success"):
                    _fb = ["Code executed successfully."]
                    if _exec_r.get("output"):
                        _fb.append(f"stdout:\n{_exec_r['output']}")
                    if _exec_r.get("result") is not None:
                        try:
                            _fb.append(f"Return value: {json.dumps(_exec_r['result'], default=str)}")
                        except Exception:
                            _fb.append(f"Return value: {_exec_r['result']}")
                    _task_assistant_content = "\n".join(_fb)
                else:
                    _task_assistant_content = f"Code execution failed.\nError:\n{_exec_r.get('error') or 'Unknown error'}"
            else:
                _task_assistant_content = self.last_response or ""
                if not _task_assistant_content:
                    try:
                        idx = int(self.response_branch or 0)
                        _task_assistant_content = (
                            self.r["content"][self.branch_id]["responses"][idx].get("content", "")
                            or ""
                        )
                    except (KeyError, IndexError, TypeError):
                        pass
            self._task_context_messages.append({
                "role": "user",
                "content": self.query or "",
            })
            self._task_context_messages.append({
                "role": "assistant",
                "content": _clean_assistant_content(_task_assistant_content),
            })

            self._synthesis_pending = True
            self.query = self._original_query
            self.messages = []
            is_continue = True
            logger.info(
                "[%s] All agent tasks completed. Triggering synthesis phase.",
                self.__class__.__name__,
            )
        if self.set_continue:
            self.set_continue(is_continue)
        self.logs["output_" + str(self.attempt)] = self.last_response
        if self.tab_db and self.tab_id:
            await self.tab_db.sync(self.tab_id + "_log", self.logs)
        logger.warning(
            "[%s] !!!!LAST_RESPONSE!!!!! | %s",
            self.__class__.__name__,
            self.last_response,
        )
        logger.warning(
            "[%s] !!!!ATTEMPT!!!!! | %s", self.__class__.__name__, self.attempt
        )
        logger.info("[%s] end")
    
    # stop [end of response]
    async def stop(self, **kwargs) -> None:
        if hasattr(self, "_root_heartbeat_task") and self._root_heartbeat_task:
            self._root_heartbeat_task.cancel()
            try:
                await self._root_heartbeat_task
            except asyncio.CancelledError:
                pass
            delattr(self, "_root_heartbeat_task")

        idx = int(self.response_branch or 0)
        current_responses = self.r["content"][self.branch_id]["responses"]
        model_output = current_responses[idx]
        model_output["isStreaming"] = False
        if self.tab_db and self.tb:
            await self.tab_db.set("message_state", "isStreaming", False)
            await self.tab_db.set("message_state", "activeId", "")
            await self._sync_message_to_db()
            tab_info = await self.tab_db.get("message_state")
            if not isinstance(tab_info['title'], str):
                async def tool_func(**kwargs):
                    title = kwargs.get("title", None)
                    if title:
                        await self.tab_db.set("message_state", "title", title)
                    return {"result":"OK"}      
                update_title = ToolRegistry(call=tool_func, schema={
                    "type": "function",
                    "function": {
                        "name": "update_title",
                        "description": "Generate a title based on its content",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "title": {
                                    "type": "string",
                                    "description": "1-5 word title"
                                }
                            },
                            "required": ["title"]
                        }
                    }
                })
                query = (
                    "Generate a concise, 1-5 word title."
                    "### Guidelines:"
                    "- The title should clearly represent the main theme or subject of the conversation."
                    "- Write the title in the chat's primary language; default to English if multilingual."
                    "- Prioritize accuracy over excessive creativity; keep it clear and simple."
                    "- Ensure no conversational text, affirmations, or explanations precede"
                    "### Chat History:"
                    f"{json.dumps(self.r)}"
                            )
                try:
                    res = await self.llm_tool(query, tool_registry={"update_title": update_title})
                    logger.info(f"[{self.__class__.__name__}] Title: {json.dumps(res)}")
                except Exception as e:
                    logger.error(f"[{self.__class__.__name__}] Error calling LLM: {str(e)}")
        logger.info("[%s] !!!!FINAL_RESPONSE!!!! : %s", self.__class__.__name__, json.dumps(model_output))
        logger.info("[%s] !!!!END_STOP!!!!", self.__class__.__name__)
        logger.info("[%s] !!!!TARGET TABLE!!!!", self.tb)
        

        async def reset():
            self.parser = Parser(detect_tool_calls=self.detect_tool_calls, detect_code_blocks=True)
            self._content_segments = []
            self._think_content = ""
            self._think_in_progress = False
            self.tool_calls = []
            self._serialized_native_tc_ids = set()
            self._queued_native_tcs = []
            self._pending_text = ""
                                        
            idx = int(self.response_branch or 0)
            if "content" in self.r and self.branch_id in self.r["content"]:
                resps = self.r["content"][self.branch_id].get("responses", [])
                if idx < len(resps):
                    resps[idx]["content"] = "<div></div>"
                    resps[idx]["tool_calls"] = None
                    resps[idx]["raw_response"] = None
            
            # Sync cleared text to DB
            await self._sync_message_to_db()