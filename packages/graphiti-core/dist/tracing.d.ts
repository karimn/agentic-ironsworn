export interface TracerSpan {
    addAttributes(attributes: Record<string, unknown>): void;
    setStatus(status: 'ok' | 'error' | string, description?: string | null): void;
    recordException(exception: Error): void;
}
export interface TracerScope<TSpan extends TracerSpan = TracerSpan> {
    span: TSpan;
    close(): void;
}
export interface Tracer {
    startSpan(name: string): TracerScope;
}
export declare class NoOpSpan implements TracerSpan {
    addAttributes(_attributes: Record<string, unknown>): void;
    setStatus(_status: 'ok' | 'error' | string, _description?: string | null): void;
    recordException(_exception: Error): void;
}
export declare class NoOpTracer implements Tracer {
    startSpan(_name: string): TracerScope<NoOpSpan>;
}
/**
 * OpenTelemetry span wrapper — port of Python's OpenTelemetrySpan.
 *
 * Wraps an OTEL Span object (from @opentelemetry/api) and silently
 * catches all tracing errors to avoid disrupting the main application.
 *
 * Usage:
 *   import { trace } from '@opentelemetry/api';
 *   const tracer = new OpenTelemetryTracer(trace.getTracer('graphiti'));
 */
export declare class OpenTelemetrySpan implements TracerSpan {
    private readonly _span;
    constructor(_span: {
        setAttribute(key: string, value: string | number | boolean): void;
        setAttributes?(attributes: Record<string, string | number | boolean>): void;
        setStatus(status: {
            code: number;
            message?: string;
        }): void;
        recordException(exception: Error): void;
        end(): void;
    });
    addAttributes(attributes: Record<string, unknown>): void;
    setStatus(status: 'ok' | 'error' | string, description?: string | null): void;
    recordException(exception: Error): void;
}
/**
 * OpenTelemetry tracer wrapper — port of Python's OpenTelemetryTracer.
 *
 * Wraps an OTEL Tracer (from @opentelemetry/api) with configurable span
 * name prefix. Falls back to NoOp on any error.
 */
export declare class OpenTelemetryTracer implements Tracer {
    private readonly _tracer;
    private readonly _prefix;
    constructor(otelTracer: {
        startSpan(name: string): {
            setAttribute(key: string, value: string | number | boolean): void;
            setAttributes?(attributes: Record<string, string | number | boolean>): void;
            setStatus(status: {
                code: number;
                message?: string;
            }): void;
            recordException(exception: Error): void;
            end(): void;
        };
    }, spanPrefix?: string);
    startSpan(name: string): TracerScope<OpenTelemetrySpan>;
}
export declare function createTracer(otelTracer?: Tracer | null): Tracer;
