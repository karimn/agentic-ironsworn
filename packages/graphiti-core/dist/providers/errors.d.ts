import { GraphitiError } from '@graphiti/shared';
export declare class RateLimitError extends GraphitiError {
    constructor(message?: string);
}
export declare class RefusalError extends GraphitiError {
    constructor(message: string);
}
export declare class EmptyResponseError extends GraphitiError {
    constructor(message?: string);
}
