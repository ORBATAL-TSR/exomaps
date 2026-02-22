"""
Structured logging utilities for ExoMaps pipeline.

Provides consistent logging across phases with JSON-serializable output format.
Usage:
  from dbs.logging_setup import get_logger
  logger = get_logger(__name__)
  logger.info("Phase 01 started", extra={"run_id": "run_123", "phase": 1})
"""

import json
import logging
import logging.handlers
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


class JSONFormatter(logging.Formatter):
    """Format log records as JSON for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add extra fields if present
        if hasattr(record, "run_id"):
            log_data["run_id"] = record.run_id
        if hasattr(record, "phase"):
            log_data["phase"] = record.phase
        if hasattr(record, "status"):
            log_data["status"] = record.status

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class PlainFormatter(logging.Formatter):
    """Format log records as human-readable text."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        level = record.levelname.ljust(8)

        extra_info = ""
        if hasattr(record, "run_id"):
            extra_info += f" [{record.run_id}]"
        if hasattr(record, "phase"):
            extra_info += f" [Phase {record.phase}]"

        message = record.getMessage()
        if record.exc_info:
            message += f"\n{self.formatException(record.exc_info)}"

        return f"{timestamp} {level} {record.name}{extra_info}: {message}"


def get_logger(name: str, level: str = "INFO") -> logging.Logger:
    """
    Get a configured logger instance.

    Args:
        name: Logger name (typically __name__)
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level))

    # Avoid duplicate handlers
    if logger.handlers:
        return logger

    # Console handler with plain formatter
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(PlainFormatter())
    logger.addHandler(console_handler)

    # File handler with JSON formatter (optional)
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / f"{name}.log",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
    )
    file_handler.setFormatter(JSONFormatter())
    logger.addHandler(file_handler)

    return logger


class PhaseLogger:
    """Context manager for phase execution logging."""

    def __init__(self, phase: int, description: str = "", run_id: Optional[str] = None):
        self.phase = phase
        self.description = description
        self.run_id = run_id
        self.logger = get_logger(f"phase_{phase}")
        self.start_time: Optional[datetime] = None

    def __enter__(self):
        self.start_time = datetime.utcnow()
        msg = f"Phase {self.phase}"
        if self.description:
            msg += f" - {self.description}"
        self.logger.info(
            msg + " started",
            extra={"phase": self.phase, "run_id": self.run_id, "status": "started"},
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.start_time:
            elapsed_seconds = (datetime.utcnow() - self.start_time).total_seconds()
            if exc_type:
                self.logger.error(
                    f"Phase {self.phase} failed after {elapsed_seconds:.1f}s: {exc_val}",
                    extra={
                        "phase": self.phase,
                        "run_id": self.run_id,
                        "status": "failed",
                        "elapsed_seconds": elapsed_seconds,
                    },
                )
            else:
                self.logger.info(
                    f"Phase {self.phase} completed in {elapsed_seconds:.1f}s",
                    extra={
                        "phase": self.phase,
                        "run_id": self.run_id,
                        "status": "completed",
                        "elapsed_seconds": elapsed_seconds,
                    },
                )
        return False  # Propagate exceptions

    def log_metric(self, metric_name: str, value: Any):
        """Log a metric with the current phase context."""
        self.logger.info(
            f"Metric: {metric_name}={value}",
            extra={
                "phase": self.phase,
                "run_id": self.run_id,
                "metric": metric_name,
                "value": value,
            },
        )


if __name__ == "__main__":
    # Example usage
    logger = get_logger(__name__, level="DEBUG")
    logger.debug("Debug message")
    logger.info("Info message")
    logger.warning("Warning message")
    logger.error("Error message")

    # Using PhaseLogger context manager
    with PhaseLogger(1, "Data Ingestion", run_id="run_001") as phase_log:
        logger.info("Processing started")
        phase_log.log_metric("rows_processed", 1000)
