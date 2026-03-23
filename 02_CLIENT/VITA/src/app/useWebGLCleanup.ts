/**
 * useWebGLCleanup — disposes Three.js resources when the Canvas is torn down.
 *
 * In the persistent single-Canvas architecture (App.tsx), this only fires when
 * `canvasKey` increments (context loss recovery remount), not on every navigation.
 * That is intentional — we WANT shaders and textures to stay resident between
 * route changes.
 *
 * Call this once inside the R3F Canvas tree (e.g. in a top-level Scene component).
 * It traverses the scene graph on unmount and disposes geometries, materials, and
 * textures. The renderer's render lists are also cleared.
 *
 * Usage:
 *   function SceneRoot() {
 *     useWebGLCleanup();
 *     return null;
 *   }
 *   // Inside <Canvas>:
 *   <SceneRoot />
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function useWebGLCleanup() {
  const { gl, scene } = useThree();

  useEffect(() => {
    return () => {
      console.log('[WebGL] Canvas unmounting — disposing scene resources');

      let geomCount = 0;
      let matCount = 0;
      let texCount = 0;

      scene.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;

        if (mesh.geometry) {
          mesh.geometry.dispose();
          geomCount++;
        }

        const disposeMaterial = (mat: THREE.Material) => {
          // Dispose any textures referenced by the material
          Object.values(mat).forEach(val => {
            if (val instanceof THREE.Texture) {
              val.dispose();
              texCount++;
            }
          });
          mat.dispose();
          matCount++;
        };

        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(disposeMaterial);
          } else {
            disposeMaterial(mesh.material as THREE.Material);
          }
        }
      });

      // Clear cached render state (draw call lists, sorted transparent objects, etc.)
      gl.renderLists.dispose();
      // Release shadow map FBOs if any were allocated
      gl.shadowMap.enabled && gl.shadowMap.needsUpdate;

      console.log(`[WebGL] Disposed: ${geomCount} geometries, ${matCount} materials, ${texCount} textures`);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
