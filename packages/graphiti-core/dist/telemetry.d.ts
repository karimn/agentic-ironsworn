/**
 * Telemetry module — port of Python's graphiti_core/telemetry/telemetry.py.
 *
 * Collects anonymous usage statistics via PostHog.
 * Telemetry can be disabled by setting GRAPHITI_TELEMETRY_ENABLED=false.
 */
export declare function isTelemetryEnabled(): boolean;
export declare function getAnonymousId(): string;
/**
 * Capture a telemetry event. Sends asynchronously via PostHog HTTP API.
 * Silently swallows all errors.
 */
export declare function captureEvent(eventName: string, properties?: Record<string, unknown>): void;
