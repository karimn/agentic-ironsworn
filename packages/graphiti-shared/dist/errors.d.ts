export declare class GraphitiError extends Error {
    constructor(message: string);
}
export declare class EdgeNotFoundError extends GraphitiError {
    constructor(uuid: string);
}
export declare class EdgesNotFoundError extends GraphitiError {
    constructor(uuids: string[]);
}
export declare class GroupsEdgesNotFoundError extends GraphitiError {
    constructor(groupIds: string[]);
}
export declare class GroupsNodesNotFoundError extends GraphitiError {
    constructor(groupIds: string[]);
}
export declare class NodeNotFoundError extends GraphitiError {
    constructor(uuid: string);
}
export declare class SearchRerankerError extends GraphitiError {
    constructor(message: string);
}
export declare class EntityTypeValidationError extends GraphitiError {
    constructor(entityType: string, entityTypeAttribute: string);
}
export declare class GroupIdValidationError extends GraphitiError {
    constructor(groupId: string);
}
export declare class NodeLabelValidationError extends GraphitiError {
    constructor(nodeLabels: string[]);
}
