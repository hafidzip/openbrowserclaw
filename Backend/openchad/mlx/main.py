import json
import os
import re
from typing import Optional, List, Dict, Generator, Any
from openchadpy.base_backend import BackendMetadata, BaseBackend


# ---------------------------------------------------------------------------
# Known vision model_type values used by mlx-vlm / HuggingFace VLMs
# ---------------------------------------------------------------------------
_VLM_MODEL_TYPES = {
    "llava",
    "llava_next",
    "llava_next_video",
    "idefics",
    "idefics2",
    "idefics3",
    "paligemma",
    "paligemma2",
    "qwen2_vl",
    "qwen2_5_vl",
    "qwen_vl",
    "pixtral",
    "phi3_v",
    "phi3v",
    "phi4_multimodal",
    "florence2",
    "molmo",
    "mllama",
    "deepseek_vl",
    "deepseek_vl_v2",
    "internvl_chat",
    "internvl2",
    "aria",
    "bunny-llama",
    "minicpmv",
    "cogvlm2",
    "got_ocr2",
    "nvlm_d",
    "smolvlm",
    "kimi_vl",
    "gemma3",  # Gemma 3 multimodal
    "glm_4v",
}


def _detect_vision_from_config(model_path: str) -> bool:
    """
    Inspect the model's config.json to decide if it is a vision-language model.

    Works for both:
    - Local paths: reads <model_path>/config.json directly.
    - HuggingFace repo IDs: fetches config.json via the Hub API (if huggingface_hub
      is installed), falling back to False on any failure.

    Detection heuristics (any one is sufficient):
    - ``model_type`` matches a known VLM type.
    - Config contains a ``vision_config`` key.
    - Config contains an ``image_token_index`` key.
    - Config contains a ``visual_config`` key.
    """
    config: Dict[str, Any] = {}
    try:
        from huggingface_hub import hf_hub_download

        config_path = hf_hub_download(
            repo_id=model_path,
            filename="config.json",
            local_files_only=False,
        )
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception:
        # Hub not available or network error — conservative fallback
        return False

    if not config:
        return False

    model_type = str(config.get("model_type", "")).lower()

    # Direct model_type match
    if model_type in _VLM_MODEL_TYPES:
        return True

    # Partial match (e.g. "llava_mistral", "qwen2_vl_instruct")
    for vlm_type in _VLM_MODEL_TYPES:
        if vlm_type in model_type:
            return True

    # Structural keys that only VLMs carry
    if any(k in config for k in ("vision_config", "image_token_index", "visual_config")):
        return True

    return False


class MLXBackend(BaseBackend):
    """
    Backend for running models on Apple Silicon via mlx-lm / mlx-vlm.

    Vision capability is **auto-detected** from the model's ``config.json``
    — no manual flag required.  If the model is identified as a VLM the
    backend loads via ``mlx_vlm``; otherwise it uses ``mlx_lm``.
    """

    backend = "mlx"
    use_lock = True

    def __init__(
        self,
        model_path: Optional[str] = None,
        tokenizer_config: Optional[Dict[str, Any]] = None,
        adapter_path: Optional[str] = None,
        lazy: bool = False,
        verbose: bool = False,
        # Generation defaults (can be overridden per-call)
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        **kwargs,
    ):
        """
        Initialize the MLX backend.

        :param model_path: HuggingFace repo ID or local path to the model.
        :param tokenizer_config: Optional dict of tokenizer configuration overrides.
        :param adapter_path: Optional path to LoRA / QLoRA adapter weights.
        :param lazy: If True, weight loading is deferred (mlx lazy evaluation).
        :param verbose: Print verbose loading output.
        :param max_tokens: Default max tokens for generation.
        :param temperature: Default sampling temperature.
        :param top_p: Default nucleus sampling probability.
        :param kwargs: Additional keyword arguments forwarded to mlx_lm.load.
        """
        if not model_path:
            raise ValueError("model_path must be provided.")

        self.model_path = model_path
        self.verbose = verbose
        self._default_max_tokens = max_tokens
        self._default_temperature = temperature
        self._default_top_p = top_p

        # Auto-detect VLM from config.json
        is_vision = _detect_vision_from_config(model_path)
        if verbose:
            print(f"[MLXBackend] Vision auto-detection for '{model_path}': {is_vision}")

        if is_vision:
            try:
                from mlx_vlm import load as vlm_load
                from mlx_vlm.utils import load_config as vlm_load_config

                self.model, self.processor = vlm_load(model_path)
                self.config = vlm_load_config(model_path)
                self._vlm = True
            except ImportError as exc:
                raise ImportError(
                    "mlx-vlm is required for vision models. "
                    "Install it with: pip install mlx-vlm"
                ) from exc
        else:
            try:
                from mlx_lm import load as lm_load

                load_kwargs: Dict[str, Any] = {}
                if tokenizer_config:
                    load_kwargs["tokenizer_config"] = tokenizer_config
                if adapter_path:
                    load_kwargs["adapter_path"] = adapter_path
                if lazy:
                    load_kwargs["lazy"] = lazy
                load_kwargs.update(kwargs)

                self.model, self.tokenizer = lm_load(model_path, **load_kwargs)
                self._vlm = False
            except ImportError as exc:
                raise ImportError(
                    "mlx-lm is required. Install it with: pip install mlx-lm"
                ) from exc

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _has_think_template(self) -> bool:
        """Return True if the tokenizer chat template injects a <think> tag."""
        try:
            template = getattr(self.tokenizer, "chat_template", None) or ""
            if template:
                if re.search(r"<\|im_start\|>assistant(\s+|\\n)<think>", template):
                    return True
                if re.search(
                    r"<\|start_header_id\|>assistant<\|end_header_id\|>(\s+|\\n)+<think>",
                    template,
                ):
                    return True
                if "assistant\\n<think>" in template or "assistant\n<think>" in template:
                    return True
        except Exception:
            pass
        return False

    def _apply_chat_template(self, messages: List[Dict[str, Any]]) -> str:
        """Convert a list of message dicts to a single prompt string."""
        try:
            return self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:
            # Fallback: simple concatenation
            parts = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "")
                        for c in content
                        if isinstance(c, dict) and c.get("type") == "text"
                    )
                parts.append(f"{role}: {content}")
            parts.append("assistant:")
            return "\n".join(parts)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(
        self,
        prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stop: Optional[List[str]] = None,
        stream: bool = False,
        **kwargs,
    ) -> Any:
        """
        Generate text from a raw prompt string.

        :param prompt: The input prompt.
        :param max_tokens: Maximum tokens to generate.
        :param temperature: Sampling temperature.
        :param top_p: Nucleus sampling probability.
        :param stop: List of stop strings.
        :param stream: If True, returns a generator yielding text chunks.
        :return: Full text string, or generator of text chunks when streaming.
        """
        from mlx_lm import generate, stream_generate

        gen_kwargs: Dict[str, Any] = {
            "max_tokens": max_tokens,
            "temp": temperature,
            "top_p": top_p,
            **kwargs,
        }

        if stream:
            def _stream() -> Generator[str, None, None]:
                for response in stream_generate(
                    self.model,
                    self.tokenizer,
                    prompt=prompt,
                    **gen_kwargs,
                ):
                    text = response.text if hasattr(response, "text") else str(response)
                    if stop:
                        for s in stop:
                            if s in text:
                                text = text[: text.index(s)]
                                yield text
                                return
                    yield text

            return _stream()
        else:
            text = generate(
                self.model,
                self.tokenizer,
                prompt=prompt,
                **gen_kwargs,
            )
            if stop:
                for s in stop:
                    if s in text:
                        text = text[: text.index(s)]
                        break
            return text

    def chat(
        self,
        messages: List[Dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stream: bool = False,
        **kwargs,
    ) -> Any:
        """
        Generate a chat completion in OpenAI-compatible format.

        :param messages: List of message dicts with 'role' and 'content'.
        :param max_tokens: Maximum tokens to generate.
        :param temperature: Sampling temperature.
        :param top_p: Nucleus sampling probability.
        :param stream: If True, returns a generator yielding OpenAI-style chunk dicts.
        :return: OpenAI-compatible response dict, or generator of chunk dicts.
        """
        if self._vlm:
            return self._chat_vlm(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                stream=stream,
                **kwargs,
            )

        prompt = self._apply_chat_template(messages)
        has_think = self._has_think_template()

        from mlx_lm import stream_generate, generate

        gen_kwargs: Dict[str, Any] = {
            "max_tokens": max_tokens,
            "temp": temperature,
            "top_p": top_p,
            **kwargs,
        }

        if stream:
            def _stream_chat() -> Generator[Dict[str, Any], None, None]:
                if has_think:
                    yield {
                        "choices": [
                            {"delta": {"content": "<think>"}, "finish_reason": None, "index": 0}
                        ]
                    }
                for response in stream_generate(
                    self.model,
                    self.tokenizer,
                    prompt=prompt,
                    **gen_kwargs,
                ):
                    text = response.text if hasattr(response, "text") else str(response)
                    yield {
                        "choices": [
                            {"delta": {"content": text}, "finish_reason": None, "index": 0}
                        ]
                    }
                yield {
                    "choices": [
                        {"delta": {"content": ""}, "finish_reason": "stop", "index": 0}
                    ]
                }

            return _stream_chat()
        else:
            text = generate(
                self.model,
                self.tokenizer,
                prompt=prompt,
                **gen_kwargs,
            )
            if has_think:
                text = "<think>" + text
            return {
                "choices": [
                    {
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                        "index": 0,
                    }
                ]
            }

    # ------------------------------------------------------------------
    # VLM support (mlx-vlm)
    # ------------------------------------------------------------------

    def _chat_vlm(
        self,
        messages: List[Dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.8,
        top_p: float = 0.95,
        stream: bool = False,
        **kwargs,
    ) -> Any:
        """Handle chat for vision-language models loaded via mlx-vlm."""
        from mlx_vlm import generate as vlm_generate
        from mlx_vlm.prompt_utils import apply_chat_template

        image_urls: List[str] = []
        text_parts: List[str] = []

        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict):
                        if item.get("type") == "image_url":
                            url = item.get("image_url", {})
                            if isinstance(url, dict):
                                image_urls.append(url.get("url", ""))
                            elif isinstance(url, str):
                                image_urls.append(url)
                        elif item.get("type") == "text":
                            text_parts.append(item.get("text", ""))
            elif isinstance(content, str):
                text_parts.append(content)

        prompt = apply_chat_template(
            self.processor,
            self.config,
            " ".join(text_parts),
            num_images=len(image_urls),
        )

        output = vlm_generate(
            self.model,
            self.processor,
            prompt,
            image_urls if image_urls else None,
            max_tokens=max_tokens,
            temp=temperature,
            top_p=top_p,
            verbose=self.verbose,
        )

        text = output if isinstance(output, str) else str(output)

        if stream:
            def _vlm_stream() -> Generator[Dict[str, Any], None, None]:
                yield {
                    "choices": [
                        {"delta": {"content": text}, "finish_reason": None, "index": 0}
                    ]
                }
                yield {
                    "choices": [
                        {"delta": {"content": ""}, "finish_reason": "stop", "index": 0}
                    ]
                }

            return _vlm_stream()

        return {
            "choices": [
                {
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                    "index": 0,
                }
            ]
        }

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def get_metadata(self) -> BackendMetadata:
        return BackendMetadata(
            name="MLX Backend",
            description="Apple Silicon inference via mlx-lm / mlx-vlm",
            version="1.0.0",
            capabilities=["LLM", "VISION"] if self._vlm else ["LLM"],
            author="Hafidz Ihza Pratama",
            requirements=["mlx-lm"],
        )
