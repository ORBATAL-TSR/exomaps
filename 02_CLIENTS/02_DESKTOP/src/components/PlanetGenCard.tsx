/**
 * PlanetGenCard — Displays the status of a GPU planet generation job,
 * including composition bar and progress indicator.
 */

import React from 'react';
import type { GenerationStatus } from '../hooks/useTauriGPU';

interface Props {
  generation: GenerationStatus;
}

export function PlanetGenCard({ generation }: Props) {
  const { planetId, state, progress, textures, error } = generation;

  return (
    <div className="planet-gen-card">
      <h4>{planetId}</h4>

      <div className={`gen-status ${state}`}>
        {state === 'generating' && (
          <>Generating… {Math.round(progress * 100)}%</>
        )}
        {state === 'complete' && <>Complete — {textures?.planet_type}</>}
        {state === 'error' && <>Error: {error}</>}
        {state === 'idle' && <>Queued</>}
      </div>

      {/* Progress bar */}
      {state === 'generating' && (
        <div
          style={{
            height: 3,
            background: '#1e3050',
            borderRadius: 2,
            marginTop: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              background: '#4d9fff',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* Composition bar for completed planets */}
      {textures?.composition && (
        <div className="composition-bar" style={{ marginTop: 8 }}>
          {textures.composition.iron_fraction > 0.01 && (
            <div
              className="iron"
              style={{ flex: textures.composition.iron_fraction }}
              title={`Iron: ${(textures.composition.iron_fraction * 100).toFixed(1)}%`}
            />
          )}
          {textures.composition.silicate_fraction > 0.01 && (
            <div
              className="silicate"
              style={{ flex: textures.composition.silicate_fraction }}
              title={`Silicate: ${(textures.composition.silicate_fraction * 100).toFixed(1)}%`}
            />
          )}
          {textures.composition.volatile_fraction > 0.01 && (
            <div
              className="volatile"
              style={{ flex: textures.composition.volatile_fraction }}
              title={`Volatile: ${(textures.composition.volatile_fraction * 100).toFixed(1)}%`}
            />
          )}
          {textures.composition.h_he_fraction > 0.01 && (
            <div
              className="h-he"
              style={{ flex: textures.composition.h_he_fraction }}
              title={`H/He: ${(textures.composition.h_he_fraction * 100).toFixed(1)}%`}
            />
          )}
        </div>
      )}
    </div>
  );
}
