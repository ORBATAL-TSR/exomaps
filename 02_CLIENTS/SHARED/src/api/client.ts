/**
 * ExoMaps API client — platform-agnostic HTTP client factory.
 *
 * Each client platform (web, desktop, mobile) provides its own
 * base URL and optional transport overrides. The shared client
 * handles retry, timeout, and typed responses.
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  SystemsResponse,
  FullSystemsResponse,
  ConfidenceResponse,
  PlanetarySystemResponse,
  PlanetSummaryResponse,
  SystemGroupResponse,
} from '../types/api';
import type {
  PersonaResponse,
  RunsManifestResponse,
  ValidationResponse,
  HealthResponse,
} from '../types/persona';

/* ── Client factory ────────────────────────────────── */

export interface ApiClientConfig {
  baseURL: string;             // e.g. '/api' (web), 'http://localhost:5000/api' (desktop)
  timeout?: number;
  withCredentials?: boolean;
  headers?: Record<string, string>;
}

const DEFAULT_CONFIG: Partial<ApiClientConfig> = {
  timeout: 10_000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
};

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  return axios.create({ ...DEFAULT_CONFIG, ...config } as AxiosRequestConfig);
}

/* ── Typed endpoint functions ──────────────────────── */

export class ExoMapsApi {
  private client: AxiosInstance;

  constructor(config: ApiClientConfig) {
    this.client = createApiClient(config);
  }

  /* ── Persona ─────────────────────────────────────── */

  async getPersona(): Promise<PersonaResponse> {
    const { data } = await this.client.get<PersonaResponse>('/persona');
    return data;
  }

  async switchPersona(role: string): Promise<void> {
    await axios.get(`${this.client.defaults.baseURL}/../demo/persona`, {
      params: { role, next: '/' },
      withCredentials: true,
      maxRedirects: 0,
      validateStatus: (s: number) => s < 400,
    });
  }

  /* ── World / Star Systems ────────────────────────── */

  async getSystems(): Promise<SystemsResponse> {
    const { data } = await this.client.get<SystemsResponse>('/world/systems');
    return data;
  }

  async getSystemsXYZ(): Promise<SystemsResponse> {
    const { data } = await this.client.get<SystemsResponse>('/world/systems/xyz');
    return data;
  }

  async getSystemsFull(): Promise<FullSystemsResponse> {
    const { data } = await this.client.get<FullSystemsResponse>('/world/systems/full');
    return data;
  }

  async getConfidence(): Promise<ConfidenceResponse> {
    const { data } = await this.client.get<ConfidenceResponse>('/world/confidence');
    return data;
  }

  /* ── Planetary System Detail ─────────────────────── */

  async getSystemDetail(mainId: string): Promise<PlanetarySystemResponse> {
    const { data } = await this.client.get<PlanetarySystemResponse>(
      `/system/${encodeURIComponent(mainId)}`
    );
    return data;
  }

  async getPlanetSummary(): Promise<PlanetSummaryResponse> {
    const { data } = await this.client.get<PlanetSummaryResponse>('/systems/planets/summary');
    return data;
  }

  async getSystemGroup(groupName: string): Promise<SystemGroupResponse> {
    const { data } = await this.client.get<SystemGroupResponse>(
      `/system-group/${encodeURIComponent(groupName)}`
    );
    return data;
  }

  /* ── Runs / Pipeline ─────────────────────────────── */

  async getRunsManifest(limit = 50): Promise<RunsManifestResponse> {
    const { data } = await this.client.get<RunsManifestResponse>('/runs/manifest', {
      params: { limit },
    });
    return data;
  }

  async getRunValidation(runId: string): Promise<ValidationResponse> {
    const { data } = await this.client.get<ValidationResponse>(`/runs/validation/${runId}`);
    return data;
  }

  /* ── Simulation ──────────────────────────────────── */

  async getSimSnapshot(runId: string) {
    const { data } = await this.client.get(`/simulation/${runId}/snapshot`);
    return data;
  }

  async simPause(runId: string) {
    const { data } = await this.client.post(`/simulation/${runId}/pause`);
    return data;
  }

  async simResume(runId: string) {
    const { data } = await this.client.post(`/simulation/${runId}/resume`);
    return data;
  }

  async simStep(runId: string, interval = 1) {
    const { data } = await this.client.post(`/simulation/${runId}/step`, null, {
      params: { interval },
    });
    return data;
  }

  /* ── Health ──────────────────────────────────────── */

  async getHealth(): Promise<HealthResponse> {
    const { data } = await this.client.get<HealthResponse>('/health');
    return data;
  }

  /* ── Campaigns & Exploration (Fog-of-War) ────────── */

  async createCampaign(name: string, seed?: number, settings?: Record<string, unknown>) {
    const { data } = await this.client.post('/campaigns', { name, seed, settings });
    return data;
  }

  async listCampaigns(status: 'active' | 'paused' | 'archived' = 'active') {
    const { data } = await this.client.get('/campaigns', { params: { status } });
    return data;
  }

  async getCampaign(campaignId: string) {
    const { data } = await this.client.get(`/campaigns/${campaignId}`);
    return data;
  }

  async updateCampaign(campaignId: string, updates: Record<string, unknown>) {
    const { data } = await this.client.patch(`/campaigns/${campaignId}`, updates);
    return data;
  }

  async deleteCampaign(campaignId: string) {
    const { data } = await this.client.delete(`/campaigns/${campaignId}`);
    return data;
  }

  async getCampaignMap(campaignId: string, minScanLevel = 1) {
    const { data } = await this.client.get(`/campaigns/${campaignId}/map`, {
      params: { scan_level: minScanLevel },
    });
    return data;
  }

  async exploreSystem(campaignId: string, systemId: string, body?: {
    explored_by?: string;
    scan_level?: 1 | 2 | 3;
    notes?: string;
  }) {
    const { data } = await this.client.post(
      `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}/explore`,
      body ?? {},
    );
    return data;
  }

  async getExploration(campaignId: string, systemId: string) {
    const { data } = await this.client.get(
      `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}`,
    );
    return data;
  }

  async bakePlanet(campaignId: string, systemId: string, planetIndex: number, body: Record<string, unknown>) {
    const { data } = await this.client.post(
      `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}/planets/${planetIndex}/bake`,
      body,
    );
    return data;
  }

  async getPlanetTextures(campaignId: string, planetKey: string) {
    const { data } = await this.client.get(
      `/campaigns/${campaignId}/planets/${encodeURIComponent(planetKey)}/textures`,
    );
    return data;
  }

  async listFactions(campaignId: string) {
    const { data } = await this.client.get(`/campaigns/${campaignId}/factions`);
    return data;
  }

  async createFaction(campaignId: string, name: string, color?: string, homeSystemId?: string) {
    const { data } = await this.client.post(`/campaigns/${campaignId}/factions`, {
      name, color, home_system_id: homeSystemId,
    });
    return data;
  }
}

/** Convenience: create a pre-configured API instance */
export function createApi(baseURL: string): ExoMapsApi {
  return new ExoMapsApi({ baseURL });
}
