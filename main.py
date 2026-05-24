from llama_cpp import Llama
import os
import re
import struct
import numpy as np
from typing import Optional, List, Dict, Generator, Union, Tuple, Any, Callable, Iterator
from openchadpy.base_backend import BaseBackend
from llama_cpp.llama_chat_format import (
        Llava15ChatHandler,
        Llava16ChatHandler,
        MoondreamChatHandler,
        NanoLlavaChatHandler,
        MiniCPMv26ChatHandler,
        Qwen25VLChatHandler
    )
from chat_handler import (
        SmolVLMChatHandler, 
        KimiVLChatHandler, 
        MistralChatHandler,
        Gemma3ChatHandler,
        GLM41VChatHandler,
        GLM46VChatHandler,
        Qwen3VLChatHandler,
        Qwen35ChatHandler,
        Gemma4ChatHandler,
        FaraChatHandler,
    )

def get_gguf_metadata(path: str) -> Dict[str, Any]:
    """
    Read metadata from a GGUF file without loading the model.
    """
    if not os.path.exists(path):
        return {}
    metadata = {}
    # GGUF Types
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
            return [_read_value(f, item_type) for _ in range(count)]
        return None
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic != b"GGUF":
                return {}
            version = struct.unpack("<I", f.read(4))[0]
            # Skip tensor count
            f.read(8)
            # KV Count
            kv_count = struct.unpack("<Q", f.read(8))[0]
            for _ in range(kv_count):
                key = _read_string(f)
                val_type = struct.unpack("<I", f.read(4))[0]
                value = _read_value(f, val_type)
                metadata[key] = value
    except Exception as e:
        print(f"Error reading GGUF metadata: {e}")
    return metadata
class LlamaCpp(BaseBackend):
    backend = "llamacpp"
    use_lock = True
    """
    A wrapper class for llama-cpp-python functionality.
    """
    def __init__(
        self,
        model_path: Optional[str] = None,
        filename: Optional[str] = None,
        embedding: bool = False,
        add_prefix: Optional[Dict[str, Callable[[str], str]]] = None,
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,  # -1 for all layers on GPU
        verbose: bool = False,
        mmproj_path: Optional[str] = None,
        dimension: Optional[int] = None,
        **kwargs
    ):
        """
        Initialize the Llama model.
        :param model_path: Path to the .gguf model file (local).
        :param filename: Filename in the repository (if loading from repo).
        :param embedding: Whether to enable embedding mode.
        :param n_ctx: Context window size.
        :param n_gpu_layers: Number of layers to offload to GPU.
        :param verbose: Whether to print verbose output.
        :param mmproj_path: Path to multimodal projector file.
        :param chat_handler_type: Specific chat handler to use (e.g., 'smolvlm', 'kimi', 'mistral', 'qwen3').
        :param kwargs: Additional arguments to pass to Llama constructor.
        """
        self.verbose = verbose
        self.add_prefix = add_prefix
        self._dimension = dimension
        # Initialize chat handler from mmproj if provided
        chat_handler = None
        if mmproj_path and os.path.isfile(mmproj_path) and model_path:
            if self.verbose:
                print(f"Loading multimodal projector: {mmproj_path}")
            # Select specific handler
            metadata = get_gguf_metadata(model_path)
            basename = str(metadata.get("general.basename", "")).lower()            
            if basename:
                if "nanollava" in basename and NanoLlavaChatHandler:
                    chat_handler = NanoLlavaChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "smolvlm" in basename and SmolVLMChatHandler:
                    chat_handler = SmolVLMChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "kimi-vl" in basename and KimiVLChatHandler:
                    chat_handler = KimiVLChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "mistral-large-3" in basename and MistralChatHandler:
                    chat_handler = MistralChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "ministral-3" in basename and MistralChatHandler:
                    chat_handler = MistralChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "devstral-2" in basename and MistralChatHandler:
                    chat_handler = MistralChatHandler(clip_model_path=mmproj_path, verbose=verbose)                            
                elif "gemma-3" in basename and Gemma3ChatHandler:
                    chat_handler = Gemma3ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "gemma-4" in basename and Gemma4ChatHandler:
                    chat_handler = Gemma4ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "glm-4.1v" in basename and GLM41VChatHandler:
                    chat_handler = GLM41VChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "glm-4.6v" in basename and GLM46VChatHandler:
                    chat_handler = GLM46VChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "qwen-3vl" in basename and Qwen3VLChatHandler:
                     chat_handler = Qwen3VLChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif ("qwen-3.5" in basename or "qwen-3.6" in basename) and Qwen35ChatHandler:
                     chat_handler = Qwen35ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "fara" in basename and FaraChatHandler:
                     chat_handler = FaraChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "qwen-2.5vl" in basename and Qwen25VLChatHandler:
                     chat_handler = Qwen25VLChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "llava-15" in basename and Llava15ChatHandler:
                    chat_handler = Llava15ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "llava-16" in basename and Llava16ChatHandler:
                    chat_handler = Llava16ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "moondream" in basename and MoondreamChatHandler:
                    chat_handler = MoondreamChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "minicpm" in basename and MiniCPMv26ChatHandler:
                    chat_handler = MiniCPMv26ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                elif "olmocr-2" in basename and Qwen25VLChatHandler:
                    chat_handler = Qwen25VLChatHandler(clip_model_path=mmproj_path, verbose=verbose)                   
                else:
                    if self.verbose:
                        print(f"Warning: Requested chat handler for '{basename}' not found or dependencies missing. Falling back to default.")
            # Fallback to default Llava15ChatHandler if no specific handler selected or found
            if chat_handler is None:
                if Llava15ChatHandler:
                    chat_handler = Llava15ChatHandler(clip_model_path=mmproj_path, verbose=verbose)
                else:
                    print("Warning: mmproj_path provided but Llava15ChatHandler could not be imported.")
        if model_path and os.path.isfile(model_path):
            self.model = Llama(
                model_path=model_path,
                n_ctx=n_ctx,
                n_gpu_layers=n_gpu_layers,
                chat_handler=chat_handler,
                verbose=verbose,
                embedding=embedding,
                **kwargs
            )
        elif model_path and filename:
            if verbose:
                print(f"Model path '{model_path}' not found locally. Attempting to load from HF: {model_path}/{filename}")
            self.model = Llama.from_pretrained(
                repo_id=model_path,
                filename=filename,
                n_ctx=n_ctx,
                n_gpu_layers=n_gpu_layers,
                chat_handler=chat_handler,
                verbose=verbose,
                embedding=embedding,
                **kwargs
            )
        else:
            raise ValueError("model_path must be provided.")
    def generate(
        self,
        prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stop: Optional[List[str]] = None,
        stream: bool = False,
        **kwargs
    ) -> Any:
        """
        Generate text completion based on a prompt.
        :param prompt: The input prompt.
        :param max_tokens: Maximum number of tokens to generate.
        :param temperature: Sampling temperature.
        :param top_p: Nucleus sampling probability.
        :param stop: List of strings to stop generation at.
        :param stream: Whether to stream the output.
        :return: Result dictionary or generator if streaming.
        """
        return self.model(
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stop=stop,
            stream=stream,
            **kwargs
        )
    def chat(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stream: bool = False,
        **kwargs
    ) -> Any:
        """
        Generate chat completion (compatible with OpenAI API).
        :param messages: List of message dictionaries containing 'role' and 'content'.
        :param max_tokens: Maximum number of tokens to generate.
        :param temperature: Sampling temperature.
        :param top_p: Nucleus sampling probability.
        :param stream: Whether to stream the output.
        :return: Result dictionary or generator if streaming.
        """
        # Check for automatic <think> tag in metadata
        has_think = False
        try:
            if hasattr(self.model, "metadata") and "tokenizer.chat_template" in self.model.metadata:
                template = self.model.metadata["tokenizer.chat_template"]
                if template:
                    if re.search(r"<\|im_start\|>assistant(\s+|\\n)<think>", template):
                        has_think = True
                    elif re.search(r"<\|start_header_id\|>assistant<\|end_header_id\|>(\s+|\\n)+<think>", template):
                        has_think = True
                    elif "assistant\\n<think>" in template or "assistant\n<think>" in template:
                        has_think = True
        except Exception as e:
            print(f"!!! DIAGNOSTIC Error checking chat template: {e}")
        response = self.model.create_chat_completion(
            messages=messages,  # type: ignore
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=stream,
            **kwargs
        )
        if has_think:
            if stream:
                def think_wrapper(generator):
                    yield {"choices": [{"delta": {"content": "<think>"}, "finish_reason": None, "index": 0}]}
                    yield from generator
                return think_wrapper(response)
            else:
                # Non-streaming: prepend to content
                if isinstance(response, dict) and "choices" in response and len(response["choices"]) > 0:
                    content = response["choices"][0]["message"].get("content", "")
                    response["choices"][0]["message"]["content"] = "<think>" + content
                return response
        return response