/**
 * API Client
 *
 * HTTP client for communicating with the Traffical Control Plane API.
 */

import { getAccessToken, getApiBase } from "./auth.ts";
import type {
  ApiOrganization,
  ApiProject,
  ApiNamespace,
  ApiParameter,
  ApiEventDefinition,
  ApiPropertyGroup,
  ApiMetricDefinition,
  SyncRequest,
  SyncResponse,
  EventSyncRequest,
  EventSyncResponse,
  PropertyGroupSyncRequest,
  PropertyGroupSyncResponse,
  MetricSyncRequest,
  MetricSyncResponse,
  BulkParameterResponse,
} from "./types.ts";

/**
 * CLI Exit Codes
 *
 * Standard codes for consistent CLI behavior and scripting/CI integration.
 */
export const EXIT_SUCCESS = 0;
export const EXIT_VALIDATION_ERROR = 1;
export const EXIT_AUTH_ERROR = 2;
export const EXIT_NETWORK_ERROR = 3;

/** Repo is not linked to a Traffical project (.traffical/project.yaml missing) */
export const EXIT_NOT_LINKED = 4;

/** Config drift detected between local and remote (for status command) */
export const EXIT_DRIFT_DETECTED = 10;

/** Experiment needs attention (low traffic, failed policies, etc.) */
export const EXIT_EXPERIMENT_ATTENTION = 11;

/**
 * Base class for CLI errors with exit codes.
 *
 * `code` is a stable machine-readable identifier (snake_case) — independent
 * of the exit code, which classifies the error broadly. Agents should switch
 * on `code` for handling, not `message`.
 */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public code: string = "error",
    public hint?: string,
    /** Optional structured payload (e.g. the choices that resolve the error). */
    public details?: unknown,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Validation error (exit code 1)
 */
export class ValidationError extends CliError {
  constructor(message: string, hint?: string, details?: unknown) {
    super(message, EXIT_VALIDATION_ERROR, "validation_error", hint, details);
    this.name = "ValidationError";
  }
}

/**
 * Authentication error (exit code 2)
 */
export class AuthError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT_AUTH_ERROR, "auth_error", hint ?? "Run 'traffical login' or set TRAFFICAL_API_KEY.");
    this.name = "AuthError";
  }
}

/**
 * Network/API error (exit code 3)
 */
export class NetworkError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT_NETWORK_ERROR, "network_error", hint);
    this.name = "NetworkError";
  }
}

/**
 * Repo not linked to a Traffical project (exit code 4).
 */
export class NotLinkedError extends CliError {
  constructor(message?: string) {
    super(
      message ?? "This repo is not linked to a Traffical project.",
      EXIT_NOT_LINKED,
      "not_linked",
      "Run 'traffical init' or 'traffical link' to link this repo."
    );
    this.name = "NotLinkedError";
  }
}

/**
 * Drift detected error (exit code 10)
 * Used when local config differs from remote.
 */
export class DriftError extends CliError {
  constructor(message: string) {
    super(message, EXIT_DRIFT_DETECTED, "drift_detected");
    this.name = "DriftError";
  }
}

/**
 * Experiment needs attention (exit code 11)
 * Used when an experiment has issues (low traffic, failed policies, etc.)
 */
export class ExperimentAttentionError extends CliError {
  constructor(message: string) {
    super(message, EXIT_EXPERIMENT_ATTENTION, "experiment_attention");
    this.name = "ExperimentAttentionError";
  }
}

export interface ApiClientOptions {
  profile?: string;
  apiKey?: string;
  apiBase?: string;
}

/**
 * API Client for Traffical Control Plane
 */
export class ApiClient {
  private apiKey: string;
  private apiBase: string;

  private constructor(apiKey: string, apiBase: string) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
  }

  /**
   * Create an API client instance.
   * Credentials are resolved in priority order:
   * 1. options.apiKey / options.apiBase (command-line flags)
   * 2. TRAFFICAL_API_KEY / TRAFFICAL_API_BASE env vars
   * 3. Profile from ~/.trafficalrc
   */
  static async create(options: ApiClientOptions = {}): Promise<ApiClient> {
    let apiKey: string;
    try {
      apiKey = await getAccessToken({
        profile: options.profile,
        apiKey: options.apiKey,
        apiBase: options.apiBase,
      });
    } catch (err) {
      throw new AuthError(err instanceof Error ? err.message : String(err));
    }
    const apiBase = await getApiBase(options.profile, options.apiBase);
    return new ApiClient(apiKey, apiBase);
  }

  /**
   * Make an authenticated request to the API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiBase}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Network error (DNS, connection refused, etc.)
      const message = err instanceof Error ? err.message : String(err);
      throw new NetworkError(`Network error: ${message}`);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
      const message = error.error?.message || `API request failed: ${response.status} ${response.statusText}`;

      // Classify error by status code
      if (response.status === 401 || response.status === 403) {
        throw new AuthError(message);
      } else if (response.status >= 500) {
        throw new NetworkError(message);
      } else {
        // 4xx errors (except auth) are typically validation errors
        throw new ValidationError(message);
      }
    }

    return response.json() as Promise<T>;
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Validate the API key and get auth info.
   * For user auth, returns email. For API key auth, returns orgId/projectId.
   */
  async validateKey(): Promise<{ 
    valid: boolean; 
    email?: string;
    authType?: 'user' | 'apikey';
    orgId?: string;
    projectId?: string;
  }> {
    try {
      const result = await this.request<{
        user?: { email: string };
        authType?: string;
        orgId?: string;
        projectId?: string;
      }>("GET", "/v1/auth/me");
      
      if (result.authType === 'apikey') {
        return {
          valid: true,
          authType: 'apikey',
          orgId: result.orgId,
          projectId: result.projectId,
        };
      }
      
      return {
        valid: true,
        authType: 'user',
        email: result.user?.email,
      };
    } catch {
      return { valid: false };
    }
  }

  /**
   * List organizations the user has access to.
   */
  async listOrganizations(): Promise<ApiOrganization[]> {
    const result = await this.request<{ organizations: ApiOrganization[] }>(
      "GET",
      "/v1/auth/me/orgs"
    );
    return result.organizations;
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  /**
   * List projects for an organization.
   */
  async listProjects(orgId: string): Promise<ApiProject[]> {
    const result = await this.request<{ data: ApiProject[] }>(
      "GET",
      `/v1/orgs/${orgId}/projects`
    );
    return result.data;
  }

  /**
   * Get a project by ID.
   */
  async getProject(projectId: string): Promise<ApiProject> {
    const result = await this.request<{ project: ApiProject }>(
      "GET",
      `/v1/projects/${projectId}`
    );
    return result.project;
  }

  /**
   * Create a new project under an organization.
   */
  async createProject(
    orgId: string,
    data: { key: string; name: string; description?: string }
  ): Promise<ApiProject> {
    const result = await this.request<{ project: ApiProject } | ApiProject>(
      "POST",
      `/v1/orgs/${orgId}/projects`,
      data
    );
    // Endpoint returns the project either directly or wrapped under `.project`.
    return ("project" in (result as Record<string, unknown>))
      ? (result as { project: ApiProject }).project
      : (result as ApiProject);
  }

  /**
   * Get organization by ID.
   */
  async getOrganization(orgId: string): Promise<ApiOrganization> {
    const result = await this.request<{ org: ApiOrganization }>(
      "GET",
      `/v1/orgs/${orgId}`
    );
    return result.org;
  }

  // ==========================================================================
  // Parameters
  // ==========================================================================

  /**
   * List parameters for a project.
   */
  async listParameters(
    projectId: string,
    options?: { synced?: boolean }
  ): Promise<ApiParameter[]> {
    let path = `/v1/projects/${projectId}/parameters?limit=1000`;
    if (options?.synced !== undefined) {
      path += `&synced=${options.synced}`;
    }
    const result = await this.request<{ data: ApiParameter[] }>("GET", path);
    return result.data;
  }

  /**
   * List namespaces for a project.
   */
  async listNamespaces(projectId: string): Promise<ApiNamespace[]> {
    const result = await this.request<{ data: ApiNamespace[] }>(
      "GET",
      `/v1/projects/${projectId}/namespaces`
    );
    return result.data;
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  /**
   * Sync parameters from a config file.
   */
  async syncParameters(projectId: string, request: SyncRequest): Promise<SyncResponse> {
    return this.request<SyncResponse>("POST", `/v1/projects/${projectId}/sync`, request);
  }

  // ==========================================================================
  // Bulk Parameter Operations
  // ==========================================================================

  async bulkUpdateParameters(
    projectId: string,
    data: {
      action: "move_layer" | "archive" | "unarchive" | "change_namespace";
      parameterIds: string[];
      targetLayerId?: string;
      targetNamespaceId?: string;
    },
    dryRun: boolean = false
  ): Promise<BulkParameterResponse> {
    return this.request<BulkParameterResponse>(
      "POST",
      `/v1/projects/${projectId}/parameters/bulk${dryRun ? "?dryRun=true" : ""}`,
      data
    );
  }

  // ==========================================================================
  // Event Definitions
  // ==========================================================================

  /**
   * List event definitions for a project.
   */
  async listEventDefinitions(
    projectId: string,
    options?: { synced?: boolean; discovered?: boolean }
  ): Promise<ApiEventDefinition[]> {
    let path = `/v1/projects/${projectId}/events?limit=1000`;
    if (options?.synced !== undefined) {
      path += `&synced=${options.synced}`;
    }
    if (options?.discovered !== undefined) {
      path += `&discovered=${options.discovered}`;
    }
    const result = await this.request<{ data: ApiEventDefinition[] }>("GET", path);
    return result.data;
  }

  /**
   * Sync event definitions from a config file.
   */
  async syncEventDefinitions(projectId: string, request: EventSyncRequest): Promise<EventSyncResponse> {
    return this.request<EventSyncResponse>("POST", `/v1/projects/${projectId}/events/sync`, request);
  }

  // ==========================================================================
  // Property Groups
  // ==========================================================================

  /**
   * List property groups for a project.
   */
  async listPropertyGroups(projectId: string): Promise<ApiPropertyGroup[]> {
    const result = await this.request<{ data: ApiPropertyGroup[] }>(
      "GET", `/v1/projects/${projectId}/property-groups?limit=1000`
    );
    return result.data;
  }

  /**
   * Sync property groups from a config file.
   */
  async syncPropertyGroups(
    projectId: string,
    request: PropertyGroupSyncRequest
  ): Promise<PropertyGroupSyncResponse> {
    return this.request<PropertyGroupSyncResponse>(
      "POST", `/v1/projects/${projectId}/property-groups/sync`, request
    );
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * List metric definitions for a project.
   */
  async listMetrics(
    projectId: string,
    options?: { synced?: boolean }
  ): Promise<ApiMetricDefinition[]> {
    let url = `/v1/projects/${projectId}/metrics?limit=1000`;
    if (options?.synced !== undefined) {
      url += `&synced=${options.synced}`;
    }
    const result = await this.request<{ data: ApiMetricDefinition[] }>("GET", url);
    return result.data;
  }

  /**
   * List fact definitions for a project.
   */
  async listFactDefinitions(
    projectId: string,
    options?: { status?: string }
  ): Promise<Array<{ id: string; name: string }>> {
    let url = `/v1/projects/${projectId}/fact-definitions?limit=500`;
    if (options?.status) url += `&status=${options.status}`;
    const result = await this.request<{ data: Array<{ id: string; name: string }> }>("GET", url);
    return result.data;
  }

  /**
   * Sync metrics from a config file (metrics.yaml).
   */
  async syncMetrics(projectId: string, request: MetricSyncRequest): Promise<MetricSyncResponse> {
    return this.request<MetricSyncResponse>("POST", `/v1/projects/${projectId}/metrics/sync`, request);
  }

  // ==========================================================================
  // API Keys
  // ==========================================================================

  /**
   * Create an API key for an organization.
   * Requires mgmt:write scope on the calling key.
   */
  async createApiKey(orgId: string, options: {
    name: string;
    projectId?: string;
    scopes: string[];
  }): Promise<{ key: string; apiKey: { id: string; name: string; keyPrefix: string; scopes: string[] } }> {
    return this.request("POST", `/v1/orgs/${orgId}/api-keys`, {
      name: options.name,
      projectId: options.projectId,
      scopes: options.scopes,
    });
  }
}

