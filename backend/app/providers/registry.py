from typing import Dict, List, Optional
from app.core.config import settings
from app.core.logging import logger
from app.providers.base import BaseSearchProvider
from app.providers.exa_provider import ExaProvider
from app.providers.second_provider import ConfigurableSearchProvider


class ProviderRegistry:
    """Registry maintaining active search provider instances."""

    def __init__(self):
        self._providers: Dict[str, BaseSearchProvider] = {}
        self._initialize_default_providers()

    def _initialize_default_providers(self):
        # Exa Provider
        self._providers["exa"] = ExaProvider()

        # Secondary Configurable Provider (e.g. Brave)
        second_name = settings.SECOND_PROVIDER_NAME.lower()
        self._providers[second_name] = ConfigurableSearchProvider(name=second_name)

    def register(self, provider: BaseSearchProvider):
        self._providers[provider.name.lower()] = provider

    def get(self, name: str) -> Optional[BaseSearchProvider]:
        return self._providers.get(name.lower())

    def get_active_providers(self, requested_names: Optional[List[str]] = None) -> List[BaseSearchProvider]:
        if not requested_names:
            return list(self._providers.values())
        selected = []
        for name in requested_names:
            p = self.get(name)
            if p:
                selected.append(p)
            else:
                logger.warning(f"Requested search provider '{name}' is not registered.")
        return selected


provider_registry = ProviderRegistry()
