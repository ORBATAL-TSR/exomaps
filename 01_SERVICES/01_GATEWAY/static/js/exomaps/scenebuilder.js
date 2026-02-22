// SCENE BUILDER
// import * as THREE from "three";

// Have a single variable class that creates a scene
class WEBSCENE {
    constructor() {
        this.objects = [];
        this.createScene();
    }
    createScene(scene_name, dom_frame_name) {

        this.ENTIRE_SCENE = 0;
        this.BLOOM_SCENE = 1;
        this.bloomLayer = new THREE.Layers();
        this.bloomLayer.set( this.BLOOM_SCENE );

        this.materials = {};
        this.darkMaterial = new THREE.MeshBasicMaterial( { color: "blue" } );

        this.bloom_params = {
				exposure: 1,
				bloomStrength: 5,
				bloomThreshold: 0,
				bloomRadius: 0,
				scene: "Scene with Glow"
			};

        // Names the scene, permitting multiple new scenes to be added
        this.scene_name = scene_name;

        // Socket Namespace to use
        this.namespace = '/starmap';

        // Launch the scene object
        this.scene = new THREE.Scene();

        //for frustum
        this.zmax = 5.e10;
        this.zmin = 1;
        this.fov = 45.;

        // Make a loader
        this.loader = new THREE.TextureLoader();

        // build and position the camera
        this.camera = new THREE.PerspectiveCamera( this.fov, this.aspect, this.zmin, this.zmax);
        this.camera.up.set(0, -1, 0);
	    this.camera.position.z = 30;
	    this.scene.add(this.camera);

        // Launch the Renderer
        this.renderer =	new THREE.WebGLRenderer({antialias:true});
        this.renderer.setSize(this.screenWidth, this.screenHeight);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.dom_frame = dom_frame_name;
        this.container = document.getElementById(dom_frame_name);

        // Determine Screen Size
        this.screenWidth = window.innerWidth;
        this.screenHeight = window.innerHeight;
        this.aspect = this.screenWidth / this.screenHeight;

        this.aspect_vec = new THREE.Vector2(window.innerWidth, window.innerHeight);


        this.bloomLayer = new THREE.Layers();
		this.bloomLayer.set(1);

        // Create the render pass bloom effect
        this.renderScene = new THREE.RenderPass( this.scene, this.camera );
        this.bloomPass = new THREE.UnrealBloomPass(this.aspect_vec, 1.5, 0.4, 0.85);
        this.bloomComposer = new THREE.EffectComposer( this.renderer );
        this.finalComposer = new THREE.EffectComposer( this.renderer );

        // Does a pass to determine what to apply bloom to
        this.bloomPass.threshold = this.bloom_params.bloomThreshold;
        this.bloomPass.strength = this.bloom_params.bloomStrength;
        this.bloomPass.radius = this.bloom_params.bloomRadius;
        this.bloomComposer.renderToScreen = false;
        this.bloomComposer.addPass( this.renderScene );
        this.bloomComposer.addPass( this.bloomPass );

        this.finalPass = new THREE.ShaderPass(
				new THREE.ShaderMaterial( {
					uniforms: {
						baseTexture: { value: null },
						bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
					},
					vertexShader: document.getElementById( 'vertexshader' ).textContent,
					fragmentShader: document.getElementById( 'fragmentshader' ).textContent,
					defines: {}
				} ), "baseTexture"
			);

        this.finalPass.needsSwap = true;
        this.finalComposer.addPass( this.renderScene );
        this.finalComposer.addPass( this.finalPass );


        this.labelRenderer = new THREE.CSS3DRenderer();
        this.labelRenderer.setSize( window.innerWidth, window.innerHeight );
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        //document.body.appendChild( labelRenderer.domElement );
        //document.getElementById(dom_frame_name).appendChild( this.labelRenderer.domElement );

        // Socket
        this.socket = io.connect(location.protocol + '//' + document.domain
                           + ':' + location.port + this.namespace);

        this.controls = new THREE.OrbitControls( this.camera, this.labelRenderer.domElement );

        this.render();
        return this;
    }

    gen_frame(self) {
        //this.container.appendChild(this.render.domElement);
        console.log('page loaded');
        console.log(this);
        //document.body.appendChild(this.renderer.domElement);
        document.body.appendChild( this.labelRenderer.domElement );
        return this;
    }

    resizeSceneFrame(self) {
        console.log('Trying to resize - self');
        console.log(self);
        this.container = document.getElementById(this.dom_frame);
        console.log(this.container);
        var w = this.container.offsetWidth;
        var h_dif = window.innerHeight - this.container.offsetHeight;
        var h = Math.min(this.container.offsetHeight, window.innerHeight);
        console.log(w, h);
        this.aspect = ( w / h );
        this.camera.aspect = this.aspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize( w, h );
        this.labelRenderer.setSize( w, h );
        //this.render();
        return this;

    }


    // render the scene - #TODO add args?
    render() {
      requestAnimationFrame(() => {
        this.render();
      });

        this.objects.forEach((object) => {
          if (typeof object.update !== "undefined") {
            // safe to use the function
            object.update();
           }
        });

        this.renderer.render(this.scene, this.camera);


        //this.renderBloom( true );
        this.bloomComposer.render();

        // render the entire scene, then render bloom scene on top
        this.finalComposer.render();
        this.camera.layers.set(1);
					this.bloomComposer.render();
					this.camera.layers.set(0);

        this.labelRenderer.render(this.scene, this.camera);

        return this;
      }

      add(mesh) {
        this.objects.push(mesh);
        this.scene.add(mesh.getMesh());
        return this;
      }

      addAny(stuff) {
        this.objects.push(stuff);
        this.scene.add(stuff);
        return this;
      }

      renderBloom( mask ) {

            if ( mask === true ) {

                this.scene.traverse( this.darken );
                this.bloomComposer.render();
                this.scene.traverse( this.brighten );

            } else {

                camera.layers.set( 1 );
                this.bloomComposer.render();
                camera.layers.set( 0 );

            }

        }

      darken( obj ) {
//        if ( (obj.isMesh || obj.type == "PolarGridHelper") && this.bloomLayer.test( obj.layers ) === false ) {
        if ( obj.isMesh && this.bloomLayer.test( obj.layers ) === false ) {

            this.materials[ obj.uuid ] = obj.material;
            obj.material = this.darkMaterial;

        }

      }

      brighten( obj ) {
        if ( materials[ obj.uuid ] ) {
            obj.material = materials[ obj.uuid ];
            delete materials[ obj.uuid ];
        }

      }


//      animateGUI() {
//        requestAnimationFrame( animateGUI );
//        this.controls.update();
//        //externalParams.gui.update();
//        this.controls.update();
//        this.renderer.render( this.scene, this.camera );
//        return this;
//    }

}





function rgbToHex(red, green, blue) {
  const rgb = (red*100 << 16) | (green*100 << 8) | (blue*100 << 0);
  return '#' + (0x1000000 + rgb).toString(16).slice(1);
}


var Line = function(scene, star1, star2){
  //console.log(star1);
  var geometry = new THREE.Geometry();
  geometry.dynamic = true;
  geometry.vertices.push(star1.v);
  geometry.vertices.push(star2.v);
//  geometry.vertices.push(new THREE.Vector3( 0,0 , 0 ));
//  geometry.vertices.push(new THREE.Vector3( 5,-5 , 5 ));
//  geometry.vertices.push(new THREE.Vector3( 5, 0 , 5 ));
  geometry.verticesNeedUpdate = true;

  var material = new THREE.LineBasicMaterial({ color: 0xffffff });
  var line = new THREE.Line( geometry, material );

  scene.add(line);
  return line;
};