export declare const DEFAULT_MAX_TOKENS = 16384;
export declare const DEFAULT_TEMPERATURE = 1;
export declare const ModelSizes: {
    readonly small: "small";
    readonly medium: "medium";
};
export type ModelSize = (typeof ModelSizes)[keyof typeof ModelSizes];
export interface LLMConfig {
    api_key: string | null;
    model: string | null;
    base_url: string | null;
    temperature: number;
    max_tokens: number;
    small_model: string | null;
}
export declare function createLLMConfig(overrides?: Partial<LLMConfig>): LLMConfig;
