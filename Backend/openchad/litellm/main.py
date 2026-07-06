import os
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
import json
from datetime import datetime
import litellm
from litellm import completion_cost
from typing import Optional, List, Dict, Union, Any, Generator, Tuple
import numpy as np
import logging
logger = logging.getLogger(__name__)
from openchadpy.base_backend import BackendMetadata, BaseBackend
class LiteLLMManager(BaseBackend):
    """
    A robust wrapper class for LiteLLM functionality, supporting various LLM providers
    (OpenAI, Anthropic, Azure, Groq, etc.) with a unified interface.
    """
    backend = "litellm"
    use_lock = False
    def __init__(self, **kwargs):
        """
        Initialize the LiteLLMManager.        
        Args:
            config: Configuration dictionary containing API keys and settings
        """
        self.model_name = kwargs.get("model_path") or kwargs.get("model")
        self.api_base = kwargs.get("api_base")
        self.api_key = kwargs.get("api_key")
    def get_metadata(self) -> BackendMetadata:
        """
        Get metadata about this backend.
        """
        return BackendMetadata(
            name="LiteLLM Backend",
            description="Unified interface for multiple LLM providers via LiteLLM",
            version="1.0.0",
            capabilities=[
                "LLM",
            ]
        )
    @staticmethod
    def _to_dict(obj: Any) -> Any:
        """Convert a LiteLLM Pydantic response object to a plain dict."""
        if isinstance(obj, dict):
            return obj
        if hasattr(obj, 'model_dump'):
            return obj.model_dump()
        if hasattr(obj, 'dict'):
            return obj.dict()
        return obj
    @staticmethod
    def _dict_stream(stream) -> Generator:
        """Wrap a LiteLLM stream to yield plain dicts instead of Pydantic objects."""
        for chunk in stream:
            if isinstance(chunk, dict):
                yield chunk
            elif hasattr(chunk, 'model_dump'):
                yield chunk.model_dump()
            elif hasattr(chunk, 'dict'):
                yield chunk.dict()
            else:
                yield chunk
    def chat(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stream: bool = False,
        **kwargs
    ) -> Union[Dict, Generator]:
        """
        Generate chat completion using litellm.
        """
        if not self.model_name:
            raise ValueError("model_path or model must be provided when initializing LiteLLMBackend")
        # Build extra params for litellm
        extra = {}
        if self.api_base:
            extra["api_base"] = self.api_base
        if self.api_key:
            extra["api_key"] = self.api_key
        elif self.api_base:
            # OpenAI-compatible proxies (KoboldCpp, etc.) require an api_key
            # even when the server doesn't authenticate. Use a dummy value.
            extra["api_key"] = "sk-no-key"
        # LiteLLM's unified interface for completions
        response = litellm.completion(  # type: ignore
            model=self.model_name,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=stream,
            **extra,
            **kwargs
        )
        # LiteLLM returns Pydantic objects; convert to plain dicts for
        # compatibility with the rest of the codebase.
        if stream:
            return self._dict_stream(response)
        return self._to_dict(response)
