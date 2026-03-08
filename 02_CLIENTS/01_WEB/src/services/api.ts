import axios from 'axios';
import type {
  PersonaResponse,
  SystemsResponse,
  FullSystemsResponse,
  ConfidenceResponse,
  RunsManifestResponse,
  ValidationResponse,
  HealthResponse,
  PlanetarySystemResponse,
  PlanetSummaryResponse,
  SystemGroupResponse,
  Campaign,
  CampaignListResponse,
  CampaignMapResponse,
  ExploreSystemResponse,
  ExplorationDetail,
  FactionListResponse,
  Faction,
  SimInitResponse,
  SimTickResponse,
  SimSnapshotResponse,
} from '../types/api';

// In development, React dev server runs on :3000, Flask API on :5000.
// The proxy in package.json handles this.
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/* ── Persona ───────────────────────────────────────── */

export async function getPersona(): Promise<PersonaResponse> {
  const { data } = await api.get<PersonaResponse>('/persona');
  return data;
}

export async function switchPersona(role: string): Promise<void> {
  // The Flask demo endpoint uses query params and a redirect.
  // We hit the raw endpoint and let the cookie stick.
  await axios.get(`/demo/persona`, {
    params: { role, next: '/' },
    withCredentials: true,
    maxRedirects: 0,
    validateStatus: (s) => s < 400,
  });
}

/* ── World / Star Systems ──────────────────────────── */

export async function getSystems(): Promise<SystemsResponse> {
  const { data } = await api.get<SystemsResponse>('/world/systems');
  return data;
}

export async function getSystemsXYZ(): Promise<SystemsResponse> {
  const { data } = await api.get<SystemsResponse>('/world/systems/xyz');
  return data;
}

export async function getSystemsFull(): Promise<FullSystemsResponse> {
  const { data } = await api.get<FullSystemsResponse>('/world/systems/full');
  return data;
}

export async function getConfidence(): Promise<ConfidenceResponse> {
  const { data } = await api.get<ConfidenceResponse>('/world/confidence');
  return data;
}

/* ── Runs / Pipeline ───────────────────────────────── */

export async function getRunsManifest(limit = 50): Promise<RunsManifestResponse> {
  const { data } = await api.get<RunsManifestResponse>('/runs/manifest', { params: { limit } });
  return data;
}

export async function getRunValidation(runId: string): Promise<ValidationResponse> {
  const { data } = await api.get<ValidationResponse>(`/runs/validation/${runId}`);
  return data;
}

/* ── Simulation ────────────────────────────────────── */

export async function getSimSnapshot(runId: string) {
  const { data } = await api.get(`/simulation/${runId}/snapshot`);
  return data;
}

export async function getSimEvents(runId: string, limit = 20, afterTick = 0) {
  const { data } = await api.get(`/simulation/${runId}/events`, {
    params: { limit, after_tick: afterTick },
  });
  return data;
}

export async function simPause(runId: string) {
  const { data } = await api.post(`/simulation/${runId}/pause`);
  return data;
}

export async function simResume(runId: string) {
  const { data } = await api.post(`/simulation/${runId}/resume`);
  return data;
}

export async function simStep(runId: string, interval = 1) {
  const { data } = await api.post(`/simulation/${runId}/step`, null, {
    params: { interval },
  });
  return data;
}

/* ── Health ────────────────────────────────────────── */

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}

/* ── Planetary System Detail ────────────────────────── */

export async function getSystemDetail(mainId: string): Promise<PlanetarySystemResponse> {
  const { data } = await api.get<PlanetarySystemResponse>(`/system/${encodeURIComponent(mainId)}`);
  return data;
}

export async function getPlanetSummary(): Promise<PlanetSummaryResponse> {
  const { data } = await api.get<PlanetSummaryResponse>('/systems/planets/summary');
  return data;
}

export async function getSystemGroup(groupName: string): Promise<SystemGroupResponse> {
  const { data } = await api.get<SystemGroupResponse>(`/system-group/${encodeURIComponent(groupName)}`);
  return data;
}

/* ── Campaigns ─────────────────────────────────────── */

export async function listCampaigns(
  status: string = 'active',
  limit = 100,
  offset = 0,
): Promise<CampaignListResponse> {
  const { data } = await api.get<CampaignListResponse>('/campaigns', {
    params: { status, limit, offset },
  });
  return data;
}

export async function createCampaign(
  name: string,
  seed?: number,
  settings?: Record<string, unknown>,
): Promise<Campaign> {
  const { data } = await api.post<Campaign>('/campaigns', { name, seed, settings });
  return data;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const { data } = await api.get<Campaign>(`/campaigns/${campaignId}`);
  return data;
}

export async function updateCampaign(
  campaignId: string,
  updates: Partial<Pick<Campaign, 'name' | 'status' | 'settings'>>,
): Promise<Campaign> {
  const { data } = await api.patch<Campaign>(`/campaigns/${campaignId}`, updates);
  return data;
}

export async function archiveCampaign(campaignId: string): Promise<Campaign> {
  const { data } = await api.delete<Campaign>(`/campaigns/${campaignId}`);
  return data;
}

/* ── Campaign Map (Fog-of-War) ─────────────────────── */

export async function getCampaignMap(
  campaignId: string,
  scanLevel = 1,
): Promise<CampaignMapResponse> {
  const { data } = await api.get<CampaignMapResponse>(`/campaigns/${campaignId}/map`, {
    params: { scan_level: scanLevel },
  });
  return data;
}

export async function exploreSystem(
  campaignId: string,
  systemId: string,
  opts?: { explored_by?: string; scan_level?: number; notes?: string },
): Promise<ExploreSystemResponse> {
  const { data } = await api.post<ExploreSystemResponse>(
    `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}/explore`,
    opts ?? {},
  );
  return data;
}

export async function getExploration(
  campaignId: string,
  systemId: string,
): Promise<ExplorationDetail> {
  const { data } = await api.get<ExplorationDetail>(
    `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}`,
  );
  return data;
}

/* ── Factions ──────────────────────────────────────── */

export async function listFactions(campaignId: string): Promise<FactionListResponse> {
  const { data } = await api.get<FactionListResponse>(`/campaigns/${campaignId}/factions`);
  return data;
}

export async function createFaction(
  campaignId: string,
  name: string,
  color: string,
  homeSystemId?: string,
): Promise<Faction> {
  const { data } = await api.post<Faction>(`/campaigns/${campaignId}/factions`, {
    name,
    color,
    home_system_id: homeSystemId,
  });
  return data;
}

/* ── Campaign Simulation (via World Engine proxy) ──── */

export async function campaignSimInit(campaignId: string): Promise<SimInitResponse> {
  const { data } = await api.post<SimInitResponse>(
    `/campaigns/${campaignId}/simulation/init`,
  );
  return data;
}

export async function campaignSimTick(
  campaignId: string,
  count = 1,
): Promise<SimTickResponse> {
  const { data } = await api.post<SimTickResponse>(
    `/campaigns/${campaignId}/simulation/tick`,
    { count },
  );
  return data;
}

export async function campaignSimSnapshot(
  campaignId: string,
): Promise<SimSnapshotResponse> {
  const { data } = await api.get<SimSnapshotResponse>(
    `/campaigns/${campaignId}/simulation/snapshot`,
  );
  return data;
}

export default api;
