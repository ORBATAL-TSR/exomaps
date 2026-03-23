import React, { useEffect, useState } from 'react';
import { getConfidence } from '../services/api';
import type { ConfidenceRecord } from '../types/api';
import './PageShell.css';

export default function DataQAPage() {
  const [data, setData] = useState<ConfidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await getConfidence();
        setData(res.confidence_data);
      } catch (e: any) {
        if (e?.response?.status === 403) {
          setError('Your current persona does not have access to Data QA. Switch to Admin, Science Analyst, or Data Curator.');
        } else {
          setError('Could not load confidence data.');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const passingCount = data.filter((d) => d.sanity_pass).length;
  const failingCount = data.filter((d) => !d.sanity_pass).length;
  const avgUncertainty =
    data.length > 0
      ? (data.reduce((a, d) => a + (d.uncertainty_pc ?? 0), 0) / data.length).toFixed(4)
      : '—';

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Data QA</h1>
        <p className="page-subtitle">
          Coordinate confidence, sanity checks, and uncertainty analysis
        </p>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
          <p style={{ color: '#f59e0b' }}>{error}</p>
        </div>
      )}

      {!error && (
        <div className="page-grid">
          {/* Summary cards */}
          <div className="panel">
            <h3 className="panel-title">Summary</h3>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Total Systems</div>
                <div className="stat-value">{data.length}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Passing Sanity</div>
                <div className="stat-value text-green">{passingCount}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Failing Sanity</div>
                <div className="stat-value text-red">{failingCount}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Avg Uncertainty</div>
                <div className="stat-value">{avgUncertainty} pc</div>
              </div>
            </div>
          </div>

          {/* Data table */}
          <div className="panel" style={{ gridColumn: 'span 2' }}>
            <h3 className="panel-title">Confidence Records</h3>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : data.length === 0 ? (
              <p className="muted">No data. Run the coordinate transform pipeline to populate.</p>
            ) : (
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Star</th>
                      <th>Distance (ly)</th>
                      <th>Parallax (mas)</th>
                      <th>Uncertainty (pc)</th>
                      <th>Sanity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 200).map((d) => (
                      <tr key={d.main_id}>
                        <td>{d.main_id}</td>
                        <td className="mono">{d.distance_ly?.toFixed(2)}</td>
                        <td className="mono">{d.parallax_mas?.toFixed(4)}</td>
                        <td className="mono">{d.uncertainty_pc?.toFixed(4)}</td>
                        <td>
                          <span className={`badge ${d.sanity_pass ? 'badge-green' : 'badge-red'}`}>
                            {d.sanity_pass ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
