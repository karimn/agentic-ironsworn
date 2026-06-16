export declare const MessageRoles: {
    readonly system: "system";
    readonly user: "user";
    readonly assistant: "assistant";
    readonly tool: "tool";
};
export type MessageRole = (typeof MessageRoles)[keyof typeof MessageRoles];
export interface Message {
    role: string;
    content: string;
}
export type PromptContext = Record<string, unknown>;
export type PromptFunction = (context: PromptContext) => Message[];
