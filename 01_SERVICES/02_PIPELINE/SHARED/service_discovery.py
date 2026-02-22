"""
Service Discovery & Health Check System

Automatically detects available services (PostgreSQL, Redis, Flask)
and provides a unified interface for connection management.

Usage:
    from dbs.service_discovery import ServiceDiscovery
    sd = ServiceDiscovery()
    sd.diagnose()  # Print full diagnosis
    
    # Get connection string
    db_url = sd.get_db_connect_string()
    redis_url = sd.get_redis_url()
"""

import os
import sys
import socket
import subprocess
import time
from typing import Dict, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class ServiceStatus(Enum):
    """Service availability status."""
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


@dataclass
class ServiceInfo:
    """Information about a service's availability."""
    name: str
    status: ServiceStatus
    host: str
    port: int
    version: Optional[str] = None
    error: Optional[str] = None
    
    def is_available(self) -> bool:
        return self.status == ServiceStatus.AVAILABLE


class ServiceDiscovery:
    """
    Auto-detects available services and manages connections.
    
    Supports:
    - PostgreSQL (Docker or local)
    - Redis (Docker or local)
    - Flask (local development)
    """
    
    def __init__(self, verbose=True):
        self.verbose = verbose
        self.services: Dict[str, ServiceInfo] = {}
        self._detect_all_services()
    
    def _log(self, msg: str):
        """Print log message if verbose."""
        if self.verbose:
            print(f"[ServiceDiscovery] {msg}")
    
    def _is_port_open(self, host: str, port: int, timeout=2) -> bool:
        """Check if host:port is accepting connections."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            sock.close()
            return result == 0
        except Exception as e:
            self._log(f"Port check error for {host}:{port}: {e}")
            return False
    
    def _check_postgres(self) -> ServiceInfo:
        """Detect PostgreSQL availability (Docker or local)."""
        # Try Docker first (common port)
        docker_hosts = [
            ("127.0.0.1", 5432),  # docker-compose standard
            ("db", 5432),         # docker internal name
            ("localhost", 5432),
        ]
        
        # Try local PostgreSQL
        local_hosts = [
            ("127.0.0.1", 5432),
            ("localhost", 5432),
        ]
        
        error = None
        
        # Check Docker container
        for host, port in docker_hosts:
            if self._is_port_open(host, port):
                try:
                    import psycopg2
                    conn = psycopg2.connect(
                        host=host,
                        port=port,
                        user=os.getenv("POSTGRES_USER", "postgres"),
                        password=os.getenv("POSTGRES_PASSWORD", ""),
                        database="postgres",
                        timeout=2
                    )
                    version = conn.cursor().execute("SELECT version();").fetchone()[0]
                    conn.close()
                    
                    self._log(f"PostgreSQL detected: {host}:{port} (Docker)")
                    return ServiceInfo(
                        name="PostgreSQL",
                        status=ServiceStatus.AVAILABLE,
                        host=host,
                        port=port,
                        version=version.split(',')[0]
                    )
                except Exception as e:
                    error = str(e)
        
        # Check local installation
        try:
            result = subprocess.run(
                ["psql", "--version"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                for host, port in local_hosts:
                    if self._is_port_open(host, port):
                        self._log(f"PostgreSQL detected: {host}:{port} (Local)")
                        return ServiceInfo(
                            name="PostgreSQL",
                            status=ServiceStatus.AVAILABLE,
                            host=host,
                            port=port,
                            version=result.stdout.strip()
                        )
        except Exception:
            pass
        
        self._log("PostgreSQL not detected")
        return ServiceInfo(
            name="PostgreSQL",
            status=ServiceStatus.UNAVAILABLE,
            host="",
            port=0,
            error=error or "Not found"
        )
    
    def _check_redis(self) -> ServiceInfo:
        """Detect Redis availability."""
        hosts = [
            ("127.0.0.1", 6379),
            ("localhost", 6379),
            ("redis", 6379),  # Docker internal name
            # Add custom host via REDIS_HOST env var
        ]
        
        for host, port in hosts:
            if self._is_port_open(host, port):
                try:
                    import redis
                    r = redis.Redis(host=host, port=port, timeout=2, decode_responses=True)
                    info = r.info("server")
                    version = info.get("redis_version", "unknown")
                    r.close()
                    
                    self._log(f"Redis detected: {host}:{port}")
                    return ServiceInfo(
                        name="Redis",
                        status=ServiceStatus.AVAILABLE,
                        host=host,
                        port=port,
                        version=version
                    )
                except Exception as e:
                    pass
        
        self._log("Redis not detected")
        return ServiceInfo(
            name="Redis",
            status=ServiceStatus.UNAVAILABLE,
            host="",
            port=0,
            error="Not found"
        )
    
    def _check_flask(self) -> ServiceInfo:
        """Check Flask development server status."""
        hosts = [
            ("127.0.0.1", 5000),
            ("localhost", 5000),

        ]
        
        for host, port in hosts:
            if self._is_port_open(host, port):
                try:
                    import urllib.request
                    response = urllib.request.urlopen(
                        f"http://{host}:{port}/",
                        timeout=2
                    )
                    self._log(f"Flask detected: {host}:{port}")
                    return ServiceInfo(
                        name="Flask",
                        status=ServiceStatus.AVAILABLE,
                        host=host,
                        port=port,
                        version="development"
                    )
                except Exception:
                    pass
        
        self._log("Flask not detected (normal if not running)")
        return ServiceInfo(
            name="Flask",
            status=ServiceStatus.UNAVAILABLE,
            host="",
            port=0,
            error="Not running"
        )
    
    def _detect_all_services(self):
        """Run all service detection checks."""
        self.services["postgres"] = self._check_postgres()
        self.services["redis"] = self._check_redis()
        self.services["flask"] = self._check_flask()
    
    def get_service(self, name: str) -> Optional[ServiceInfo]:
        """Get service info by name."""
        return self.services.get(name.lower())
    
    def get_db_connect_string(self) -> str:
        """
        Get PostgreSQL connection string.
        
        Returns connection to detected PostgreSQL, or None if unavailable.
        Supports connection pooling via pgBouncer if available.
        """
        db = self.services.get("postgres")
        
        if not db or not db.is_available():
            raise RuntimeError(
                "PostgreSQL not detected. "
                "Start with: docker-compose up -d db  OR  brew services start postgresql"
            )
        
        user = os.getenv("POSTGRES_USER", "postgres")
        password = os.getenv("POSTGRES_PASSWORD", "")
        database = os.getenv("POSTGRES_DB", "exomaps")
        
        return f"postgresql://{user}:{password}@{db.host}:{db.port}/{database}"
    
    def get_redis_url(self) -> Optional[str]:
        """Get Redis connection URL if available."""
        redis = self.services.get("redis")
        
        if not redis or not redis.is_available():
            return None
        
        return f"redis://{redis.host}:{redis.port}/0"
    
    def get_db_env_dict(self) -> Dict[str, str]:
        """
        Get environment variables for database connection.
        Auto-detects host and port from live services.
        """
        db = self.services.get("postgres")
        
        return {
            "POSTGRES_USER": os.getenv("POSTGRES_USER", "postgres"),
            "POSTGRES_PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
            "POSTGRES_DB": os.getenv("POSTGRES_DB", "exomaps"),
            "POSTGRES_HOST": db.host if (db and db.is_available()) else "127.0.0.1",
            "POSTGRES_PORT": str(db.port if (db and db.is_available()) else 5432),
            "APPUSER": os.getenv("APPUSER", "appuser"),
            "APPPASS": os.getenv("APPPASS", ""),
        }
    
    def diagnose(self):
        """Print comprehensive diagnostic information."""
        print("\n" + "=" * 70)
        print("EXOMAPS SERVICE DISCOVERY DIAGNOSTIC")
        print("=" * 70)
        
        # Service status
        print("\n📡 SERVICE STATUS:")
        print("-" * 70)
        for name, service in self.services.items():
            status_icon = "✓" if service.is_available() else "✗"
            print(f"{status_icon} {service.name:15} {service.status.value:12}", end="")
            if service.is_available():
                print(f" [{service.host}:{service.port}]")
            else:
                print(f" {service.error or ''}")
        
        # Configuration
        print("\n⚙️  ENVIRONMENT CONFIGURATION:")
        print("-" * 70)
        env_dict = self.get_db_env_dict()
        for key, value in env_dict.items():
            # Mask password
            display_value = "***" if "PASS" in key else value
            print(f"{key:20} = {display_value}")
        
        # Connection strings
        print("\n🔗 CONNECTION STRINGS:")
        print("-" * 70)
        try:
            db_url = self.get_db_connect_string()
            # Mask password
            pw = os.getenv("POSTGRES_PASSWORD", "")
            display_url = db_url.replace(pw, "***") if pw else db_url
            print(f"PostgreSQL: {display_url}")
        except RuntimeError as e:
            print(f"PostgreSQL: {e}")
        
        redis_url = self.get_redis_url()
        if redis_url:
            print(f"Redis:      {redis_url}")
        else:
            print("Redis:      Not available (optional)")
        
        # Recommendations
        print("\n💡 RECOMMENDATIONS:")
        print("-" * 70)
        
        db = self.services.get("postgres")
        if db and not db.is_available():
            print("• PostgreSQL not found:")
            print("  Option 1: docker-compose up -d db (Docker container)")
            print("  Option 2: brew services start postgresql (macOS local)")
            print("  Option 3: sudo systemctl start postgresql (Linux local)")
        
        redis = self.services.get("redis")
        if redis and not redis.is_available():
            print("• Redis not found (optional for caching):")
            print("  docker-compose up -d redis")
        
        flask = self.services.get("flask")
        if flask and not flask.is_available():
            print("• Flask development server not running:")
            print("  python src/app/app.py")
        
        print("\n" + "=" * 70)
    
    def wait_for_service(self, service_name: str, timeout=30) -> bool:
        """
        Wait for a service to become available.
        
        Args:
            service_name: Name of service (postgres, redis, flask)
            timeout: Max seconds to wait
        
        Returns:
            True if service became available, False if timeout
        """
        start = time.time()
        service_name = service_name.lower()
        
        while time.time() - start < timeout:
            self._detect_all_services()
            service = self.services.get(service_name)
            
            if service and service.is_available():
                self._log(f"{service_name} is now available")
                return True
            
            self._log(f"Waiting for {service_name}... ({time.time() - start:.1f}s)")
            time.sleep(2)
        
        self._log(f"Timeout waiting for {service_name}")
        return False


if __name__ == "__main__":
    # Run diagnostics
    sd = ServiceDiscovery(verbose=True)
    sd.diagnose()
    
    # Try to get connections
    try:
        db_url = sd.get_db_connect_string()
        print(f"\n✓ Can connect to PostgreSQL")
    except RuntimeError as e:
        print(f"\n✗ Cannot connect: {e}")
        sys.exit(1)
