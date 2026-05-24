import os
import logging
import asyncio
from pathlib import Path
from typing import List, Dict, Any
from openchadpy.base_provider import BaseModelProvider
from openchadpy.credentials import credentials_handler 
import litellm
logger = logging.getLogger(__name__)

def get_all_valid_models() -> list[str]:
    static = litellm.utils.get_valid_models()
    # example if you want to keep the model up to date
    # if os.getenv("OPENROUTER_API_KEY"):
    #     r = requests.get(
    #         "https://openrouter.ai/api/v1/models",
    #         headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"}
    #     )
    #     live_or_models = [f"openrouter/{m['id']}" for m in r.json()["data"]]
    #     return list(set(static + live_or_models))
    # else:
    #     return static
    return static
class LiteLLMModelProvider(BaseModelProvider):
    """
    Scans various online model providers via LiteLLM.
    Usage: Requires API keys in environment variables (e.g. OPENAI_API_KEY).
    """
    provider_id = "openchad/litellm"
    rescan_on_credentials = True
    def __init__(self):
        super().__init__()
        self.apiKeys = [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "GROQ_API_KEY",
            "MISTRAL_API_KEY",
            "COHERE_API_KEY",
            "OPENROUTER_API_KEY",
            "XAI_API_KEY",              # xAI / Grok
            "DEEPSEEK_API_KEY",
            "PERPLEXITYAI_API_KEY",     # also: PERPLEXITY_API_KEY
            "AZURE_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AZURE_AI_API_KEY",
            "AZURE_AD_TOKEN",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_REGION",
            "VERTEXAI_PROJECT",
            "VERTEX_PROJECT",
            "VERTEXAI_LOCATION",
            "VERTEX_LOCATION",
            "HUGGINGFACE_API_KEY",
            "TOGETHERAI_API_KEY",       # also: TOGETHER_AI_API_KEY, TOGETHER_API_KEY
            "REPLICATE_API_KEY",
            "REPLICATE_API_TOKEN",
            "FIREWORKS_AI_API_KEY",     # also: FIREWORKSAI_API_KEY, FIREWORKS_API_KEY
            "FIREWORKS_ACCOUNT_ID",
            "CEREBRAS_API_KEY",
            "AI21_API_KEY",
            "ALEPH_ALPHA_API_KEY",      # also: ALEPHALPHA_API_KEY
            "ANYSCALE_API_KEY",
            "BASETEN_API_KEY",
            "BLACK_FOREST_LABS_API_KEY",  # also: BFL_API_KEY
            "BYTEZ_API_KEY",
            "CEREBRAS_API_KEY",
            "CHUTES_API_KEY",
            "CLARIFAI_API_KEY",
            "CLOUDFLARE_API_KEY",
            "CLOUDFLARE_ACCOUNT_ID",
            "CODESTRAL_API_KEY",
            "COMETAPI_API_KEY",
            "COMPACTIFAI_API_KEY",
            "DASHSCOPE_API_KEY",
            "DATABRICKS_API_KEY",
            "DATAROBOT_API_TOKEN",
            "DEEPGRAM_API_KEY",
            "DEEPINFRA_API_KEY",
            "DOCKER_MODEL_RUNNER_API_KEY",
            "ELEVENLABS_API_KEY",
            "FAL_AI_API_KEY",
            "FEATHERLESS_AI_API_KEY",
            "FRIENDLIAI_API_KEY",       # also: FRIENDLI_TOKEN
            "GALADRIEL_API_KEY",
            "GITHUB_API_KEY",
            "GRADIENT_AI_API_KEY",      # GradientAI / DigitalOcean
            "HELICONE_API_KEY",
            "HEROKU_API_KEY",
            "HYPERBOLIC_API_KEY",
            "INFINITY_API_KEY",
            "JINA_AI_API_KEY",
            "LAMBDA_API_KEY",
            "LANGGRAPH_API_KEY",
            "LEMONADE_API_KEY",
            "LLAMAFILE_API_KEY",
            "LM_STUDIO_API_KEY",
            "MANUS_API_KEY",
            "LLAMA_API_KEY",
            "MINIMAX_API_KEY",
            "MOONSHOT_API_KEY",
            "MORPH_API_KEY",
            "NANOGPT_API_KEY",
            "NEBIUS_API_KEY",
            "NLP_CLOUD_API_KEY",
            "NOVITA_API_KEY",
            "NSCALE_API_KEY",
            "NVIDIA_NIM_API_KEY",
            "OCI_API_KEY",
            "OVHCLOUD_API_KEY",
            "POE_API_KEY",
            "PREDIBASE_API_KEY",
            "PUBLICAI_API_KEY",
            "RAGFLOW_API_KEY",
            "RECRAFT_API_KEY",
            "RUNWAYML_API_SECRET",
            "SAMBANOVA_API_KEY",
            "SCALEWAY_API_KEY",
            "SNOWFLAKE_API_KEY",
            "SNOWFLAKE_ACCOUNT_ID",
            "STABILITY_API_KEY",
            "SYNTHETIC_API_KEY",
            "STIMA_API_KEY",
            "TOGETHER_AI_API_KEY",
            "TOPAZ_API_KEY",
            "V0_API_KEY",
            "VERCEL_AI_GATEWAY_API_KEY",
            "VOLCENGINE_API_KEY",       # also: ARK_API_KEY
            "VOYAGE_API_KEY",           # also: VOYAGE_AI_API_KEY
            "WANDB_API_KEY",
            "WATSONX_API_KEY",          # also: WX_API_KEY
            "WATSONX_TOKEN",
            "WATSONX_REGION",
            "XIAOMI_MIMO_API_KEY",
            "XINFERENCE_API_KEY",
            "ZAI_API_KEY",
        ]
    async def scan(self) -> List[Dict[str, Any]]:
        """
        Scan for available models from LiteLLM based on set API keys.
        """           
        return await asyncio.to_thread(self._scan_sync)
    def _scan_sync(self) -> List[Dict[str, Any]]:
        logger.info("Scanning for LiteLLM models...")
        models = []
        try:
            set_keys = {key for key in self.apiKeys if os.environ.get(key)}
            if not set_keys:
                logger.debug("No LiteLLM API keys found in environment.")
                return []
            prefixes = {
                "openai": ["OPENAI_API_KEY"],
                "anthropic": ["ANTHROPIC_API_KEY"],
                "gemini": ["GEMINI_API_KEY"],
                "groq": ["GROQ_API_KEY"],
                "mistral": ["MISTRAL_API_KEY"],
                "cohere": ["COHERE_API_KEY"],
                "openrouter": ["OPENROUTER_API_KEY"],
                "xai": ["XAI_API_KEY"],
                "deepseek": ["DEEPSEEK_API_KEY"],
                "perplexity": ["PERPLEXITYAI_API_KEY"],
                "azure": ["AZURE_API_KEY", "AZURE_AD_TOKEN"],
                "vertex_ai": ["GOOGLE_APPLICATION_CREDENTIALS", "VERTEX_AI_PROJECT", "VERTEX_AI_LOCATION"],
                "bedrock": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
                "aws": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
                "huggingface": ["HUGGINGFACE_API_KEY"],
                "together_ai": ["TOGETHERAI_API_KEY"],
                "replicate": ["REPLICATE_API_KEY"],
                "fireworks_ai": ["FIREWORKSAI_API_KEY"],
                "cerebras": ["CEREBRAS_API_KEY"],
                "ai21": ["AI21_API_KEY"],
                "aleph_alpha": ["ALEPHALPHA_API_KEY"],
                "anyscale": ["ANYSCALE_API_KEY"],
                "baseten": ["BASETEN_API_KEY"],
                "black_forest_labs": ["BLACK_FOREST_LABS_API_KEY"],
                "bytez": ["BYTEZ_API_KEY"],
                "chutes": ["CHUTES_API_KEY"],
                "clarifai": ["CLARIFAI_API_KEY"],
                "cloudflare": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
                "codestral": ["CODESTRAL_API_KEY"],
                "cometapi": ["COMETAPI_API_KEY"],
                "compactifai": ["COMPACTIFAI_API_KEY"],
                "dashscope": ["DASHSCOPE_API_KEY"],
                "databricks": ["DATABRICKS_API_KEY"],
                "deepgram": ["DEEPGRAM_API_KEY"],
                "deepinfra": ["DEEPINFRA_API_KEY"],
                "elevenlabs": ["ELEVENLABS_API_KEY"],
                "fal_ai": ["FAL_AI_API_KEY"],
                "featherless_ai": ["FEATHERLESS_AI_API_KEY"],
                "friendliai": ["FRIENDLIAI_API_KEY"],
                "galadriel": ["GALADRIEL_API_KEY"],
                "github": ["GITHUB_API_KEY"],
                "gradient_ai": ["GRADIENT_AI_API_KEY"],
                "helicone": ["HELICONE_API_KEY"],
                "heroku": ["HEROKU_API_KEY"],
                "hyperbolic": ["HYPERBOLIC_API_KEY"],
                "jina_ai": ["JINA_AI_API_KEY"],
                "lambda_ai": ["LAMBDA_API_KEY"],
                "langgraph": ["LANGGRAPH_API_KEY"],
                "lemonade": ["LEMONADE_API_KEY"],
                "llamafile": ["LLAMAFILE_API_KEY"],
                "lm_studio": ["LM_STUDIO_API_KEY"],
                "manus": ["MANUS_API_KEY"],
                "minimax": ["MINIMAX_API_KEY"],
                "moonshot": ["MOONSHOT_API_KEY"],
                "morph": ["MORPH_API_KEY"],
                "nebius": ["NEBIUS_API_KEY"],
                "novita": ["NOVITA_API_KEY"],
                "nscale": ["NSCALE_API_KEY"],
                "nvidia_nim": ["NVIDIA_NIM_API_KEY"],
                "oci": ["OCI_API_KEY"],
                "ovhcloud": ["OVHCLOUD_API_KEY"],
                "poe": ["POE_API_KEY"],
                "predibase": ["PREDIBASE_API_KEY"],
                "publicai": ["PUBLICAI_API_KEY"],
                "ragflow": ["RAGFLOW_API_KEY"],
                "recraft": ["RECRAFT_API_KEY"],
                "runwayml": ["RUNWAYML_API_SECRET"],
                "sambanova": ["SAMBANOVA_API_KEY"],
                "scaleway": ["SCALEWAY_API_KEY"],
                "snowflake": ["SNOWFLAKE_API_KEY", "SNOWFLAKE_ACCOUNT_ID"],
                "stability": ["STABILITY_API_KEY"],
                "synthetic": ["SYNTHETIC_API_KEY"],
                "stima": ["STIMA_API_KEY"],
                "topaz": ["TOPAZ_API_KEY"],
                "v0": ["V0_API_KEY"],
                "volcengine": ["VOLCENGINE_API_KEY"],
                "voyage": ["VOYAGE_API_KEY"],
                "watsonx": ["WATSONX_API_KEY", "WATSONX_TOKEN", "WATSONX_REGION"],
                "xinference": ["XINFERENCE_API_KEY"],
                "zai": ["ZAI_API_KEY"]
            }
            added_count = 0
            for m_name, m_info in litellm.model_cost.items():
                provider_prefix = (
                    m_info.get("litellm_provider")          # e.g. "gemini", "openai"
                    or (m_name.split("/")[0] if "/" in m_name else None)
                )
                if not provider_prefix:
                    continue
                matched_keys = prefixes.get(provider_prefix.lower(), [])
                if not matched_keys:
                    continue
                if not any(k in set_keys for k in matched_keys):
                    continue
                m_id = f"litellm/{m_name}"
                models.append({
                    "id": m_id,
                    "name": self.format_model_name(m_name),
                    "backend": "openchad/litellm",
                    "model_type": self._get_model_types(m_name),
                    "model": m_name,
                    "provider": self.provider_id,
                    "auto_load": True,
                    "is_local": False,
                })
                added_count += 1
            logger.info(f"Discovered {added_count} usable LiteLLM models")
        except Exception as e:
            logger.error(f"Error scanning LiteLLM models: {e}")
        return models
    def _get_model_types(self, m_name: str) -> List[str]:
        """Determine model types based on LiteLLM mode from model_cost."""
        model_info = litellm.model_cost.get(m_name, {})
        mode = str(model_info.get("mode", "chat")).lower()
        m_types = []
        if any(x in mode for x in ["chat", "completion", "realtime", "responses"]):
            m_types.append("llm")
        if "transcription" in mode:
            m_types.append("transcription")
        if "image" in mode:
            m_types.append("image generation")
        if "video" in mode:
            m_types.append("video generation")
        if "speech" in mode:
            m_types.append("speech")
        if "embedding" in mode:
            m_types.append("embedding")
        return m_types if m_types else ["llm"]
