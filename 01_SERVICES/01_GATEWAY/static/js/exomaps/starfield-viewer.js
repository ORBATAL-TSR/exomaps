/**
 * StarField Interactive Viewer - Phase 06 MVP
 * 3D visualization of star systems using Three.js
 */

class StarFieldViewer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.stars = [];
    this.routes = [];
    this.selectedSystem = null;
    
    this.init();
    this.loadSystems();
    this.setupEventListeners();
  }

  init() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x001a33);
    
    // Starfield background
    this.addStarfield();
    
    // Camera setup (isometric-ish view)
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0);
    
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);
    
    // Coordinate axes for reference
    this.addAxes();
    
    // Simple orbit controls (rotate with mouse)
    this.setupInteraction();
    
    // Start render loop
    this.animate();
  }

  addStarfield() {
    // Random distant stars as background
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    
    for (let i = 0; i < 500; i++) {
      vertices.push(
        (Math.random() - 0.5) * 2000,
        (Math.random() - 0.5) * 2000,
        (Math.random() - 0.5) * 2000
      );
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      sizeAttenuation: true
    });
    
    const background = new THREE.Points(geometry, material);
    this.scene.add(background);
  }

  addAxes() {
    const axisLength = 80;
    const axes = new THREE.Group();
    
    // X axis (red)
    const xGeometry = new THREE.BufferGeometry();
    xGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, axisLength, 0, 0]), 3
    ));
    const xLine = new THREE.Line(xGeometry, new THREE.LineBasicMaterial({ color: 0xff0000 }));
    axes.add(xLine);
    
    // Y axis (green)
    const yGeometry = new THREE.BufferGeometry();
    yGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, axisLength, 0]), 3
    ));
    const yLine = new THREE.Line(yGeometry, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    axes.add(yLine);
    
    // Z axis (blue)
    const zGeometry = new THREE.BufferGeometry();
    zGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, 0, axisLength]), 3
    ));
    const zLine = new THREE.Line(zGeometry, new THREE.LineBasicMaterial({ color: 0x0000ff }));
    axes.add(zLine);
    
    this.scene.add(axes);
  }

  async loadSystems() {
    try {
      const response = await fetch('/api/world/systems');
      const data = await response.json();
      
      if (!data.systems) {
        console.warn('No systems data returned');
        return;
      }
      
      data.systems.forEach(system => {
        this.addSystemMarker(system);
      });
      
      console.log(`Loaded ${data.systems.length} systems`);
    } catch (error) {
      console.error('Error loading systems:', error);
    }
  }

  addSystemMarker(system) {
    // Use coordinates if available, otherwise generate random positions for demo
    const x = system.x_pc || (Math.random() - 0.5) * 200;
    const y = system.y_pc || (Math.random() - 0.5) * 200;
    const z = system.z_pc || (Math.random() - 0.5) * 200;
    
    // Create sphere for system
    const geometry = new THREE.SphereGeometry(0.5, 8, 8);
    
    // Color based on spectral type or habitability
    let color = 0xffffff;
    if (system.spectral_type === 'F') color = 0xffff99;
    else if (system.spectral_type === 'G') color = 0xffff00;
    else if (system.spectral_type === 'K') color = 0xffaa00;
    else if (system.spectral_type === 'M') color = 0xff6600;
    else if (system.spectral_type === 'A') color = 0xccffff;
    else if (system.has_habitable_planet) color = 0x00ff00;
    
    const material = new THREE.MeshStandardMaterial({ 
      color: color,
      emissive: color,
      emissiveIntensity: 0.5
    });
    
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(x, y, z);
    sphere.userData = { system: system, isSystem: true };
    
    this.scene.add(sphere);
    this.stars.push({ mesh: sphere, system: system });
    
    // Create halo for habitable systems
    if (system.has_habitable_planet) {
      const haloGeometry = new THREE.SphereGeometry(1.2, 8, 8);
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.1,
        wireframe: true
      });
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.position.copy(sphere.position);
      this.scene.add(halo);
    }
  }

  setupInteraction() {
    // Mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    
    this.canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
      
      // Check for system selection
      this.selectSystemFromMouse(e);
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        
        // Rotate camera
        const quaternion = new THREE.Quaternion();
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaX * 0.01);
        this.camera.position.applyQuaternion(quaternion);
        
        quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), deltaY * 0.01);
        this.camera.position.applyQuaternion(quaternion);
        this.camera.lookAt(0, 0, 0);
        
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });
    
    this.canvas.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // Scroll to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 2;
      const direction = this.camera.position.clone().normalize();
      
      if (e.deltaY > 0) {
        this.camera.position.addScaledVector(direction, zoomSpeed);
      } else {
        this.camera.position.addScaledVector(direction, -zoomSpeed);
      }
    });
    
    // Window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  selectSystemFromMouse(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    
    const intersects = raycaster.intersectObjects(this.scene.children);
    
    for (let i = 0; i < intersects.length; i++) {
      if (intersects[i].object.userData.isSystem) {
        this.selectSystem(intersects[i].object.userData.system);
        break;
      }
    }
  }

  selectSystem(system) {
    this.selectedSystem = system;
    
    // Update details panel
    const detailsPanel = document.getElementById('system-details');
    if (detailsPanel) {
      detailsPanel.innerHTML = `
        <h6>${system.name || `System at ${system.x_pc?.toFixed(1)}, ${system.y_pc?.toFixed(1)}, ${system.z_pc?.toFixed(1)}`}</h6>
        <dl class="row" style="font-size: 0.85rem; margin-bottom: 0;">
          <dt class="col-sm-6">Spectral Type:</dt>
          <dd class="col-sm-6">${system.spectral_type || 'Unknown'}</dd>
          
          <dt class="col-sm-6">Distance:</dt>
          <dd class="col-sm-6">${system.distance_ly?.toFixed(1) || 'N/A'} LY</dd>
          
          <dt class="col-sm-6">Luminosity:</dt>
          <dd class="col-sm-6">${system.luminosity_solar?.toFixed(2) || 'N/A'} L☉</dd>
          
          <dt class="col-sm-6">Habitable:</dt>
          <dd class="col-sm-6">${system.has_habitable_planet ? '✓ Yes' : '✗ No'}</dd>
          
          <dt class="col-sm-6">Confidence:</dt>
          <dd class="col-sm-6">${system.confidence_tier || 'Medium'}</dd>
        </dl>
      `;
    }
  }

  onWindowResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Slight rotation for visual interest
    this.stars.forEach(star => {
      star.mesh.rotation.x += 0.0001;
      star.mesh.rotation.y += 0.0002;
    });
    
    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const viewer = new StarFieldViewer('starfield-canvas');
  
  // UI Controls
  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    viewer.camera.position.set(50, 50, 50);
    viewer.camera.lookAt(0, 0, 0);
  });
  
  document.getElementById('btn-toggle-labels')?.addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    // TODO: toggle label visibility
  });
  
  document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
    viewer.canvas.requestFullscreen?.() || viewer.canvas.webkitRequestFullscreen?.();
  });
  
  document.getElementById('distance-slider')?.addEventListener('change', (e) => {
    document.getElementById('distance-value').textContent = e.target.value;
    // TODO: filter systems by distance
  });
  
  document.getElementById('layer-observed')?.addEventListener('change', (e) => {
    // TODO: toggle observed systems layer
  });
  
  document.getElementById('layer-routes')?.addEventListener('change', (e) => {
    // TODO: toggle trade routes layer
  });
  
  document.getElementById('btn-simulate')?.addEventListener('click', () => {
    if (viewer.selectedSystem) {
      // TODO: navigate to simulation with selected system
      console.log('Simulate:', viewer.selectedSystem);
    }
  });
});
