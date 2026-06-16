export interface RecordLike {
    get?(key: string): unknown;
    [key: string]: unknown;
}
export declare function getRecordValue<T = unknown>(record: RecordLike, key: string): T | undefined;
export declare function parseDateValue(value: unknown): Date | null;
