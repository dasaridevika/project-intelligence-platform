import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict


class StructuredJSONFormatter(logging.Formatter):
    """Formats log records as structured single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        log_payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }

        # Include custom context attributes if present
        if hasattr(record, "trace_id"):
            log_payload["trace_id"] = record.trace_id
        if hasattr(record, "search_run_id"):
            log_payload["search_run_id"] = record.search_run_id
        if hasattr(record, "component"):
            log_payload["component"] = record.component
        if hasattr(record, "extra_data") and isinstance(record.extra_data, dict):
            log_payload.update(record.extra_data)

        if record.exc_info:
            log_payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_payload, default=str)


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configures structured JSON logging globally."""
    logger = logging.getLogger("project_intelligence")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Avoid duplicate handlers if called multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredJSONFormatter())
        logger.addHandler(handler)

    # Configure root logger with same formatter
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        root_handler = logging.StreamHandler(sys.stdout)
        root_handler.setFormatter(StructuredJSONFormatter())
        root_logger.addHandler(root_handler)
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    return logger


logger = setup_logging()
