# ─────────────────────────────────────────────────────────────────────────────
# Gunicorn config for ExoMaps Flask gateway
#
# Replaces `flask run` (single-threaded) with a real WSGI server.
# Multiple workers mean LAN clients don't queue behind each other.
# ─────────────────────────────────────────────────────────────────────────────

import multiprocessing

# Bind to localhost only — Caddy reverse-proxies from the LAN-facing port
bind = "127.0.0.1:5000"

# Workers: (2 × CPU cores) + 1 is the standard formula for I/O-bound apps.
# Flask/SQLAlchemy spends most of its time waiting on Postgres, so this scales well.
workers = (multiprocessing.cpu_count() * 2) + 1

# Threads per worker — additional concurrency within each worker process
threads = 2

# Gthread worker: uses threads, handles concurrent requests within one worker
# without the GIL bottleneck of pure sync workers for I/O-bound code
worker_class = "gthread"

# Keep connections alive for LAN clients — avoids TCP handshake on every request
keepalive = 30

# Graceful timeout — give long Postgres queries time to finish
timeout = 60
graceful_timeout = 30

# Logging — goes to stdout so run.sh can capture it
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s %(D)sµs'
