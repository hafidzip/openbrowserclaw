import os
import logging
import struct
import json
import asyncio
from watchfiles import awatch
from pathlib import Path
from typing import List, Dict, Any, Optional
from openchadpy.base_provider import BaseModelProvider
logger = logging.getLogger(__name__)

def get_gguf_metadata(path: str) -> Dict[str, Any]:
    """
    Read metadata from a GGUF file without loading the model.
    """
    if not os.path.exists(path):
        return {}
    metadata = {}
    GGUF_TYPE_UINT8 = 0
    GGUF_TYPE_INT8 = 1
    GGUF_TYPE_UINT16 = 2
    GGUF_TYPE_INT16 = 3
    GGUF_TYPE_UINT32 = 4
    GGUF_TYPE_INT32 = 5
    GGUF_TYPE_FLOAT32 = 6
    GGUF_TYPE_BOOL = 7
    GGUF_TYPE_STRING = 8
    GGUF_TYPE_ARRAY = 9
    GGUF_TYPE_UINT64 = 10
    GGUF_TYPE_INT64 = 11
    GGUF_TYPE_FLOAT64 = 12
    def _read_string(f):
        length = struct.unpack("<Q", f.read(8))[0]
        return f.read(length).decode("utf-8", errors="ignore")
    def _read_value(f, val_type):
        if val_type == GGUF_TYPE_UINT8: return struct.unpack("<B", f.read(1))[0]
        if val_type == GGUF_TYPE_INT8: return struct.unpack("<b", f.read(1))[0]
        if val_type == GGUF_TYPE_UINT16: return struct.unpack("<H", f.read(2))[0]
        if val_type == GGUF_TYPE_INT16: return struct.unpack("<h", f.read(2))[0]
        if val_type == GGUF_TYPE_UINT32: return struct.unpack("<I", f.read(4))[0]
        if val_type == GGUF_TYPE_INT32: return struct.unpack("<i", f.read(4))[0]
        if val_type == GGUF_TYPE_FLOAT32: return struct.unpack("<f", f.read(4))[0]
        if val_type == GGUF_TYPE_BOOL: return struct.unpack("<?", f.read(1))[0]
        if val_type == GGUF_TYPE_STRING: return _read_string(f)
        if val_type == GGUF_TYPE_UINT64: return struct.unpack("<Q", f.read(8))[0]
        if val_type == GGUF_TYPE_INT64: return struct.unpack("<q", f.read(8))[0]
        if val_type == GGUF_TYPE_FLOAT64: return struct.unpack("<d", f.read(8))[0]
        if val_type == GGUF_TYPE_ARRAY:
            item_type = struct.unpack("<I", f.read(4))[0]
            count = struct.unpack("<Q", f.read(8))[0]
            type_sizes = {
                GGUF_TYPE_UINT8: 1, GGUF_TYPE_INT8: 1, GGUF_TYPE_BOOL: 1,
                GGUF_TYPE_UINT16: 2, GGUF_TYPE_INT16: 2,
                GGUF_TYPE_UINT32: 4, GGUF_TYPE_INT32: 4, GGUF_TYPE_FLOAT32: 4,
                GGUF_TYPE_UINT64: 8, GGUF_TYPE_INT64: 8, GGUF_TYPE_FLOAT64: 8,
            }
            if item_type in type_sizes:
                f.seek(count * type_sizes[item_type], 1)
            elif item_type == GGUF_TYPE_STRING:
                for _ in range(count):
                    _read_string(f)
            return None
        return None
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic != b"GGUF":
                return {}
            version = struct.unpack("<I", f.read(4))[0]
            f.read(8)
            kv_count = struct.unpack("<Q", f.read(8))[0]
            for _ in range(kv_count):
                key = _read_string(f)
                val_type = struct.unpack("<I", f.read(4))[0]
                value = _read_value(f, val_type)
                metadata[key] = value
                if "general.name" in metadata and "general.basename" in metadata:
                    break
    except Exception as e:
        print(f"Error reading GGUF metadata: {e}")
    return metadata
class LocalModelProvider(BaseModelProvider):
    """
    Scans local Models directory for available models, and/or resolves
    explicit file paths from settings key `openchad/LocalModelProvider/local.model`.
    Both sources are always scanned and merged. Configured paths win on ID
    collision, allowing explicit entries to override directory-scanned ones.
    mmproj- prefixed files are treated as the multimodal projector for a
    paired model and are NOT emitted as standalone entries; instead their
    path is attached to the paired model via `mmproj_path`.
    """
    provider_id = "openchad/local"
    _dep_cache: Dict[str, bool] = {}  # Class-level cache for dependency checks
    _SETTINGS_KEY = "openchad/LocalModelProvider/local.model"
    _MMPROJ_PREFIX = "mmproj-"
    def __init__(self):
        self.project_root = Path(os.environ.get("OPENCHAD_PROJECT_DIR", Path(__file__).parent.parent.parent.parent.resolve()))
        self.models_dir = self.project_root / "Models"
        self._cache_dir = self.project_root / ".cache"
        self._cache_file = self._cache_dir / "local_model_metadata.json"
        self._metadata_cache: Dict[str, Dict[str, Any]] = {}
        self._load_cache()
        self._watcher_task: Optional[asyncio.Task] = None
        self._subscribed = False
        self.on_change = None

    # Settings subscription
    async def _on_setting_changed(self, key: str):
        """Callback fired when any watched settings key changes."""
        if key == self._SETTINGS_KEY:
            logger.info("LocalModelProvider settings changed, triggering rescan")
            if self.on_change:
                try:
                    if asyncio.iscoroutinefunction(self.on_change):
                        await self.on_change()
                    else:
                        self.on_change()
                except Exception as e:
                    logger.error(f"Error in LocalModelProvider on_change callback: {e}")
    
    # Metadata cache helpers
    def _load_cache(self):
        try:
            if self._cache_file.exists():
                with open(self._cache_file, 'r', encoding='utf-8') as f:
                    self._metadata_cache = json.load(f)
                logger.debug(f"Loaded {len(self._metadata_cache)} cached model entries")
        except Exception as e:
            logger.warning(f"Failed to load metadata cache: {e}")
            self._metadata_cache = {}
    def _save_cache(self):
        try:
            self._cache_dir.mkdir(parents=True, exist_ok=True)
            with open(self._cache_file, 'w', encoding='utf-8') as f:
                json.dump(self._metadata_cache, f, indent=2)
            logger.debug(f"Saved {len(self._metadata_cache)} cached model entries")
        except Exception as e:
            logger.warning(f"Failed to save metadata cache: {e}")
    def _get_cached_metadata(self, model_file: Path) -> Dict[str, Any]:
        file_path = str(model_file)
        try:
            mtime = model_file.stat().st_mtime
        except OSError:
            return {}
        cached = self._metadata_cache.get(file_path)
        if cached and cached.get("_mtime") == mtime:
            return {k: v for k, v in cached.items() if not k.startswith("_")}
        metadata = get_gguf_metadata(file_path)
        self._metadata_cache[file_path] = {**metadata, "_mtime": mtime}
        return metadata
    
    # mmproj pairing
    @staticmethod
    def _is_mmproj(filename: str) -> bool:
        return filename.startswith(LocalModelProvider._MMPROJ_PREFIX)
    @staticmethod
    def _find_mmproj_for(model_file: Path, mmproj_files: List[Path]) -> Optional[Path]:
        """
        Pair a main model file with its mmproj counterpart.
        Matching priority (all candidates must live in the same directory):
          1. Exact stem match after stripping the mmproj- prefix
             e.g.  mmproj-llava-7b-f16.gguf  ↔  llava-7b-f16.gguf
          2. The mmproj stem (minus prefix) is a substring of the model stem
             e.g.  mmproj-llava-7b-f16.gguf  ↔  llava-7b-q4_k_m.gguf
          3. Fallback: if exactly one mmproj exists in the directory, use it.
        """
        same_dir = [p for p in mmproj_files if p.parent == model_file.parent]
        if not same_dir:
            return None
        model_stem = model_file.stem.lower()
        # Priority 1 – exact stem match
        for mp in same_dir:
            mp_stem = mp.stem[len(LocalModelProvider._MMPROJ_PREFIX):].lower()
            if mp_stem == model_stem:
                return mp
        # Priority 2 – substring match
        for mp in same_dir:
            mp_stem = mp.stem[len(LocalModelProvider._MMPROJ_PREFIX):].lower()
            if mp_stem and mp_stem in model_stem:
                return mp
        # Priority 3 – sole mmproj in directory
        if len(same_dir) == 1:
            return same_dir[0]
        return None
    
    # Public scan
    async def scan(self) -> List[Dict[str, Any]]:
        """
        Resolve models from both sources and merge:
          1. Models/ directory tree (always scanned)
          2. Settings key `openchad/LocalModelProvider/local.model` (string[])
        Configured paths win on ID collision, allowing explicit entries to
        override directory-scanned ones.
        """
        # Subscribe to settings changes once
        if self.settings_manager and not self._subscribed:
            self.settings_manager.subscribe(self._on_setting_changed)
            self._subscribed = True
        # Start filesystem watcher once
        if self._watcher_task is None:
            self._watcher_task = asyncio.create_task(self._watch_models())
        # Always run directory scan first
        dir_models: List[Dict[str, Any]] = []
        if self.models_dir.exists():
            dir_models = await asyncio.to_thread(self._scan_sync)
        else:
            logger.warning(f"Models directory not found: {self.models_dir}")
        # Fetch explicitly configured paths
        configured_paths: Optional[List[str]] = None
        if self.settings_manager:
            configured_paths = await self.settings_manager.get(self._SETTINGS_KEY)
        if not configured_paths:
            return dir_models
        # Scan configured paths and merge; configured entries win on collision
        logger.info(f"LocalModelProvider: scanning {len(configured_paths)} configured path(s)")
        path_models = await asyncio.to_thread(self._scan_paths_sync, configured_paths)
        merged: Dict[str, Dict[str, Any]] = {m["id"]: m for m in dir_models}
        for m in path_models:
            merged[m["id"]] = m
        logger.info(f"LocalModelProvider: {len(merged)} total models after merge (dir={len(dir_models)}, paths={len(path_models)})")
        return list(merged.values())
    
    # Settings-path based scan
    def _resolve_path(self, raw: str) -> Path:
        """Resolve a path that may be absolute or relative to project root."""
        p = Path(raw)
        if not p.is_absolute():
            p = self.project_root / p
        return p
    def _scan_paths_sync(self, raw_paths: List[str]) -> List[Dict[str, Any]]:
        """Build model entries from an explicit list of file paths."""
        all_files: List[Path] = []
        for raw in raw_paths:
            p = self._resolve_path(raw)
            if p.exists() and p.is_file():
                all_files.append(p)
            else:
                logger.warning(f"LocalModelProvider: configured path not found or not a file: {p}")

        # Separate mmproj files from regular model files
        mmproj_files = [f for f in all_files if self._is_mmproj(f.name)]
        model_files  = [f for f in all_files if not self._is_mmproj(f.name)]
        paired_mmprojs: set = set()
        models: List[Dict[str, Any]] = []

        for model_file in model_files:
        
            # Derive model_type from parent directory name when inside Models/
            try:
                rel = model_file.relative_to(self.models_dir)
                model_type = rel.parts[0] if len(rel.parts) > 1 else "llm"
            except ValueError:
                model_type = "llm"
            metadata = self._get_cached_metadata(model_file)
            display_name = (
                metadata.get("general.basename")
                or metadata.get("general.name")
                or model_file.stem.replace('-', ' ').replace('_', ' ').replace('.', ' ').title()
            )
            try:
                rel_dir = model_file.parent.relative_to(self.project_root)
            except ValueError:
                rel_dir = model_file.parent  # absolute path fallback
            model_id = f"local/{model_type}/{model_file.name}".lower()
            entry: Dict[str, Any] = {
                "id": model_id,
                "name": self.format_model_name(display_name),
                "backend": "openchad/llamacpp",
                "model_type": model_type,
                "model_path": str(rel_dir) + os.sep,
                "filename": model_file.name,
                "provider": self.provider_id,
                "is_local": True,
            }

            # Pair with mmproj if available
            mmproj = self._find_mmproj_for(model_file, mmproj_files)
            if mmproj:
                paired_mmprojs.add(mmproj)
                try:
                    mmproj_rel = mmproj.relative_to(self.project_root)
                except ValueError:
                    mmproj_rel = mmproj
                entry["mmproj_path"] = str(mmproj_rel)
                entry["multimodal"] = True
                logger.debug(f"Paired mmproj {mmproj.name} → {model_file.name}")
            models.append(entry)
            logger.debug(f"Discovered (settings) model: {model_id}")

        # Warn on unpaired mmproj files
        for orphan in [mp for mp in mmproj_files if mp not in paired_mmprojs]:
            logger.warning(f"LocalModelProvider: mmproj file has no matching model and will be ignored: {orphan}")
        self._save_cache()
        return models
    
    # Directory-based scan
    def _scan_sync(self) -> List[Dict[str, Any]]:
        """Synchronous scanning logic for thread offloading."""
        logger.info(f"Scanning local models in: {self.models_dir}")
        models = []
        for type_dir in self.models_dir.iterdir():
            if not type_dir.is_dir() or type_dir.name.startswith(('.', '_')):
                continue
            model_type = type_dir.name
            # Collect and separate files in this type directory
            all_files = [
                f for f in type_dir.iterdir()
                if f.is_file() and not f.name.startswith(('.', '_'))
            ]
            mmproj_files = [f for f in all_files if self._is_mmproj(f.name)]
            paired_mmprojs: set = set()
            for model_file in type_dir.iterdir():
                if model_file.name.startswith(('.', '_')):
                    continue
                if not model_file.is_file():
                    continue
                # Skip mmproj files  attached to their paired model below
                if self._is_mmproj(model_file.name):
                    continue
                model_id = f"local/{model_type}/{model_file.name}".lower()
                metadata = self._get_cached_metadata(model_file)
                display_name = (
                    metadata.get("general.basename")
                    or metadata.get("general.name")
                    or model_file.stem.replace('-', ' ').replace('_', ' ').replace('.', ' ').title()
                )
                rel_dir = type_dir.relative_to(self.project_root)
                entry: Dict[str, Any] = {
                    "id": model_id,
                    "name": self.format_model_name(display_name),
                    "backend": "openchad/llamacpp",
                    "model_type": model_type,
                    "model_path": str(rel_dir) + os.sep,
                    "filename": model_file.name,
                    "provider": self.provider_id,
                    "is_local": True,
                }
                mmproj = self._find_mmproj_for(model_file, mmproj_files)
                if mmproj:
                    paired_mmprojs.add(mmproj)
                    mmproj_rel = mmproj.relative_to(self.project_root)
                    entry["mmproj_path"] = str(mmproj_rel)
                    entry["multimodal"] = True
                    logger.debug(f"Paired mmproj {mmproj.name} → {model_file.name}")
                models.append(entry)
                logger.debug(f"Discovered local model: {model_id} (Name: {display_name})")
            # Warn orphaned mmproj files in this directory
            for orphan in [mp for mp in mmproj_files if mp not in paired_mmprojs]:
                logger.warning(f"Unpaired mmproj file (ignored): {orphan}")
        logger.info(f"Found {len(models)} local models.")
        self._save_cache()
        return models
    
    # Filesystem watcher
    async def close(self):
        """Cleanup resources."""
        if self._watcher_task:
            self._watcher_task.cancel()
            try:
                await self._watcher_task
            except asyncio.CancelledError:
                pass
            self._watcher_task = None
            logger.info("Models directory watcher stopped")
        if self._subscribed and self.settings_manager:
            self.settings_manager.unsubscribe(self._on_setting_changed)
            self._subscribed = False
            logger.info("LocalModelProvider unsubscribed from settings")
    async def _watch_models(self):
        """Background task to watch the Models directory for changes."""
        if not self.models_dir.exists():
            try:
                self.models_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.error(f"Failed to create models directory for watching: {e}")
                return
        logger.info(f"Watching models directory for changes: {self.models_dir}")
        try:
            async for changes in awatch(str(self.models_dir), debounce=1000):
                relevant_changes = [
                    (c, p) for c, p in changes
                    if not Path(p).name.startswith(('.', '_'))
                    and not str(p).endswith('.json')
                ]
                if relevant_changes:
                    logger.info(f"Models directory changes detected: {len(relevant_changes)} file(s)")
                    if self.on_change:
                        try:
                            if asyncio.iscoroutinefunction(self.on_change):
                                await self.on_change()
                            else:
                                self.on_change()
                        except Exception as e:
                            logger.error(f"Error in on_change callback: {e}")
        except asyncio.CancelledError:
            logger.debug("Models watcher task cancelled")
        except Exception as e:
            logger.error(f"Models watcher failed: {e}")