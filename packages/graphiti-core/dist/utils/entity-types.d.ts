/**
 * Entity type validation — port of Python's graphiti_core/utils/ontology_utils/entity_types_utils.py.
 */
/**
 * Validate that custom entity type field names don't conflict with
 * reserved EntityNode field names.
 *
 * @param fieldNames - Array of field names from the custom entity type
 * @returns true if valid
 * @throws EntityTypeValidationError if a field name conflicts
 */
export declare function validateEntityTypes(fieldNames: string[]): boolean;
/**
 * Validate that excluded entity type names are valid identifiers.
 */
export declare function validateExcludedEntityTypes(typeNames: string[]): boolean;
