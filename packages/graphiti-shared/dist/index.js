// src/errors.ts
class GraphitiError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

class EdgeNotFoundError extends GraphitiError {
  constructor(uuid) {
    super(`edge ${uuid} not found`);
  }
}

class EdgesNotFoundError extends GraphitiError {
  constructor(uuids) {
    super(`None of the edges for ${JSON.stringify(uuids)} were found.`);
  }
}

class GroupsEdgesNotFoundError extends GraphitiError {
  constructor(groupIds) {
    super(`no edges found for group ids ${JSON.stringify(groupIds)}`);
  }
}

class GroupsNodesNotFoundError extends GraphitiError {
  constructor(groupIds) {
    super(`no nodes found for group ids ${JSON.stringify(groupIds)}`);
  }
}

class NodeNotFoundError extends GraphitiError {
  constructor(uuid) {
    super(`node ${uuid} not found`);
  }
}

class SearchRerankerError extends GraphitiError {
  constructor(message) {
    super(message);
  }
}

class EntityTypeValidationError extends GraphitiError {
  constructor(entityType, entityTypeAttribute) {
    super(`${entityTypeAttribute} cannot be used as an attribute for ${entityType} as it is a protected attribute name.`);
  }
}

class GroupIdValidationError extends GraphitiError {
  constructor(groupId) {
    super(`group_id "${groupId}" must contain only alphanumeric characters, dashes, or underscores`);
  }
}

class NodeLabelValidationError extends GraphitiError {
  constructor(nodeLabels) {
    const labelList = nodeLabels.map((label) => `"${label}"`).join(", ");
    super("node_labels must start with a letter or underscore and contain only " + `alphanumeric characters or underscores: ${labelList}`);
  }
}
// src/graph.ts
var SAFE_CYPHER_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
var GROUP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
var GraphProviders = {
  NEO4J: "neo4j",
  FALKORDB: "falkordb"
};
// src/time.ts
function utcNow() {
  return new Date;
}
function ensureUtc(value) {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}
function toIsoString(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function convertDatesToIsoStrings(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertDatesToIsoStrings(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convertDatesToIsoStrings(item)]));
  }
  return value;
}
// src/validation.ts
function validateGroupId(groupId) {
  if (!groupId) {
    return true;
  }
  if (!GROUP_ID_PATTERN.test(groupId)) {
    throw new GroupIdValidationError(groupId);
  }
  return true;
}
function validateGroupIds(groupIds) {
  if (!groupIds) {
    return true;
  }
  for (const groupId of groupIds) {
    validateGroupId(groupId);
  }
  return true;
}
function validateNodeLabels(nodeLabels) {
  if (!nodeLabels || nodeLabels.length === 0) {
    return true;
  }
  const invalidLabels = nodeLabels.filter((label) => !SAFE_CYPHER_IDENTIFIER_PATTERN.test(label));
  if (invalidLabels.length > 0) {
    throw new NodeLabelValidationError(invalidLabels);
  }
  return true;
}
export {
  validateNodeLabels,
  validateGroupIds,
  validateGroupId,
  utcNow,
  toIsoString,
  ensureUtc,
  convertDatesToIsoStrings,
  SearchRerankerError,
  SAFE_CYPHER_IDENTIFIER_PATTERN,
  NodeNotFoundError,
  NodeLabelValidationError,
  GroupsNodesNotFoundError,
  GroupsEdgesNotFoundError,
  GroupIdValidationError,
  GraphitiError,
  GraphProviders,
  GROUP_ID_PATTERN,
  EntityTypeValidationError,
  EdgesNotFoundError,
  EdgeNotFoundError
};
