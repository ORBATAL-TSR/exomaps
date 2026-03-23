/**
 * ExoMaps API service — thin fetch wrappers for the Flask gateway.
 * Mirrors 01_WEB/src/services/api.ts but uses native fetch (no axios dep).
 */

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface IngestRun {
  run_id: string;
  run_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
}

export interface RunsManifestResponse {
  runs: IngestRun[];
  total_returned: number;
  limit: number;
}

export interface DBStatus {
  configured: boolean;
  connected: boolean;
  message: string;
}

export interface HealthResponse {
  db_status: DBStatus;
  persona: string;
  routes_count: number;
}

export interface Campaign {
  id: string;
  name: string;
  seed: number;
  status: 'active' | 'paused' | 'archived';
  owner_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  explored_count?: number;
  faction_count?: number;
}

export interface CampaignListResponse {
  campaigns: Campaign[];
  total: number;
}

export interface CampaignMapSystem {
  system_id: string;
  scan_level: number;
  explored_by: string | null;
  explored_at: string;
  notes: string | null;
}

export interface CampaignMapResponse {
  campaign_id: string;
  systems: CampaignMapSystem[];
  total_explored: number;
}

export interface ExploreSystemResponse {
  campaign_id: string;
  system_id: string;
  scan_level: number;
  explored_by: string | null;
  explored_at: string;
  is_new: boolean;
}

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
  home_system_id: string | null;
  created_at: string;
}

export interface FactionListResponse {
  campaign_id: string;
  factions: Faction[];
}

export interface SimInitResponse {
  campaign_id: string;
  status: string;
  tick: number;
}

export interface SimTickResponse {
  campaign_id: string;
  tick: number;
  events: unknown[];
}

export interface SimSnapshotResponse {
  campaign_id: string;
  tick: number;
  state: Record<string, unknown>;
}

/* ── Base fetch ─────────────────────────────────────────────────────────── */

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  params?: Record<string, string | number>,
): Promise<T> {
  let url = `/api${path}`;
  if (params) {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    );
    url += `?${q}`;
  }
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${msg}`);
  }
  return res.json();
}

/* ── Health ─────────────────────────────────────────────────────────────── */

export function getHealth(): Promise<HealthResponse> {
  return apiFetch('/health');
}

/* ── Pipeline runs ──────────────────────────────────────────────────────── */

export function getRunsManifest(limit = 20): Promise<RunsManifestResponse> {
  return apiFetch('/runs/manifest', {}, { limit });
}

/* ── Campaigns ──────────────────────────────────────────────────────────── */

export function listCampaigns(
  status = 'active',
  limit = 100,
  offset = 0,
): Promise<CampaignListResponse> {
  return apiFetch('/campaigns', {}, { status, limit, offset });
}

export function createCampaign(
  name: string,
  seed?: number,
  settings?: Record<string, unknown>,
): Promise<Campaign> {
  return apiFetch('/campaigns', {
    method: 'POST',
    body: JSON.stringify({ name, seed, settings }),
  });
}

export function archiveCampaign(campaignId: string): Promise<Campaign> {
  return apiFetch(`/campaigns/${campaignId}`, { method: 'DELETE' });
}

export function getCampaignMap(
  campaignId: string,
  scanLevel = 1,
): Promise<CampaignMapResponse> {
  return apiFetch(`/campaigns/${campaignId}/map`, {}, { scan_level: scanLevel });
}

export function exploreSystem(
  campaignId: string,
  systemId: string,
  opts?: { explored_by?: string; scan_level?: number; notes?: string },
): Promise<ExploreSystemResponse> {
  return apiFetch(
    `/campaigns/${campaignId}/systems/${encodeURIComponent(systemId)}/explore`,
    { method: 'POST', body: JSON.stringify(opts ?? {}) },
  );
}

/* ── Factions ───────────────────────────────────────────────────────────── */

export function listFactions(campaignId: string): Promise<FactionListResponse> {
  return apiFetch(`/campaigns/${campaignId}/factions`);
}

export function createFaction(
  campaignId: string,
  name: string,
  color: string,
  homeSystemId?: string,
): Promise<Faction> {
  return apiFetch(`/campaigns/${campaignId}/factions`, {
    method: 'POST',
    body: JSON.stringify({ name, color, home_system_id: homeSystemId }),
  });
}

/* ── Campaign simulation ────────────────────────────────────────────────── */

export function campaignSimInit(campaignId: string): Promise<SimInitResponse> {
  return apiFetch(`/campaigns/${campaignId}/simulation/init`, { method: 'POST' });
}

export function campaignSimTick(
  campaignId: string,
  count = 1,
): Promise<SimTickResponse> {
  return apiFetch(`/campaigns/${campaignId}/simulation/tick`, {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

export function campaignSimSnapshot(campaignId: string): Promise<SimSnapshotResponse> {
  return apiFetch(`/campaigns/${campaignId}/simulation/snapshot`);
}

/* ── Legacy simulation (run-id based) ──────────────────────────────────── */

export function simStep(runId: string, interval = 1): Promise<unknown> {
  return apiFetch(`/simulation/${runId}/step`, { method: 'POST' }, { interval });
}

export function simPause(runId: string): Promise<unknown> {
  return apiFetch(`/simulation/${runId}/pause`, { method: 'POST' });
}

export function simResume(runId: string): Promise<unknown> {
  return apiFetch(`/simulation/${runId}/resume`, { method: 'POST' });
}
