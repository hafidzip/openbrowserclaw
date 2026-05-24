import logging
import asyncio
import httpx
from typing import List, Dict, Any
# pyrefly: ignore [missing-import]
from openchadpy.base_provider import BaseModelProvider
logger = logging.getLogger(__name__)
class ProxyModelProvider(BaseModelProvider):
    """
    Scans for proxy models from settings.    
    """
    provider_id = "openchad/proxy"
    def __init__(self):
        super().__init__()
        self.on_change = None
        self._proxy_settings_key = "openchad/ProxyModelProvider/custom.endpoints"
        self._subscribed = False
    async def _on_proxy_setting_changed(self, key: str):
        """Callback for settings changes."""
        if key == self._proxy_settings_key:
            logger.info("Proxy settings changed, triggering rescan")
            if self.on_change:
                try:
                    if asyncio.iscoroutinefunction(self.on_change):
                         await self.on_change()
                    else:
                        self.on_change()
                except Exception as e:
                    logger.error(f"Error in ProxyModelProvider on_change callback: {e}")
    async def scan(self) -> List[Dict[str, Any]]:
        """
        Scan for models from proxy URLs in settings.
        """          
        if self.settings_manager and not self._subscribed:
            self.settings_manager.subscribe(self._on_proxy_setting_changed)
            self._subscribed = True
        logger.info(f"Scanning proxy models")
        models = []
        if not self.settings_manager:
            logger.info("Settings manager not available, no proxy URLs can be fetched")
            return []
        endpoints = await self.settings_manager.get("openchad/ProxyModelProvider/custom.endpoints")
        if not endpoints:
            logger.info("No proxy URLs configured")
            return []
        async with httpx.AsyncClient(verify=False) as client:
            tasks = [self._fetch_models(client, url) for url in endpoints if url]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, list):
                    models.extend(result)
                elif isinstance(result, Exception):
                    logger.error(f"Error fetching proxy models: {result}")
        return models
    async def _fetch_models(self, client: httpx.AsyncClient, base_url: str) -> List[Dict[str, Any]]:
        """Fetch models from a single proxy URL."""
        try:
            # Format the scan URL: append /v1/models if it looks like a base URL
            scan_url = base_url.rstrip('/')
            if not scan_url.endswith('/models'):
                if not scan_url.endswith('/v1'):
                    scan_url += '/v1/models'
                else:
                    scan_url += '/models'
            logger.info(f"Fetching models from {scan_url}")
            response = await client.get(scan_url, timeout=10.0)
            if response.status_code != 200:
                logger.warning(f"Proxy {scan_url} returned status {response.status_code}")
                return []
            data = response.json()
            model_list = data.get("data", [])
            if not isinstance(model_list, list):
                if isinstance(data, list):
                    model_list = data
                else:
                    logger.warning(f"Unexpected response format from {scan_url}")
                    return []
            results = []
            # Extract host for prefixing
            host = base_url.split("//")[-1].split("/")[0]
            for m in model_list:
                m_id = m.get("id")
                if not m_id: continue
                m_type = ["llm"]
                unique_id = f"proxy/{host}/{m_id}"
                results.append({
                    "id": unique_id,
                    "name": f"{m_id}",
                    "backend": "openchad/litellm",
                    "model_type": m_type,
                    "api_base": base_url, # Passed to litellm
                    "model": f"openai/{m_id}", # LiteLLM syntax for custom OpenAI compatible endpoints
                    "auto_load": True,
                    "is_local": False
                })
            return results
        except Exception as e:
            logger.error(f"Error fetching models from {base_url}: {e}")
            return []
    async def close(self):
        """Cleanup settings subscriptions."""
        if self._subscribed and self.settings_manager:
            self.settings_manager.unsubscribe(self._on_proxy_setting_changed)
            self._subscribed = False
            logger.info("ProxyModelProvider closed and unsubscribed")
