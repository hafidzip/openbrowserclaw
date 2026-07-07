from openchadpy.event_emitter import event_emitter
from openchadpy.event_emitter import EventEmitter
import asyncio
import os
import logging
import time
import json
from typing import Any, Dict
import aiosqlite

logger = logging.getLogger(__name__)

# Map interval string to duration in milliseconds
INTERVALS = {
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
}


def get_all_workspaces(project_root: str) -> list[str]:
    """Scan the Workspaces/ directory to discover workspace names."""
    workspaces_dir = os.path.join(project_root, "Workspaces")
    if not os.path.isdir(workspaces_dir):
        return []
    workspaces = []
    for name in os.listdir(workspaces_dir):
        dir_path = os.path.join(workspaces_dir, name)
        if os.path.isdir(dir_path):
            db_file = os.path.join(dir_path, f"{name}.db")
            if os.path.isfile(db_file):
                workspaces.append(name)
    return workspaces

async def check_is_streaming(workspace_name: str, task_id: str) -> bool:
    """Check if the task is currently streaming by querying its message state table."""
    from .sqlite import get_connection, hash_table
    init_tb = hash_table(task_id + "/" + "message_state")
    try:
        conn = await get_connection(workspace_name)
        async with conn.execute(f"SELECT _v FROM {init_tb} WHERE id = 'isStreaming'") as cursor:
            row = await cursor.fetchone()
            if row:
                val = row[0]
                if isinstance(val, str):
                    try:
                        return bool(json.loads(val))
                    except Exception:
                        return val.lower() == "true"
                return bool(val)
    except aiosqlite.OperationalError:
        # Table might not exist yet, which is fine
        pass
    except Exception as e:
        logger.error(f"[Task Watcher] Error checking isStreaming for task {task_id}: {e}")
    return False

async def reschedule_task(workspace_name: str, task_id: str, metadata: dict, settings_manager: Any):
    """Log reschedule event, initialize message state, and execute the task query."""
    interval = metadata.get("interval")
    query = metadata.get("query", "")
    logger.info(
        f"[Task Watcher] Rescheduling task '{task_id}' in workspace '{workspace_name}' "
        f"(interval: {interval}, query: '{query}')"
    )

    import hashlib
    from .sqlite import sqlite, hash_table, get_connection
    from .database_manager import trigger_table_update
    from .main import handle_pytauri_chat

    # 1. Compute deterministic branch and message details matching default-page.tsx
    root_parent = hashlib.sha256(b"0").hexdigest()[:32]
    next_parent_id = root_parent
    next_msg_index = 0

    messages_table = hash_table(task_id + "/messages")
    branches_table = hash_table(task_id + "/conversation_branches")

    try:
        conn = await get_connection(workspace_name)
        async with conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [messages_table]
        ) as cursor:
            table_exists = await cursor.fetchone()

        if table_exists:
            find_leaf_sql = f"""
              WITH SiblingNumbered AS (
                  SELECT 
                      parent_branch_id, 
                      child_branch_id, 
                      msg_index, 
                      ROW_NUMBER() OVER (PARTITION BY parent_branch_id ORDER BY timestamp ASC) - 1 AS sibling_idx
                  FROM {messages_table}
              ),
              ActiveChain AS (
                  SELECT 
                      s.parent_branch_id, 
                      s.child_branch_id, 
                      s.msg_index,
                      s.sibling_idx
                  FROM SiblingNumbered s
                  LEFT JOIN {branches_table} b 
                    ON s.parent_branch_id = b.parent_branch_id AND s.msg_index = b.msg_index
                  WHERE (s.parent_branch_id = ? OR s.parent_branch_id = ? || '_0')
                    AND s.sibling_idx = COALESCE(b.selected_branch_index, 0)

                  UNION ALL

                  SELECT 
                      s.parent_branch_id, 
                      s.child_branch_id, 
                      s.msg_index,
                      s.sibling_idx
                  FROM SiblingNumbered s
                  JOIN ActiveChain a ON s.parent_branch_id = (a.child_branch_id || '_' || a.sibling_idx)
                  LEFT JOIN {branches_table} b 
                    ON s.parent_branch_id = b.parent_branch_id AND s.msg_index = b.msg_index
                  WHERE s.sibling_idx = COALESCE(b.selected_branch_index, 0)
              )
              SELECT child_branch_id, msg_index FROM ActiveChain ORDER BY msg_index DESC LIMIT 1;
            """
            async with conn.execute(find_leaf_sql, [root_parent, root_parent]) as cursor:
                row = await cursor.fetchone()
                if row:
                    next_parent_id = row[0]
                    next_msg_index = int(row[1]) + 1
    except Exception as e:
        logger.error(f"[Task Watcher] Error finding active leaf for task {task_id}: {e}", exc_info=True)

    parent_branch_id = next_parent_id + "_0"
    branch_id = hashlib.sha256(parent_branch_id.encode('utf-8')).hexdigest()[:32]
    branch_index = 0
    tb_raw = f"tb_{next_parent_id}_0_{next_msg_index}"
    active_id = f"{task_id}_response_{branch_id}_0_{branch_index}"

    if interval == "once":
        metadata["interval"] = "disabled"
        await event_emitter.emit("task_disabled", {"workspace": workspace_name, "task_id": task_id})

    current_time_ms = int(time.time() * 1000)
    metadata["timestamp"] = current_time_ms

    try:
        # 2. Update task metadata timestamp in DB to shift scheduled time
        await sqlite({
            "db": workspace_name,
            "command": "execute",
            "sql": "UPDATE tasks SET metadata = ? WHERE id = ?",
            "params": [json.dumps(metadata), task_id]
        })
        await trigger_table_update(workspace_name, "tasks")

        # 3. Setup initial message state with isStreaming=True
        init_tb = hash_table(task_id + "/message_state")
        initial_value = {
            "title": {"_v": task_id},
            "activeId": {"_v": active_id},
            "errorMsg": {"_v": ""},
            "initialized": {"_v": True},
            "isStreaming": {"_v": True},
            "context": {"_v": ""},
            "dontStop": {"_v": True},
            "isRead": {"_v": False},
        }
        await sqlite({
            "db": workspace_name,
            "table": init_tb,
            "command": "sync_table",
            "data": initial_value
        })
        await trigger_table_update(workspace_name, init_tb)

        # 4. Fetch pipeline setting
        pipeline_val = await settings_manager.get("Others/app_settings/string.pipeline")
        pipeline = pipeline_val if pipeline_val else "openchad/chat"

        # 5. Build request body for background completions execution
        request_body = {
            "id": active_id,
            "query": query,
            "stream": True,
            "agent": metadata.get("agent"),
            "tab_id": task_id,
            "branch_id": branch_id,
            "index": branch_index,
            "response_branch": 0,
            "tb": tb_raw,
            "workspace": workspace_name,
            "app_name": "",
            "pipeline": pipeline
        }

        # 6. Trigger execution in background task (stream lifecycle handles setting isStreaming to false on completion/error)
        asyncio.create_task(handle_pytauri_chat(active_id, request_body))

    except Exception as e:
        logger.error(
            f"[Task Watcher] Failed to reschedule task {task_id} in {workspace_name}: {e}",
            exc_info=True
        )

async def start_task_watcher(project_root: str, settings_manager: Any):
    """Start the task watcher background polling loop (polls every 5 seconds)."""
    logger.info("[Task Watcher] Starting task watcher background service...")
    
    while True:
        try:
            workspaces = get_all_workspaces(project_root)
            current_time_ms = int(time.time() * 1000)
            
            for workspace in workspaces:
                from .sqlite import get_connection
                try:
                    conn = await get_connection(workspace)
                    async with conn.execute("SELECT id, metadata FROM tasks") as cursor:
                        rows = await cursor.fetchall()
                        
                    for row in rows:
                        task_id = row["id"]
                        metadata_str = row["metadata"]
                        
                        try:
                            metadata = json.loads(metadata_str)
                        except Exception:
                            continue
                            
                        interval = metadata.get("interval")
                        if interval not in ("once", "infinite", "1h", "1d", "1w"):
                            continue
                            
                        is_streaming = await check_is_streaming(workspace, task_id)
                        
                        is_due = False
                        if interval == "once":
                            is_due = not is_streaming
                        elif interval == "infinite":
                            is_due = not is_streaming
                        else:
                            timestamp = metadata.get("timestamp")
                            if timestamp is None:
                                is_due = not is_streaming
                            else:
                                try:
                                    timestamp = int(timestamp)
                                except (ValueError, TypeError):
                                    timestamp = 0
                                    
                                interval_ms = INTERVALS.get(interval)
                                if interval_ms is not None:
                                    elapsed_ms = current_time_ms - timestamp
                                    is_due = (elapsed_ms >= interval_ms) and not is_streaming
                        
                        if is_due:
                            await reschedule_task(workspace, task_id, metadata, settings_manager)
                                
                except aiosqlite.OperationalError as e:
                    if "no such table" in str(e).lower():
                        # The tasks table doesn't exist yet in this workspace
                        pass
                    else:
                        logger.error(f"[Task Watcher] SQLite error in workspace {workspace}: {e}")
                except Exception as e:
                    logger.error(f"[Task Watcher] Error checking tasks in workspace {workspace}: {e}")
                    
        except Exception as e:
            logger.error(f"[Task Watcher] Error in watcher loop: {e}", exc_info=True)
            
        await asyncio.sleep(5)
