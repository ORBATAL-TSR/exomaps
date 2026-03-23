/**
 * ModelManifestPanel — Browse the registry of scientific models
 * with their citations, parameters, and applicability domains.
 */

import { useEffect, useState } from 'react';
import type { ModelDescriptor, ScienceHook } from '../hooks/useScience';

interface Props {
  science: ScienceHook;
}

export function ModelManifestPanel({ science }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!science.modelManifest) {
      science.fetchModelManifest().catch(() => {});
    }
  }, [science]);

  const models = science.modelManifest;

  if (!models) {
    return (
      <div style={{ color: '#556677', fontSize: 12, padding: 16 }}>
        Loading model registry...
      </div>
    );
  }

  const categories = [...new Set(models.map(m => m.category))];

  return (
    <div style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8, color: '#e8edf5' }}>
        Scientific Model Registry
      </h3>
      <div style={{ color: '#667788', fontSize: 11, marginBottom: 12 }}>
        {models.length} registered models across {categories.length} categories
      </div>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              color: '#7dd3fc',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 4,
              borderBottom: '1px solid #1e3050',
              paddingBottom: 2,
            }}
          >
            {cat}
          </div>

          {models
            .filter(m => m.category === cat)
            .map(model => (
              <ModelCard
                key={model.id}
                model={model}
                expanded={expanded === model.id}
                onToggle={() => setExpanded(expanded === model.id ? null : model.id)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function ModelCard({
  model,
  expanded,
  onToggle,
}: {
  model: ModelDescriptor;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        background: expanded ? '#111827' : 'transparent',
        borderRadius: 6,
        padding: '6px 8px',
        marginBottom: 2,
        cursor: 'pointer',
        border: expanded ? '1px solid #1e3050' : '1px solid transparent',
      }}
      onClick={onToggle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ color: '#e8edf5', fontWeight: 500 }}>{model.name}</span>
          <span style={{ color: '#556677', marginLeft: 6, fontSize: 10 }}>v{model.version}</span>
        </div>
        <span style={{ color: '#556677', fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: '#aabbcc', marginBottom: 8 }}>{model.description}</p>

          {/* Citations */}
          {model.citations.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#8899aa', fontSize: 10, marginBottom: 4 }}>References</div>
              {model.citations.map((cite, i) => (
                <div key={i} style={{ color: '#667788', fontSize: 10, marginBottom: 2 }}>
                  {cite.authors} ({cite.year}). <em>{cite.title}</em>. {cite.journal}.
                  {cite.doi && (
                    <span
                      style={{ color: '#7dd3fc', cursor: 'pointer', marginLeft: 4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://doi.org/${cite.doi}`, '_blank');
                      }}
                    >
                      DOI↗
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Parameters */}
          {model.parameters.length > 0 && (
            <div>
              <div style={{ color: '#8899aa', fontSize: 10, marginBottom: 4 }}>Parameters</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 9, color: '#556677' }}>
                    <th style={{ textAlign: 'left', padding: '1px 4px' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '1px 4px' }}>Unit</th>
                    <th style={{ textAlign: 'right', padding: '1px 4px' }}>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {model.parameters.map((p, i) => (
                    <tr key={i} style={{ color: '#aabbcc', fontSize: 10 }}>
                      <td style={{ padding: '1px 4px' }}>{p.name}</td>
                      <td style={{ padding: '1px 4px' }}>{p.unit}</td>
                      <td style={{ padding: '1px 4px', textAlign: 'right' }}>
                        {p.min_value != null && p.max_value != null
                          ? `${p.min_value}–${p.max_value}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
