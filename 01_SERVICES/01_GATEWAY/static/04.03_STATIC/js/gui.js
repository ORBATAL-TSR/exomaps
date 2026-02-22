//https://blog.miguelgrinberg.com/post/easy-websockets-with-flask-and-gevent
//https://github.com/miguelgrinberg/Flask-SocketIO
function connectSocketOutput(){
	//$(document).ready(function() {
	document.addEventListener("DOMContentLoaded", function(event) { 
		// Event handler for new connections.
		// The callback function is invoked when a connection with the
		// server is established.
		internalParams.socket.on('connect', function() {
			internalParams.socket.emit('connection_test', {data: 'I\'m connected!'});
			//request data from server
			internalParams.socket.emit('input_data_request', {data: 'requesting data'});
		});
		internalParams.socket.on('connection_response', function(msg) {
			console.log(msg);
		});		
		// Event handler for server sent data.
		// The callback function is invoked whenever the server emits data
		// to the client. The data is then displayed in the "Received"
		// section of the page.
		internalParams.socket.on('from_gui', function(msg) {
			//console.log(msg);
		});
		internalParams.socket.on('input_data_response', function(msg) {
			console.log("data received", msg);
		});	
	});
}

//this creates the user interface (gui)
function createGUI(){
	setParamsFromURL();
	setURLvars();


	internalParams.gui = new dat.GUI();
	internalParams.gui.add( externalParams, 'radius', 1,30).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'widthSegments', 3,32).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'heightSegments', 3,32).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'phiStart', 0.,2.*Math.PI).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'phiLength', 0.,2.*Math.PI).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'thetaStart', 0.,2.*Math.PI).onChange(sendGUIinfo);
	internalParams.gui.add( externalParams, 'thetaLength', 0.,2.*Math.PI).onChange(sendGUIinfo);

}

function sendGUIinfo(){
	//send the information from the GUI back to the flask app, and then on to the viewer
	internalParams.socket.emit('gui_input', externalParams);

	//this is to update the URL (not really needed here)
	setURLvars()

    // Update values
	cube.scale.x = externalParams.radius;
    cube.scale.y = externalParams.radius;
    cube.scale.z = externalParams.radius;
}
function drawCube(){
	var size = 1. * externalParams.radius;
	// CUBE
	var geometry = new THREE.CubeGeometry(size, size, size);
	var cubeMaterials = [ 
		new THREE.MeshBasicMaterial({color:"yellow", side: THREE.DoubleSide}),
		new THREE.MeshBasicMaterial({color:"orange", side: THREE.DoubleSide}), 
		new THREE.MeshBasicMaterial({color:"red", side: THREE.DoubleSide}),
		new THREE.MeshBasicMaterial({color:"green", side: THREE.DoubleSide}), 
		new THREE.MeshBasicMaterial({color:"blue", side: THREE.DoubleSide}), 
		new THREE.MeshBasicMaterial({color:"purple", side: THREE.DoubleSide}), 
	]; 
	// Create a MeshFaceMaterial, which allows the cube to have different materials on each face 
	var cubeMaterial = new THREE.MeshFaceMaterial(cubeMaterials); 
	var cube = new THREE.Mesh(geometry, cubeMaterial);

    return cube;
}

//this is the animation loop
function animateGUI(time) {
	requestAnimationFrame( animateGUI );
	internalParams.controls.update();
	//externalParams.gui.update();
	internalParams.controls.update();
	internalParams.renderer.render( internalParams.scene, internalParams.camera );
	
	//send the camera info back to the flask app, and then on to the viewer
	if (internalParams.controls.changed){
		internalParams.socket.emit('camera_input',{
			"position":internalParams.camera.position,
			"rotation":internalParams.camera.rotation,
			"up":internalParams.camera.up
		});
		//send the controls infro back to the flask app, and then on to the viewer
		internalParams.socket.emit('controls_input',{
			"target":internalParams.controls.target,
		});

//		cube.scale.x = externalParams.radius;
//        cube.scale.y = externalParams.radius;
//        cube.scale.z = externalParams.radius;
	}

    cube.rotation.x += 0.002;

//    cube.
//    cube.geometry.size = externalParams.radius * 1.0;
//	if (externalParams.gui.changed) {
//	    console.log('size changed')
//        cube.scale.x = externalParams.radius;
//        cube.scale.y = externalParams.radius;
//        cube.scale.z = externalParams.radius;
//	}
}

function startGUI(){
//define the params object
	defineInternalParams();
	defineExternalParams();

//initialize everything related to the WebGL scene
	initScene();
	internalParams.scene.background = new THREE.Color('skyblue');

//create the UI
	createGUI();

//draw the cube
	cube = drawCube();
    internalParams.scene.add( cube );
//begin the animation
	animateGUI();
}





