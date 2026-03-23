/**
 * CameraController – Replaces vanilla OrbitControls with an animated
 * camera that smoothly flies to selected stars.
 *
 * When a star is selected, the camera lerps toward a position offset
 * from the star while the orbit target moves to the star's position.
 * When deselected, the camera stays at its current position.
 *
 * Supports viewMode: 'perspective' (default 3D) and 'topdown' (overhead XY).
 */
import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';

interface CameraControllerProps {
  target: StarSystemFull | null;
  /** Duration of the fly animation in seconds */
  flyDuration?: number;
  /** Distance from target for the camera offset */
  flyDistance?: number;
  /** Camera view mode — 'topdown' locks to overhead XY view */
  viewMode?: 'perspective' | 'topdown';
}

export default function CameraController({
  target,
  flyDuration = 1.4,
  flyDistance = 6,
  viewMode = 'perspective',
}: CameraControllerProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  // Animation state stored in a ref to avoid re-renders
  const anim = useRef({
    active: false,
    progress: 0,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    duration: flyDuration,
  });

  const prevViewMode = useRef(viewMode);

  /* ── Trigger fly animation when target changes ───── */
  useEffect(() => {
    if (!target) {
      anim.current.active = false;
      return;
    }

    const starPos = new THREE.Vector3(target.x, target.y, target.z);
    const currentCamPos = camera.position.clone();

    let endPos: THREE.Vector3;
    if (viewMode === 'topdown') {
      // Top-down: look straight down at the target
      endPos = new THREE.Vector3(starPos.x, Math.max(flyDistance * 4, 30), starPos.z);
    } else {
      // Offset: approach from the current view direction, but clamped to flyDistance
      const direction = new THREE.Vector3()
        .subVectors(currentCamPos, starPos)
        .normalize();

      // Keep a slight upward angle for visual appeal
      direction.y = Math.max(direction.y, 0.25);
      direction.normalize();

      endPos = starPos.clone().add(direction.multiplyScalar(flyDistance));
    }

    const a = anim.current;
    a.startPos.copy(currentCamPos);
    a.endPos.copy(endPos);
    a.startTarget.copy(controlsRef.current?.target ?? new THREE.Vector3());
    a.endTarget.copy(starPos);
    a.progress = 0;
    a.duration = flyDuration;
    a.active = true;
  }, [target, camera, flyDuration, flyDistance, viewMode]);

  /* ── Switch viewMode triggers camera animation ───── */
  useEffect(() => {
    if (prevViewMode.current === viewMode) return;
    prevViewMode.current = viewMode;

    const currentTarget = controlsRef.current?.target?.clone() ?? new THREE.Vector3();
    const currentCamPos = camera.position.clone();

    let endPos: THREE.Vector3;
    if (viewMode === 'topdown') {
      // Fly to overhead position above current look-target
      const height = Math.max(30, currentCamPos.distanceTo(currentTarget) * 2);
      endPos = new THREE.Vector3(currentTarget.x, height, currentTarget.z);
    } else {
      // Return to angled perspective from overhead
      const dist = Math.max(6, currentCamPos.y * 0.4);
      endPos = new THREE.Vector3(
        currentTarget.x + dist * 0.7,
        dist * 0.5,
        currentTarget.z + dist * 0.7,
      );
    }

    const a = anim.current;
    a.startPos.copy(currentCamPos);
    a.endPos.copy(endPos);
    a.startTarget.copy(currentTarget);
    a.endTarget.copy(currentTarget);
    a.progress = 0;
    a.duration = 1.2;
    a.active = true;
  }, [viewMode, camera]);

  /* ── Smooth fly in useFrame ──────────────────────── */
  useFrame((_, delta) => {
    const a = anim.current;
    if (!a.active) return;

    a.progress += delta / a.duration;
    if (a.progress >= 1) {
      a.progress = 1;
      a.active = false;
    }

    // Ease-out cubic for smooth deceleration
    const t = 1 - Math.pow(1 - a.progress, 3);

    camera.position.lerpVectors(a.startPos, a.endPos, t);

    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(a.startTarget, a.endTarget, t);
      controlsRef.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.12}
      minDistance={1.5}
      maxDistance={200}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      maxPolarAngle={viewMode === 'topdown' ? 0.01 : Math.PI}
    />
  );
}
