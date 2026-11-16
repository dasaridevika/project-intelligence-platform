import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx

# Ensure backend root is available for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.core.config import settings
from app.core.logging import logger


@dataclass
class QueueMessage:
    id: str
    body: Dict[str, Any]
    timestamp: str
    attempts: int = 1


class CloudflareQueueClient:
    """Client for pulling and acknowledging messages from Cloudflare Queues via REST API."""

    def __init__(
        self,
        account_id: Optional[str] = None,
        api_token: Optional[str] = None,
        queue_name: Optional[str] = None,
        dlq_name: Optional[str] = None,
    ):
        self.account_id = account_id or settings.CLOUDFLARE_ACCOUNT_ID
        self.api_token = api_token or settings.CLOUDFLARE_API_TOKEN
        self.queue_name = queue_name or settings.CLOUDFLARE_QUEUE_NAME
        self.dlq_name = dlq_name or settings.CLOUDFLARE_DLQ_NAME
        self.base_url = "https://api.cloudflare.com/client/v4"

        # Local in-memory queue fallback for tests and development without Cloudflare credentials
        self._is_simulated = not bool(self.account_id and self.api_token)
        self._simulated_queue: List[QueueMessage] = []
        self._simulated_dlq: List[QueueMessage] = []

        if self._is_simulated:
            logger.info("CloudflareQueueClient running in local simulated queue mode.")

    def push_simulated(self, body: Dict[str, Any]):
        """Helper for tests to enqueue messages into simulated queue."""
        import uuid
        msg = QueueMessage(
            id=str(uuid.uuid4()),
            body=body,
            timestamp=datetime.now(timezone.utc).isoformat(),
            attempts=1
        )
        self._simulated_queue.append(msg)
        return msg.id

    async def pull_messages(self, batch_size: int = 10, visibility_timeout: int = 60) -> List[QueueMessage]:
        """Pulls a batch of messages from the queue."""
        if self._is_simulated:
            if not self._simulated_queue:
                return []
            popped = self._simulated_queue[:batch_size]
            self._simulated_queue = self._simulated_queue[batch_size:]
            return popped

        url = f"{self.base_url}/accounts/{self.account_id}/queues/{self.queue_name}/messages/pull"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "batch_size": batch_size,
            "visibility_timeout": visibility_timeout
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    messages = data.get("result", {}).get("messages", [])
                    return [
                        QueueMessage(
                            id=m["id"],
                            body=m["body"],
                            timestamp=m.get("timestamp", ""),
                            attempts=m.get("attempts", 1)
                        )
                        for m in messages
                    ]
                else:
                    logger.error(f"Cloudflare Queues pull error: HTTP {res.status_code} - {res.text}")
                    return []
        except Exception as exc:
            logger.error(f"Failed to pull messages from Cloudflare Queues: {exc}")
            return []

    async def acknowledge_message(self, message_id: str) -> bool:
        """Acknowledges successful message processing."""
        if self._is_simulated:
            return True

        url = f"{self.base_url}/accounts/{self.account_id}/queues/{self.queue_name}/messages/ack"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        payload = {"acks": [message_id]}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, headers=headers, json=payload)
                return res.status_code == 200
        except Exception as exc:
            logger.error(f"Failed to acknowledge message {message_id}: {exc}")
            return False

    async def send_to_dlq(self, message: QueueMessage, reason: str) -> bool:
        """Routes repeatedly failing message to Dead-Letter Queue."""
        logger.warning(f"Routing message {message.id} to DLQ ({self.dlq_name}). Reason: {reason}")
        if self._is_simulated:
            self._simulated_dlq.append(message)
            return True

        url = f"{self.base_url}/accounts/{self.account_id}/queues/{self.dlq_name}/messages"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "body": {
                **message.body,
                "_dlq_metadata": {
                    "original_message_id": message.id,
                    "reason": reason,
                    "quarantined_at": datetime.now(timezone.utc).isoformat()
                }
            }
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, headers=headers, json=payload)
                return res.status_code == 200
        except Exception as exc:
            logger.error(f"Failed to route message {message.id} to DLQ: {exc}")
            return False


queue_client = CloudflareQueueClient()
