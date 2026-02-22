import React, { useEffect, useState } from 'react';
import StarMap from '../components/StarMap';
import { getSystemsFull } from '../services/api';
import type { StarSystemFull } from '../types/api';

export default function StarMapPage() {
  const [systems, setSystems] = useState<StarSystemFull[]>([]);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await getSystemsFull();
        if (mounted) {
          setSystems(data.systems);
          setSource(data.source);
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          if (err?.response?.status === 503) {
            setError('Database not connected. Star map is in demo mode.');
          } else {
            setError(err?.message ?? 'Failed to load star systems');
          }
          setSystems([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <StarMap systems={systems} loading={loading} source={source} />

      {error && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 8,
            padding: '8px 16px',
            color: '#f59e0b',
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
            zIndex: 20,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
