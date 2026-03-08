/**
 * WebSocket wrapper for real-time world synchronization.
 *
 * Uses Socket.IO transport. Consumed by all clients that
 * need live simulation tick updates, cursor sharing, or
 * faction state broadcasts.
 *
 * NOTE: Stub — full implementation when 04_MESSAGING is built.
 */

export interface WorldSocketConfig {
  url: string;                    // e.g. 'ws://localhost:5000'
  namespace?: string;             // default: '/ws/world'
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export type WorldEventHandler = (payload: unknown) => void;

/**
 * Placeholder WebSocket client.
 * Will integrate with Socket.IO when the messaging service is ready.
 */
export class WorldSocket {
  private config: WorldSocketConfig;
  private handlers: Map<string, WorldEventHandler[]> = new Map();
  private connected = false;

  constructor(config: WorldSocketConfig) {
    this.config = {
      namespace: '/ws/world',
      reconnectAttempts: 5,
      reconnectDelay: 3000,
      ...config,
    };
  }

  /** Connect to the world state WebSocket */
  connect(): void {
    console.log(`[WorldSocket] Would connect to ${this.config.url}${this.config.namespace}`);
    // TODO: Implement with socket.io-client when 04_MESSAGING is ready
    this.connected = true;
  }

  /** Disconnect gracefully */
  disconnect(): void {
    this.connected = false;
    this.handlers.clear();
  }

  /** Subscribe to a world event type */
  on(event: string, handler: WorldEventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  /** Unsubscribe from a world event type */
  off(event: string, handler: WorldEventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, existing.filter(h => h !== handler));
  }

  /** Send a message to the server */
  emit(event: string, payload: unknown): void {
    if (!this.connected) {
      console.warn(`[WorldSocket] Not connected, cannot emit '${event}'`);
      return;
    }
    console.log(`[WorldSocket] Would emit '${event}'`, payload);
    // TODO: socket.emit(event, payload)
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
