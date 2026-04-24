/**
 * CLI Type Definitions
 */

/** Parameter types supported by Traffical */
export type ParameterType = "string" | "number" | "boolean" | "json";

/** Event value types supported by Traffical */
export type EventValueType = "currency" | "count" | "rate" | "boolean";

/** Runtime value for a parameter */
export type ParameterValue = string | number | boolean | Record<string, unknown>;

/**
 * traffical.yaml config file schema
 */
export interface TrafficalConfig {
  version: "1.0";
  project: {
    id: string;
    orgId: string;
  };
  parameters: Record<string, ConfigParameter>;
  namespaces?: Record<string, {
    description?: string;
    parameters: Record<string, ConfigParameter>;
  }>;
  events?: Record<string, ConfigEvent>;
  propertyGroups?: Record<string, ConfigPropertyGroup>;
}

/**
 * Optional constraints for parameter values.
 */
export interface ParameterConstraints {
  /** For numbers: minimum value */
  min?: number;
  /** For numbers: maximum value */
  max?: number;
  /** For strings: regex pattern */
  pattern?: string;
  /** For strings/numbers: allowed values (enum) */
  allowedValues?: ParameterValue[];
}

/**
 * Parameter definition in traffical.yaml
 */
export interface ConfigParameter {
  type: ParameterType;
  default: ParameterValue;
  namespace?: string;
  description?: string;
  constraints?: ParameterConstraints;
}

/** Schema enforcement modes for event property validation */
export type EventSchemaEnforcement = "off" | "warn" | "reject";

/**
 * Property field definition in the Traffical YAML DSL.
 * Compiled to JSON Schema draft-07 internally.
 */
export interface ConfigPropertyField {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  required?: boolean;
  description?: string;
  enum?: (string | number | boolean)[];
  pattern?: string;
  format?: "date-time" | "email" | "uri" | "uuid";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  examples?: unknown[];
  dimension?: boolean;
  measure?: boolean;
  measureDisplayName?: string;
  desiredDirection?: "increase" | "decrease";
  warehouseType?: string;
  items?: ConfigPropertyField;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, ConfigPropertyField>;
  additionalProperties?: boolean;
}

/**
 * Reusable property group in traffical.yaml
 */
export interface ConfigPropertyGroup {
  description?: string;
  schemaVersion?: string;
  properties: Record<string, ConfigPropertyField>;
}

/**
 * Event definition in traffical.yaml
 */
export interface ConfigEvent {
  valueType: EventValueType;
  unit?: string;
  description?: string;
  properties?: Record<string, ConfigPropertyField>;
  propertyGroups?: string[];
  schemaVersion?: string;
  schemaEnforcement?: EventSchemaEnforcement;
}

/**
 * API parameter response
 */
export interface ApiParameter {
  id: string;
  projectId: string;
  namespaceId: string;
  layerId: string;
  key: string;
  type: ParameterType;
  defaultValue: ParameterValue;
  description?: string;
  constraints?: ParameterConstraints;
  synced?: boolean;
  syncedSource?: string;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Sync request payload
 */
export interface SyncRequest {
  parameters: Array<{
    key: string;
    type: ParameterType;
    default: ParameterValue;
    namespace?: string;
    description?: string;
    constraints?: ParameterConstraints;
  }>;
  source?: string;
}

/**
 * Sync response
 */
export interface SyncResponse {
  created: Array<{ key: string; id: string }>;
  updated: Array<{ key: string; id: string }>;
  unchanged: Array<{ key: string; id: string }>;
  remoteOnly: Array<{
    key: string;
    id: string;
    type: ParameterType;
    defaultValue: ParameterValue;
    namespace?: string;
    description?: string;
    constraints?: ParameterConstraints;
  }>;
  summary: {
    totalInConfig: number;
    created: number;
    updated: number;
    unchanged: number;
    remoteOnly: number;
  };
  warnings?: string[];
}

/**
 * API Organization
 */
export interface ApiOrganization {
  id: string;
  key: string;
  name: string;
  workosOrgId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * API Project
 */
export interface ApiProject {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description?: string;
  environments: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * API Namespace
 */
export interface ApiNamespace {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ~/.trafficalrc profile config
 */
export interface TrafficalRc {
  default_profile?: string;
  profiles: Record<string, ProfileConfig>;
}

/**
 * Profile configuration
 */
export interface ProfileConfig {
  api_key: string;
  api_base?: string;
}

/**
 * Status result for a project
 */
export interface StatusResult {
  project: {
    id: string;
    key: string;
    name: string;
  };
  org: {
    id: string;
    key: string;
    name: string;
  };
  synced: Array<{
    key: string;
    id: string;
    type: ParameterType;
    defaultValue: ParameterValue;
    namespace?: string;
  }>;
  dashboardOnly: Array<{
    key: string;
    id: string;
    type: ParameterType;
    defaultValue: ParameterValue;
    namespace?: string;
    createdAt: string;
  }>;
  localOnly: Array<{
    key: string;
    type: ParameterType;
    default: ParameterValue;
    namespace?: string;
  }>;
}

/**
 * API Event Definition response
 */
export interface ApiEventDefinition {
  id: string;
  projectId: string;
  name: string;
  valueType: EventValueType;
  unit?: string;
  description?: string;
  propertySchema?: EventPropertySchema;
  propertyGroupRefs?: string[];
  schemaVersion?: string;
  schemaEnforcement?: EventSchemaEnforcement;
  synced: boolean;
  syncedSource?: string;
  syncedAt?: string;
  discovered: boolean;
  discoveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Event sync request payload
 */
export interface EventSyncRequest {
  events: Array<{
    name: string;
    valueType: EventValueType;
    unit?: string;
    description?: string;
    propertySchema?: EventPropertySchema;
    propertyGroupRefs?: string[];
    schemaVersion?: string;
    schemaEnforcement?: EventSchemaEnforcement;
  }>;
  source?: string;
}

/**
 * Event sync response
 */
export interface EventSyncResponse {
  created: Array<{ name: string; id: string }>;
  updated: Array<{ name: string; id: string }>;
  unchanged: Array<{ name: string; id: string }>;
  remoteOnly: Array<{
    name: string;
    id: string;
    valueType: EventValueType;
    unit?: string;
    description?: string;
    discovered: boolean;
  }>;
  summary: {
    totalInConfig: number;
    created: number;
    updated: number;
    unchanged: number;
    remoteOnly: number;
  };
}

// =============================================================================
// Event Property Schema (JSON Schema subset — local mirror of control plane types)
// =============================================================================

/**
 * JSON Schema draft-07 subset for event property schemas.
 * This is the compiled/resolved form stored on EventDefinition.
 */
export interface EventPropertySchema {
  type: "object";
  properties?: Record<string, EventPropertySchemaField>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface EventPropertySchemaField {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: (string | number | boolean)[];
  pattern?: string;
  format?: "date-time" | "email" | "uri" | "uuid";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  examples?: unknown[];
  items?: EventPropertySchemaField;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, EventPropertySchemaField>;
  required?: string[];
  additionalProperties?: boolean;
  dimension?: boolean;
  measure?: boolean;
  measureDisplayName?: string;
  desiredDirection?: "increase" | "decrease";
  warehouseType?: string;
}

// =============================================================================
// Property Group API Types
// =============================================================================

export interface ApiPropertyGroup {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  schema: EventPropertySchemaField;
  schemaVersion?: string;
  managedBy?: string;
  synced: boolean;
  syncedSource?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyGroupSyncRequest {
  groups: Array<{
    name: string;
    description?: string;
    schema: EventPropertySchemaField;
    schemaVersion?: string;
  }>;
  source?: string;
}

export interface PropertyGroupSyncResponse {
  created: Array<{ name: string; id: string }>;
  updated: Array<{ name: string; id: string }>;
  unchanged: Array<{ name: string; id: string }>;
  summary: {
    totalInConfig: number;
    created: number;
    updated: number;
    unchanged: number;
  };
}

/**
 * Bulk parameter operations response
 */
export interface BulkParameterResponse {
  batchId: string;
  action: string;
  dryRun: boolean;
  valid: Array<{ id: string; key: string }>;
  blocked: Array<{
    id: string;
    key: string;
    reason: string;
    blockedBy?: { type: string; id: string; name: string };
  }>;
  warnings: Array<{ id: string; key: string; warning: string }>;
  succeeded?: Array<{ id: string; key: string }>;
  failed?: Array<{ id: string; key: string; error: string }>;
}

