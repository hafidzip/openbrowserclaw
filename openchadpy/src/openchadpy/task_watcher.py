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

async def reschedule_task(workspace_name: str, task_id: str, metadata: dict):
    """Log reschedule event and update task timestamp in the database."""
    interval = metadata.get("interval")
    logger.info(
        f"[Task Watcher] Task '{task_id}' in workspace '{workspace_name}' "
        f"is ready to reschedule (interval: {interval})"
    )

    from .sqlite import sqlite
    from .database_manager import trigger_table_update

    current_time_ms = int(time.time() * 1000)
    metadata["timestamp"] = current_time_ms

    try:
        await sqlite({
            "db": workspace_name,
            "command": "execute",
            "sql": "UPDATE tasks SET metadata = ? WHERE id = ?",
            "params": [json.dumps(metadata), task_id]
        })
        # Notify clients about task update
        await trigger_table_update(workspace_name, "tasks")
    except Exception as e:
        logger.error(
            f"[Task Watcher] Failed to update reschedule timestamp for task {task_id} in {workspace_name}: {e}",
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
                        if interval not in ("infinite", "1h", "1d", "1w"):
                            continue
                            
                        is_streaming = await check_is_streaming(workspace, task_id)
                        
                        is_due = False
                        if interval == "infinite":
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
                            await reschedule_task(workspace, task_id, metadata)
                                
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
