import axios from 'axios';
import type {
  PersonaResponse,
  SystemsResponse,
  FullSystemsResponse,
  ConfidenceResponse,
  RunsManifestResponse,
  ValidationResponse,
  HealthResponse,
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

export default api;
