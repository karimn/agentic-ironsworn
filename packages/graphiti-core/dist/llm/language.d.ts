/**
 * Extraction language instruction — port of Python's get_extraction_language_instruction().
 */
/**
 * Returns instruction for multilingual extraction behavior.
 * Override this function to customize language extraction per group.
 *
 * @param groupId - Optional partition identifier for the graph
 * @returns Language instruction string to append to system messages
 */
export declare function getExtractionLanguageInstruction(_groupId?: string | null): string;
