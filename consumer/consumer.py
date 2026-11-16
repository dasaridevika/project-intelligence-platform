import asyncio
import os
import signal
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

# Ensure backend root is available for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.outbox import ProcessedMessage
from app.models.system import SystemError
from app.services.search_orchestrator import search_orchestrator
from queue_client import CloudflareQueueClient, QueueMessage, queue_client


class SearchJobConsumer:
    """Production Python pull consumer processing asynchronous discovery search requests."""

    def __init__(self, client: Optional[CloudflareQueueClient] = None, consumer_id: Optional[str] = None):
        self.queue_client = client or queue_client
        self.consumer_id = consumer_id or f"consumer-{uuid.uuid4().hex[:8]}"
        self.running = False
        self._shutdown_event = asyncio.Event()

    async def _is_already_processed(self, event_id: uuid.UUID, search_run_id: uuid.UUID) -> bool:
        """Atomic idempotency check: attempts to record processed_message."""
        async with AsyncSessionLocal() as session:
            try:
                proc = ProcessedMessage(
                    id=uuid.uuid4(),
                    event_id=event_id,
                    search_run_id=search_run_id,
                    consumer_id=self.consumer_id,
                    processed_at=datetime.now(timezone.utc)
                )
                session.add(proc)
                await session.commit()
                return False  # Not already processed; successfully registered
            except IntegrityError:
                await session.rollback()
                logger.info(f"Duplicate message detected: event_id {event_id} already processed.")
                return True

    async def process_message(self, message: QueueMessage) -> bool:
        """Processes a single queue message with strict idempotency and error handling."""
        body = message.body
        event_id_str = body.get("event_id")
        search_run_id_str = body.get("search_run_id")
        query = body.get("query")
        parsed_query = body.get("parsed_query", {})
        providers = body.get("providers", ["exa", "brave"])
        trace_id = body.get("trace_id")

        if not event_id_str or not search_run_id_str or not query:
            logger.error(f"Malformed queue message payload in message {message.id}: {body}")
            await self.queue_client.send_to_dlq(message, "Malformed message payload missing required keys")
            await self.queue_client.acknowledge_message(message.id)
            return True

        try:
            event_id = uuid.UUID(event_id_str)
            search_run_id = uuid.UUID(search_run_id_str)
        except ValueError as e:
            logger.error(f"Invalid UUID in message {message.id}: {e}")
            await self.queue_client.send_to_dlq(message, f"Invalid UUID: {e}")
            await self.queue_client.acknowledge_message(message.id)
            return True

        # 1. Idempotency Check
        if await self._is_already_processed(event_id, search_run_id):
            logger.info(f"Acknowledging duplicate message {message.id} without re-execution.")
            await self.queue_client.acknowledge_message(message.id)
            return True

        # 2. Execute Search Workflow
        try:
            await search_orchestrator.execute_search(
                search_run_id=search_run_id,
                query=query,
                parsed_query=parsed_query,
                requested_providers=providers,
                trace_id=trace_id
            )

            # 3. Durable processing succeeded -> Acknowledge message
            await self.queue_client.acknowledge_message(message.id)
            logger.info(f"Successfully processed and acknowledged message {message.id} (search {search_run_id})")
            return True

        except Exception as exc:
            logger.error(f"Failed processing search job {search_run_id} (attempt {message.attempts}): {exc}", exc_info=True)

            # Check if retry limit exceeded
            if message.attempts >= settings.CONSUMER_MAX_RETRIES:
                await self.queue_client.send_to_dlq(message, f"Exceeded max retries ({settings.CONSUMER_MAX_RETRIES}): {exc}")
                await self.queue_client.acknowledge_message(message.id)
            else:
                # Let message visibility timeout expire so Cloudflare redelivers
                logger.info(f"Leaving message {message.id} unacknowledged for retry (attempt {message.attempts})")

            return False

    async def start(self):
        """Adaptive polling loop pulling messages continuously until shutdown."""
        self.running = True
        logger.info(f"Starting Python pull consumer '{self.consumer_id}'...")

        current_poll_interval = settings.CONSUMER_POLL_INTERVAL_SECONDS
        max_poll_interval = 10.0

        while self.running and not self._shutdown_event.is_set():
            try:
                messages = await self.queue_client.pull_messages(
                    batch_size=settings.CONSUMER_MAX_BATCH_SIZE,
                    visibility_timeout=settings.CONSUMER_VISIBILITY_TIMEOUT_SECONDS
                )

                if messages:
                    logger.info(f"Consumer pulled {len(messages)} messages from queue.")
                    # Reset backoff to base interval when work is present
                    current_poll_interval = settings.CONSUMER_POLL_INTERVAL_SECONDS

                    for msg in messages:
                        if not self.running:
                            break
                        await self.process_message(msg)
                else:
                    # Adaptive backoff when no messages are available to prevent busy loops
                    current_poll_interval = min(current_poll_interval * 1.5, max_poll_interval)

                await asyncio.sleep(current_poll_interval)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Unexpected error in consumer loop: {exc}", exc_info=True)
                await asyncio.sleep(current_poll_interval)

        logger.info(f"Consumer '{self.consumer_id}' has cleanly shut down.")

    def stop(self):
        """Signals the consumer to gracefully stop after completing in-flight messages."""
        logger.info(f"Shutdown requested for consumer '{self.consumer_id}'...")
        self.running = False
        self._shutdown_event.set()


async def main():
    consumer = SearchJobConsumer()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, consumer.stop)
        except NotImplementedError:
            pass  # Windows compatibility

    await consumer.start()


if __name__ == "__main__":
    asyncio.run(main())
