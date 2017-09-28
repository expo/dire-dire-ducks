import Expo from 'expo';
import React from 'react';
import { View, PanResponder } from 'react-native';

import * as THREE from 'three';
import ExpoTHREE from 'expo-three';
import * as CANNON from 'cannon';

const WATER_Y = -0.15;

console.disableYellowBox = true;

const scaleLongestSideToSize = (mesh, size) => {
  const { x: width, y: height, z: depth } =
    new THREE.Box3().setFromObject(mesh).size();
  const longest = Math.max(width, Math.max(height, depth));
  const scale = size / longest;
  mesh.scale.set(scale, scale, scale);
}

class BlueOverlay extends React.Component {
  state = {
    visible: false,
  }

  render() {
    return this.state.visible ? (
      <View
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0, right: 0,
          backgroundColor: '#001e0fa0',
        }}
      />
    ) : null;
  }

  setVisible(visible) {
    this.setState({ visible });
  }
}

export default class App extends React.Component {
  componentWillMount() {
    this.panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        this.touching = true;
      },
      onPanResponderRelease: () => {
        this.touching = false;
      },
      onPanResponderTerminate: () => {
        this.touching = false;
      },
      onShouldBlockNativeResponder: () => false,
    });
  }

  render() {
    return (
      <View style={{ flex: 1 }}>
        <Expo.GLView
          {...this.panResponder.panHandlers}
          ref={(ref) => this._glView = ref}
          style={{ flex: 1 }}
          onContextCreate={this._onGLContextCreate}
        />
        <BlueOverlay ref={(ref) => this.overlay = ref} />
      </View>
    );
  }

  _onGLContextCreate = async (gl) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    gl.createRenderbuffer = () => {};
    gl.bindRenderbuffer = () => {};
    gl.renderbufferStorage  = () => {};
    gl.framebufferRenderbuffer  = () => {};

    // ar init
    const arSession = await this._glView.startARSessionAsync();

    // three.js init
    const renderer = ExpoTHREE.createRenderer({ gl });
    renderer.setSize(width, height);
    const scene = new THREE.Scene();
    const videoFeed = ExpoTHREE.createARBackgroundTexture(arSession, renderer);
    scene.background = videoFeed;
    const camera = ExpoTHREE.createARCamera(arSession, width, height, 0.01, 1000);
    // const camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 1000);

    // cannon.js init
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();

    // audio
    Expo.Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: Expo.Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: Expo.Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX
    });
    const {
      sound: aboveWaterSound,
    } = await Expo.Audio.Sound.create(
      require('./assets/dire_dire_ducks_above_water.mp3'));
    const {
      sound: underWaterSound,
    } = await Expo.Audio.Sound.create(
      require('./assets/dire_dire_ducks_underwater.mp3'));
    await aboveWaterSound.setStatusAsync({
      shouldPlay: true,
      isLooping: true,
      volume: 1,
    });
    await underWaterSound.setStatusAsync({
      shouldPlay: true,
      isLooping: true,
      volume: 0,
    });
    aboveWaterSound.setPositionAsync(0);
    underWaterSound.setPositionAsync(0);

    // lights
    const dirLight = new THREE.DirectionalLight(0xdddddd);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);
    const ambLight = new THREE.AmbientLight(0x505050);
    scene.add(ambLight);

    // ground
    const groundMaterial = new CANNON.Material();
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: groundMaterial,
      position: new CANNON.Vec3(0, WATER_Y - 0.15, 0),
    });
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
    world.add(groundBody);

    // objects (three.js mesh <-> cannon.js body pairs)
    const objects = [];

    // model
    const loader = new THREE.OBJLoader();
    const model = await new Promise((resolve, reject) =>
      loader.load(
        'https://raw.githubusercontent.com/arynchoong/ARVR-flood-orchard/master/images/rubber-duck.obj',
        resolve,
        () => {},
        reject
      )
    );
    scaleLongestSideToSize(model, 0.18);

    // ball
    const ballMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0.95, 0.95, 0),
      specular: new THREE.Color(0.3, 0.3, 0.3),
    })
    const ballPhysicsMaterial = new CANNON.Material();
    for (let i = 0; i < 20; ++i) {
      const ball = {}
      ball.mesh = model.clone();
      ball.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = ballMaterial;
        }
      });
      scene.add(ball.mesh);
      ball.body = new CANNON.Body({
        mass: 2,
        shape: new CANNON.Sphere(0.07),
        material: ballPhysicsMaterial,
        position: new CANNON.Vec3(Math.random() - 0.5, 0.5 + 3 * Math.random(), -2 + Math.random() - 0.5),
      });
      world.add(ball.body);
      objects.push(ball);
    }
    world.addContactMaterial(new CANNON.ContactMaterial(
      groundMaterial, ballPhysicsMaterial, {
        restitution: 0.7,
        friction: 0.6,
      }));

    // water
    const waterNormals = await ExpoTHREE.createTextureAsync({
      asset: Expo.Asset.fromModule(require('./assets/waternormals.jpg')),
    });
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    const water = new THREE.Water(renderer, camera, scene, {
      textureWidth: 256, textureHeight: 256,
      waterNormals,
      alpha: 0.75,
      sunDirection: dirLight.position.normalize(),
      waterColor: 0x001e0f,
      betaVersion: 0,
      side: THREE.DoubleSide,
      distortionScale: 10,
      noiseScale: 0.005,
    });
    const waterMesh = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(30, 30, 10, 10),
      water.material,
    );
    waterMesh.add(water);
		waterMesh.rotation.x = -Math.PI * 0.5;
    waterMesh.position.y = WATER_Y;
    scene.add(waterMesh);

    // main loop
    let lastAbove = true;
    const buoyancy = 20;
    const animate = () => {
      // calculate camera position
      camera.position.setFromMatrixPosition(camera.matrixWorld);
      const cameraPos = new THREE.Vector3(0, 0, 0);
      cameraPos.applyMatrix4(camera.matrixWorld);

      // swap sounds based on above/under water
      if (camera.position.y < WATER_Y) {
        if (lastAbove) {
          this.overlay.setVisible(true);
          aboveWaterSound.setStatusAsync({ volume: 0 });
          underWaterSound.setStatusAsync({ volume: 1 });
        }
        lastAbove = false;
      } else {
        if (!lastAbove) {
          this.overlay.setVisible(false);
          aboveWaterSound.setStatusAsync({ volume: 1 });
          underWaterSound.setStatusAsync({ volume: 0 });
        }
        lastAbove = true;
      }

      // update water animation
      water.material.uniforms.time.value += 1 / 60;

      // update world
      world.step(1 / 60);

      // update objects
      objects.forEach(({ mesh, body }) => {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      });

      // buoyancy and underwater damping
      objects.forEach(({ body }) => {
        if (body.position.y < WATER_Y) {
          const depth = Math.abs(WATER_Y - body.position.y);
          body.applyForce(
            new CANNON.Vec3(0, Math.max(20, 100 * depth), 0), body.position);
          const damping = body.velocity.scale(-0.4);
          body.applyForce(damping, body.position);
        }
      });

      // apply force toward camera if touching
      objects.forEach(({ body }) => {
        if (this.touching) {
          const d = body.position.vsub(cameraPos).unit().scale(-1.2);
          body.applyForce(d, body.position);
        }
      });

      // render water
      scene.background = new THREE.Color(0.3, 0.3, 0.3);
      water.render();
      scene.background = videoFeed;

      // end frame and schedule new one!
      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(animate);
    }
    animate();
  }
}

THREE.ShaderLib['water'] = {

  uniforms: THREE.UniformsUtils.merge( [
    THREE.UniformsLib[ "fog" ], {
      "normalSampler":    { type: "t", value: null },
      "mirrorSampler":    { type: "t", value: null },
      "alpha":            { type: "f", value: 1.0 },
      "time":             { type: "f", value: 0.0 },
      "distortionScale":  { type: "f", value: 20.0 },
      "noiseScale":       { type: "f", value: 1.0 },
      "textureMatrix" :   { type: "m4", value: new THREE.Matrix4() },
      "sunColor":         { type: "c", value: new THREE.Color(0x7F7F7F) },
      "sunDirection":     { type: "v3", value: new THREE.Vector3(0.70707, 0.70707, 0) },
      "eye":              { type: "v3", value: new THREE.Vector3(0, 0, 0) },
      "waterColor":       { type: "c", value: new THREE.Color(0x555555) }
    }
  ] ),

  vertexShader: [
    'uniform mat4 textureMatrix;',
    'uniform float time;',

    'varying vec4 mirrorCoord;',
    'varying vec3 worldPosition;',
    'varying vec3 modelPosition;',
    'varying vec3 surfaceX;',
    'varying vec3 surfaceY;',
    'varying vec3 surfaceZ;',

    'void main()',
    '{',
    '  mirrorCoord = modelMatrix * vec4(position, 1.0);',
    '  worldPosition = mirrorCoord.xyz;',
    '  modelPosition = position;',
    '  surfaceX = vec3( modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]);',
    '  surfaceY = vec3( modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2]);',
    '  surfaceZ = vec3( modelMatrix[2][0], modelMatrix[2][1], modelMatrix[2][2]);',

    '  mirrorCoord = textureMatrix * mirrorCoord;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n'),

  fragmentShader: [
    'uniform sampler2D mirrorSampler;',
    'uniform float alpha;',
    'uniform float time;',
    'uniform float distortionScale;',
    'uniform float noiseScale;',
    'uniform sampler2D normalSampler;',
    'uniform vec3 sunColor;',
    'uniform vec3 sunDirection;',
    'uniform vec3 eye;',
    'uniform vec3 waterColor;',

    'varying vec4 mirrorCoord;',
    'varying vec3 worldPosition;',
    'varying vec3 modelPosition;',
    'varying vec3 surfaceX;',
    'varying vec3 surfaceY;',
    'varying vec3 surfaceZ;',

    'void sunLight(const vec3 surfaceNormal, const vec3 eyeDirection, in float shiny, in float spec, in float diffuse, inout vec3 diffuseColor, inout vec3 specularColor)',
    '{',
    '  vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));',
    '  float direction = max(0.0, dot(eyeDirection, reflection));',
    '  specularColor += pow(direction, shiny) * sunColor * spec;',
    '  diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;',
    '}',

    'vec3 getNoise(in vec2 uv)',
    '{',
    '  vec2 uv0 = uv / (103.0 * noiseScale) + vec2(time / 17.0, time / 29.0);',
    '  vec2 uv1 = uv / (107.0 * noiseScale) - vec2(time / -19.0, time / 31.0);',
    '  vec2 uv2 = uv / (vec2(8907.0, 9803.0) * noiseScale) + vec2(time / 101.0, time /   97.0);',
    '  vec2 uv3 = uv / (vec2(1091.0, 1027.0) * noiseScale) - vec2(time / 109.0, time / -113.0);',
    '  vec4 noise = texture2D(normalSampler, uv0) +',
    '    texture2D(normalSampler, uv1) +',
    '    texture2D(normalSampler, uv2) +',
    '    texture2D(normalSampler, uv3);',
    '  return noise.xyz * 0.5 - 1.0;',
    '}',

    THREE.ShaderChunk[ "common" ],
    THREE.ShaderChunk[ "fog_pars_fragment" ],

    'void main()',
    '{',
    '  vec3 worldToEye = eye - worldPosition;',
    '  vec3 eyeDirection = normalize(worldToEye);',

    // Get noise based on the 3d position
    '  vec3 noise = getNoise(modelPosition.xy * 1.0);',
    '  vec3 distordCoord = noise.x * surfaceX + noise.y * surfaceY;',
    '  vec3 distordNormal = distordCoord + surfaceZ;',

    // Revert normal if the eye is bellow the mesh
    '  if(dot(eyeDirection, surfaceZ) < 0.0)',
    '    distordNormal = distordNormal * -1.0;',

    // Compute diffuse and specular light (use normal and eye direction)
    '  vec3 diffuseLight = vec3(0.0);',
    '  vec3 specularLight = vec3(0.0);',
    '  sunLight(distordNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight);',

    // Compute final 3d distortion, and project it to get the mirror sampling
    '  float distance = length(worldToEye);',
    '  vec2 distortion = distordCoord.xy * distortionScale * sqrt(distance) * 0.07;',
    ' vec3 mirrorDistord = mirrorCoord.xyz + vec3(distortion.x, distortion.y, 0);',
    ' vec3 reflectionSample = texture2DProj(mirrorSampler, mirrorDistord).xyz;',

    // Compute other parameters as the reflectance and the water appareance
    '  float theta = max(dot(eyeDirection, distordNormal), 0.0);',
    '  float reflectance = 0.3 + (1.0 - 0.3) * pow((1.0 - theta), 3.0);',
    '  vec3 scatter = max(0.0, dot(distordNormal, eyeDirection)) * waterColor;',

    // Compute final pixel color
    '  vec3 albedo = mix(sunColor * diffuseLight * 0.3 + scatter, (vec3(0.1) + reflectionSample * 0.9 + reflectionSample * specularLight), reflectance);',

    ' vec3 outgoingLight = albedo;',
    THREE.ShaderChunk[ "fog_fragment" ],

    ' gl_FragColor = vec4( outgoingLight, alpha );',
    '}'
  ].join('\n')

};

THREE.Water = function (renderer, camera, scene, options) {

  THREE.Object3D.call(this);
  this.name = 'water_' + this.id;

  function optionalParameter (value, defaultValue) {
    return value !== undefined ? value : defaultValue;
  };

  options = options || {};

  this.matrixNeedsUpdate = true;

  var width = optionalParameter(options.textureWidth, 512);
  var height = optionalParameter(options.textureHeight, 512);
  this.clipBias = optionalParameter(options.clipBias, -0.0001);
  this.alpha = optionalParameter(options.alpha, 1.0);
  this.time = optionalParameter(options.time, 0.0);
  this.normalSampler = optionalParameter(options.waterNormals, null);
  this.sunDirection = optionalParameter(options.sunDirection, new THREE.Vector3(0.70707, 0.70707, 0.0));
  this.sunColor = new THREE.Color(optionalParameter(options.sunColor, 0xffffff));
  this.waterColor = new THREE.Color(optionalParameter(options.waterColor, 0x7F7F7F));
  this.eye = optionalParameter(options.eye, new THREE.Vector3(0, 0, 0));
  this.distortionScale = optionalParameter(options.distortionScale, 20.0);
  this.noiseScale = optionalParameter(options.noiseScale, 1.0);
  this.side = optionalParameter(options.side, THREE.FrontSide);
  this.fog = optionalParameter(options.fog, false);

  this.renderer = renderer;
  this.scene = scene;
  this.mirrorPlane = new THREE.Plane();
  this.normal = new THREE.Vector3(0, 0, 1);
  this.cameraWorldPosition = new THREE.Vector3();
  this.rotationMatrix = new THREE.Matrix4();
  this.lookAtPosition = new THREE.Vector3(0, 0, -1);
  this.clipPlane = new THREE.Vector4();

  if ( camera instanceof THREE.PerspectiveCamera ) {
    this.camera = camera;
  }
  else  {
    this.camera = new THREE.PerspectiveCamera();
    console.log(this.name + ': camera is not a Perspective Camera!')
  }

  this.textureMatrix = new THREE.Matrix4();

  this.mirrorCamera = this.camera.clone();

  this.texture = new THREE.WebGLRenderTarget(width, height);
  this.tempTexture = new THREE.WebGLRenderTarget(width, height);

  var mirrorShader = THREE.ShaderLib["water"];
  var mirrorUniforms = THREE.UniformsUtils.clone(mirrorShader.uniforms);

  this.material = new THREE.ShaderMaterial({
    fragmentShader: mirrorShader.fragmentShader,
    vertexShader: mirrorShader.vertexShader,
    uniforms: mirrorUniforms,
    transparent: true,
    side: this.side,
    fog: this.fog
  });

  this.mesh = new THREE.Object3D();

  this.material.uniforms.mirrorSampler.value = this.texture;
  this.material.uniforms.textureMatrix.value = this.textureMatrix;
  this.material.uniforms.alpha.value = this.alpha;
  this.material.uniforms.time.value = this.time;
  this.material.uniforms.normalSampler.value = this.normalSampler;
  this.material.uniforms.sunColor.value = this.sunColor;
  this.material.uniforms.waterColor.value = this.waterColor;
  this.material.uniforms.sunDirection.value = this.sunDirection;
  this.material.uniforms.distortionScale.value = this.distortionScale;
  this.material.uniforms.noiseScale.value = this.noiseScale;

  this.material.uniforms.eye.value = this.eye;

  if ( !THREE.Math.isPowerOfTwo(width) || !THREE.Math.isPowerOfTwo(height) ) {
    this.texture.generateMipmaps = false;
    this.tempTexture.generateMipmaps = false;
  }
};

THREE.Water.prototype = Object.create(THREE.Object3D.prototype);

THREE.Water.prototype.renderWithMirror = function (otherMirror) {

  // update the mirror matrix to mirror the current view
  this.updateTextureMatrix();
  this.matrixNeedsUpdate = false;

  // set the camera of the other mirror so the mirrored view is the reference view
  var tempCamera = otherMirror.camera;
  otherMirror.camera = this.mirrorCamera;

  // render the other mirror in temp texture
  otherMirror.render(true);

  // render the current mirror
  this.render();
  this.matrixNeedsUpdate = true;

  // restore material and camera of other mirror
  otherMirror.camera = tempCamera;

  // restore texture matrix of other mirror
  otherMirror.updateTextureMatrix();
};

THREE.Water.prototype.updateTextureMatrix = function () {
  if ( this.parent !== undefined ) {
    this.mesh = this.parent;
  }
  function sign(x) { return x ? x < 0 ? -1 : 1 : 0; }

  this.updateMatrixWorld();
  this.camera.updateMatrixWorld();

  this.cameraWorldPosition.setFromMatrixPosition(this.camera.matrixWorld);

  this.rotationMatrix.extractRotation(this.matrixWorld);

  this.normal = (new THREE.Vector3(0, 0, 1)).applyEuler(this.mesh.rotation);
  var cameraPosition = this.camera.position.clone().sub( this.mesh.position );
  if ( this.normal.dot(cameraPosition) < 0 ) {
    var meshNormal = (new THREE.Vector3(0, 0, 1)).applyEuler(this.mesh.rotation);
    this.normal.reflect(meshNormal);
  }

  var view = this.mesh.position.clone().sub(this.cameraWorldPosition);
  view.reflect(this.normal).negate();
  view.add(this.mesh.position);

  this.rotationMatrix.extractRotation(this.camera.matrixWorld);

  this.lookAtPosition.set(0, 0, -1);
  this.lookAtPosition.applyMatrix4(this.rotationMatrix);
  this.lookAtPosition.add(this.cameraWorldPosition);

  var target = this.mesh.position.clone().sub(this.lookAtPosition);
  target.reflect(this.normal).negate();
  target.add(this.mesh.position);

  this.up.set(0, -1, 0);
  this.up.applyMatrix4(this.rotationMatrix);
  this.up.reflect(this.normal).negate();

  this.mirrorCamera.position.copy(view);
  this.mirrorCamera.up = this.up;
  this.mirrorCamera.lookAt(target);
  this.mirrorCamera.aspect = this.camera.aspect;

  this.mirrorCamera.updateProjectionMatrix();
  this.mirrorCamera.updateMatrixWorld();
  this.mirrorCamera.matrixWorldInverse.getInverse(this.mirrorCamera.matrixWorld);

  // Update the texture matrix
  this.textureMatrix.set(0.5, 0.0, 0.0, 0.5,
              0.0, 0.5, 0.0, 0.5,
              0.0, 0.0, 0.5, 0.5,
              0.0, 0.0, 0.0, 1.0);
  this.textureMatrix.multiply(this.mirrorCamera.projectionMatrix);
  this.textureMatrix.multiply(this.mirrorCamera.matrixWorldInverse);

  // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
  // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
  this.mirrorPlane.setFromNormalAndCoplanarPoint(this.normal, this.mesh.position);
  this.mirrorPlane.applyMatrix4(this.mirrorCamera.matrixWorldInverse);

  this.clipPlane.set(this.mirrorPlane.normal.x, this.mirrorPlane.normal.y, this.mirrorPlane.normal.z, this.mirrorPlane.constant);

  var q = new THREE.Vector4();
  var projectionMatrix = this.mirrorCamera.projectionMatrix;

  q.x = (sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
  q.y = (sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
  q.z = -1.0;
  q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

  // Calculate the scaled plane vector
  var c = new THREE.Vector4();
  c = this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(q));

  // Replacing the third row of the projection matrix
  projectionMatrix.elements[2] = c.x;
  projectionMatrix.elements[6] = c.y;
  projectionMatrix.elements[10] = c.z + 1.0 - this.clipBias;
  projectionMatrix.elements[14] = c.w;

  var worldCoordinates = new THREE.Vector3();
  worldCoordinates.setFromMatrixPosition(this.camera.matrixWorld);
  this.eye = worldCoordinates;
  this.material.uniforms.eye.value = this.eye;
};

THREE.Water.prototype.render = function (isTempTexture) {

  if ( this.matrixNeedsUpdate ) {
    this.updateTextureMatrix();
  }

  this.matrixNeedsUpdate = true;

  // Render the mirrored view of the current scene into the target texture
  if ( this.scene !== undefined && this.scene instanceof THREE.Scene ) {
    // Remove the mirror texture from the scene the moment it is used as render texture
    // https://github.com/jbouny/ocean/issues/7
    this.material.visible = false;

    var renderTexture = (isTempTexture !== undefined && isTempTexture)? this.tempTexture : this.texture;
    this.renderer.render(this.scene, this.mirrorCamera, renderTexture, true);

    this.material.visible = true;
    this.material.uniforms.mirrorSampler.value = renderTexture;
  }

};

THREE.OBJLoader = ( function () {

	// o object_name | g group_name
	var object_pattern           = /^[og]\s*(.+)?/;
	// mtllib file_reference
	var material_library_pattern = /^mtllib /;
	// usemtl material_name
	var material_use_pattern     = /^usemtl /;

	function ParserState() {

		var state = {
			objects  : [],
			object   : {},

			vertices : [],
			normals  : [],
			uvs      : [],

			materialLibraries : [],

			startObject: function ( name, fromDeclaration ) {

				// If the current object (initial from reset) is not from a g/o declaration in the parsed
				// file. We need to use it for the first parsed g/o to keep things in sync.
				if ( this.object && this.object.fromDeclaration === false ) {

					this.object.name = name;
					this.object.fromDeclaration = ( fromDeclaration !== false );
					return;

				}

				var previousMaterial = ( this.object && typeof this.object.currentMaterial === 'function' ? this.object.currentMaterial() : undefined );

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

				this.object = {
					name : name || '',
					fromDeclaration : ( fromDeclaration !== false ),

					geometry : {
						vertices : [],
						normals  : [],
						uvs      : []
					},
					materials : [],
					smooth : true,

					startMaterial: function ( name, libraries ) {

						var previous = this._finalize( false );

						// New usemtl declaration overwrites an inherited material, except if faces were declared
						// after the material, then it must be preserved for proper MultiMaterial continuation.
						if ( previous && ( previous.inherited || previous.groupCount <= 0 ) ) {

							this.materials.splice( previous.index, 1 );

						}

						var material = {
							index      : this.materials.length,
							name       : name || '',
							mtllib     : ( Array.isArray( libraries ) && libraries.length > 0 ? libraries[ libraries.length - 1 ] : '' ),
							smooth     : ( previous !== undefined ? previous.smooth : this.smooth ),
							groupStart : ( previous !== undefined ? previous.groupEnd : 0 ),
							groupEnd   : -1,
							groupCount : -1,
							inherited  : false,

							clone: function ( index ) {
								var cloned = {
									index      : ( typeof index === 'number' ? index : this.index ),
									name       : this.name,
									mtllib     : this.mtllib,
									smooth     : this.smooth,
									groupStart : 0,
									groupEnd   : -1,
									groupCount : -1,
									inherited  : false
								};
								cloned.clone = this.clone.bind(cloned);
								return cloned;
							}
						};

						this.materials.push( material );

						return material;

					},

					currentMaterial: function () {

						if ( this.materials.length > 0 ) {
							return this.materials[ this.materials.length - 1 ];
						}

						return undefined;

					},

					_finalize: function ( end ) {

						var lastMultiMaterial = this.currentMaterial();
						if ( lastMultiMaterial && lastMultiMaterial.groupEnd === -1 ) {

							lastMultiMaterial.groupEnd = this.geometry.vertices.length / 3;
							lastMultiMaterial.groupCount = lastMultiMaterial.groupEnd - lastMultiMaterial.groupStart;
							lastMultiMaterial.inherited = false;

						}

						// Ignore objects tail materials if no face declarations followed them before a new o/g started.
						if ( end && this.materials.length > 1 ) {

							for ( var mi = this.materials.length - 1; mi >= 0; mi-- ) {
								if ( this.materials[ mi ].groupCount <= 0 ) {
									this.materials.splice( mi, 1 );
								}
							}

						}

						// Guarantee at least one empty material, this makes the creation later more straight forward.
						if ( end && this.materials.length === 0 ) {

							this.materials.push({
								name   : '',
								smooth : this.smooth
							});

						}

						return lastMultiMaterial;

					}
				};

				// Inherit previous objects material.
				// Spec tells us that a declared material must be set to all objects until a new material is declared.
				// If a usemtl declaration is encountered while this new object is being parsed, it will
				// overwrite the inherited material. Exception being that there was already face declarations
				// to the inherited material, then it will be preserved for proper MultiMaterial continuation.

				if ( previousMaterial && previousMaterial.name && typeof previousMaterial.clone === 'function' ) {

					var declared = previousMaterial.clone( 0 );
					declared.inherited = true;
					this.object.materials.push( declared );

				}

				this.objects.push( this.object );

			},

			finalize: function () {

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

			},

			parseVertexIndex: function ( value, len ) {

				var index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 3 ) * 3;

			},

			parseNormalIndex: function ( value, len ) {

				var index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 3 ) * 3;

			},

			parseUVIndex: function ( value, len ) {

				var index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 2 ) * 2;

			},

			addVertex: function ( a, b, c ) {

				var src = this.vertices;
				var dst = this.object.geometry.vertices;

				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ], src[ b + 2 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ], src[ c + 2 ] );

			},

			addVertexLine: function ( a ) {

				var src = this.vertices;
				var dst = this.object.geometry.vertices;

				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );

			},

			addNormal: function ( a, b, c ) {

				var src = this.normals;
				var dst = this.object.geometry.normals;

				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ], src[ b + 2 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ], src[ c + 2 ] );

			},

			addUV: function ( a, b, c ) {

				var src = this.uvs;
				var dst = this.object.geometry.uvs;

				dst.push( src[ a + 0 ], src[ a + 1 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ] );

			},

			addUVLine: function ( a ) {

				var src = this.uvs;
				var dst = this.object.geometry.uvs;

				dst.push( src[ a + 0 ], src[ a + 1 ] );

			},

			addFace: function ( a, b, c, ua, ub, uc, na, nb, nc ) {

				var vLen = this.vertices.length;

				var ia = this.parseVertexIndex( a, vLen );
				var ib = this.parseVertexIndex( b, vLen );
				var ic = this.parseVertexIndex( c, vLen );

				this.addVertex( ia, ib, ic );

				if ( ua !== undefined ) {

					var uvLen = this.uvs.length;

					ia = this.parseUVIndex( ua, uvLen );
					ib = this.parseUVIndex( ub, uvLen );
					ic = this.parseUVIndex( uc, uvLen );

					this.addUV( ia, ib, ic );

				}

				if ( na !== undefined ) {

					// Normals are many times the same. If so, skip function call and parseInt.
					var nLen = this.normals.length;
					ia = this.parseNormalIndex( na, nLen );

					ib = na === nb ? ia : this.parseNormalIndex( nb, nLen );
					ic = na === nc ? ia : this.parseNormalIndex( nc, nLen );

					this.addNormal( ia, ib, ic );

				}

			},

			addLineGeometry: function ( vertices, uvs ) {

				this.object.geometry.type = 'Line';

				var vLen = this.vertices.length;
				var uvLen = this.uvs.length;

				for ( var vi = 0, l = vertices.length; vi < l; vi ++ ) {

					this.addVertexLine( this.parseVertexIndex( vertices[ vi ], vLen ) );

				}

				for ( var uvi = 0, l = uvs.length; uvi < l; uvi ++ ) {

					this.addUVLine( this.parseUVIndex( uvs[ uvi ], uvLen ) );

				}

			}

		};

		state.startObject( '', false );

		return state;

	}

	//

	function OBJLoader( manager ) {

		this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;

		this.materials = null;

	};

	OBJLoader.prototype = {

		constructor: OBJLoader,

		load: function ( url, onLoad, onProgress, onError ) {

			var scope = this;

			var loader = new THREE.FileLoader( scope.manager );
			loader.setPath( this.path );
			loader.load( url, function ( text ) {

				onLoad( scope.parse( text ) );

			}, onProgress, onError );

		},

		setPath: function ( value ) {

			this.path = value;

		},

		setMaterials: function ( materials ) {

			this.materials = materials;

			return this;

		},

		parse: function ( text ) {

			var state = new ParserState();

			if ( text.indexOf( '\r\n' ) !== - 1 ) {

				// This is faster than String.split with regex that splits on both
				text = text.replace( /\r\n/g, '\n' );

			}

			if ( text.indexOf( '\\\n' ) !== - 1) {

				// join lines separated by a line continuation character (\)
				text = text.replace( /\\\n/g, '' );

			}

			var lines = text.split( '\n' );
			var line = '', lineFirstChar = '';
			var lineLength = 0;
			var result = [];

			// Faster to just trim left side of the line. Use if available.
			var trimLeft = ( typeof ''.trimLeft === 'function' );

			for ( var i = 0, l = lines.length; i < l; i ++ ) {

				line = lines[ i ];

				line = trimLeft ? line.trimLeft() : line.trim();

				lineLength = line.length;

				if ( lineLength === 0 ) continue;

				lineFirstChar = line.charAt( 0 );

				// @todo invoke passed in handler if any
				if ( lineFirstChar === '#' ) continue;

				if ( lineFirstChar === 'v' ) {

					var data = line.split( /\s+/ );

					switch ( data[ 0 ] ) {

						case 'v':
							state.vertices.push(
								parseFloat( data[ 1 ] ),
								parseFloat( data[ 2 ] ),
								parseFloat( data[ 3 ] )
							);
							break;
						case 'vn':
							state.normals.push(
								parseFloat( data[ 1 ] ),
								parseFloat( data[ 2 ] ),
								parseFloat( data[ 3 ] )
							);
							break;
						case 'vt':
							state.uvs.push(
								parseFloat( data[ 1 ] ),
								parseFloat( data[ 2 ] )
							);
							break;
					}

				} else if ( lineFirstChar === 'f' ) {

					var lineData = line.substr( 1 ).trim();
					var vertexData = lineData.split( /\s+/ );
					var faceVertices = [];

					// Parse the face vertex data into an easy to work with format

					for ( var j = 0, jl = vertexData.length; j < jl; j ++ ) {

						var vertex = vertexData[ j ];

						if ( vertex.length > 0 ) {

							var vertexParts = vertex.split( '/' );
							faceVertices.push( vertexParts );

						}

					}

					// Draw an edge between the first vertex and all subsequent vertices to form an n-gon

					var v1 = faceVertices[ 0 ];

					for ( var j = 1, jl = faceVertices.length - 1; j < jl; j ++ ) {

						var v2 = faceVertices[ j ];
						var v3 = faceVertices[ j + 1 ];

						state.addFace(
							v1[ 0 ], v2[ 0 ], v3[ 0 ],
							v1[ 1 ], v2[ 1 ], v3[ 1 ],
							v1[ 2 ], v2[ 2 ], v3[ 2 ]
						);

					}

				} else if ( lineFirstChar === 'l' ) {

					var lineParts = line.substring( 1 ).trim().split( " " );
					var lineVertices = [], lineUVs = [];

					if ( line.indexOf( "/" ) === - 1 ) {

						lineVertices = lineParts;

					} else {

						for ( var li = 0, llen = lineParts.length; li < llen; li ++ ) {

							var parts = lineParts[ li ].split( "/" );

							if ( parts[ 0 ] !== "" ) lineVertices.push( parts[ 0 ] );
							if ( parts[ 1 ] !== "" ) lineUVs.push( parts[ 1 ] );

						}

					}
					state.addLineGeometry( lineVertices, lineUVs );

				} else if ( ( result = object_pattern.exec( line ) ) !== null ) {

					// o object_name
					// or
					// g group_name

					// WORKAROUND: https://bugs.chromium.org/p/v8/issues/detail?id=2869
					// var name = result[ 0 ].substr( 1 ).trim();
					var name = ( " " + result[ 0 ].substr( 1 ).trim() ).substr( 1 );

					state.startObject( name );

				} else if ( material_use_pattern.test( line ) ) {

					// material

					state.object.startMaterial( line.substring( 7 ).trim(), state.materialLibraries );

				} else if ( material_library_pattern.test( line ) ) {

					// mtl file

					state.materialLibraries.push( line.substring( 7 ).trim() );

				} else if ( lineFirstChar === 's' ) {

					result = line.split( ' ' );

					// smooth shading

					// @todo Handle files that have varying smooth values for a set of faces inside one geometry,
					// but does not define a usemtl for each face set.
					// This should be detected and a dummy material created (later MultiMaterial and geometry groups).
					// This requires some care to not create extra material on each smooth value for "normal" obj files.
					// where explicit usemtl defines geometry groups.
					// Example asset: examples/models/obj/cerberus/Cerberus.obj

					/*
					 * http://paulbourke.net/dataformats/obj/
					 * or
					 * http://www.cs.utah.edu/~boulos/cs3505/obj_spec.pdf
					 *
					 * From chapter "Grouping" Syntax explanation "s group_number":
					 * "group_number is the smoothing group number. To turn off smoothing groups, use a value of 0 or off.
					 * Polygonal elements use group numbers to put elements in different smoothing groups. For free-form
					 * surfaces, smoothing groups are either turned on or off; there is no difference between values greater
					 * than 0."
					 */
					if ( result.length > 1 ) {

						var value = result[ 1 ].trim().toLowerCase();
						state.object.smooth = ( value !== '0' && value !== 'off' );

					} else {

						// ZBrush can produce "s" lines #11707
						state.object.smooth = true;

					}
					var material = state.object.currentMaterial();
					if ( material ) material.smooth = state.object.smooth;

				} else {

					// Handle null terminated files without exception
					if ( line === '\0' ) continue;

					throw new Error( "Unexpected line: '" + line  + "'" );

				}

			}

			state.finalize();

			var container = new THREE.Group();
			container.materialLibraries = [].concat( state.materialLibraries );

			for ( var i = 0, l = state.objects.length; i < l; i ++ ) {

				var object = state.objects[ i ];
				var geometry = object.geometry;
				var materials = object.materials;
				var isLine = ( geometry.type === 'Line' );

				// Skip o/g line declarations that did not follow with any faces
				if ( geometry.vertices.length === 0 ) continue;

				var buffergeometry = new THREE.BufferGeometry();

				buffergeometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( geometry.vertices ), 3 ) );

				if ( geometry.normals.length > 0 ) {

					buffergeometry.addAttribute( 'normal', new THREE.BufferAttribute( new Float32Array( geometry.normals ), 3 ) );

				} else {

					buffergeometry.computeVertexNormals();

				}

				if ( geometry.uvs.length > 0 ) {

					buffergeometry.addAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( geometry.uvs ), 2 ) );

				}

				// Create materials

				var createdMaterials = [];

				for ( var mi = 0, miLen = materials.length; mi < miLen ; mi++ ) {

					var sourceMaterial = materials[ mi ];
					var material = undefined;

					if ( this.materials !== null ) {

						material = this.materials.create( sourceMaterial.name );

						// mtl etc. loaders probably can't create line materials correctly, copy properties to a line material.
						if ( isLine && material && ! ( material instanceof THREE.LineBasicMaterial ) ) {

							var materialLine = new THREE.LineBasicMaterial();
							materialLine.copy( material );
							material = materialLine;

						}

					}

					if ( ! material ) {

						material = ( ! isLine ? new THREE.MeshPhongMaterial() : new THREE.LineBasicMaterial() );
						material.name = sourceMaterial.name;

					}

					material.flatShading = sourceMaterial.smooth ? false : true;

					createdMaterials.push(material);

				}

				// Create mesh

				var mesh;

				if ( createdMaterials.length > 1 ) {

					for ( var mi = 0, miLen = materials.length; mi < miLen ; mi++ ) {

						var sourceMaterial = materials[ mi ];
						buffergeometry.addGroup( sourceMaterial.groupStart, sourceMaterial.groupCount, mi );

					}

					mesh = ( ! isLine ? new THREE.Mesh( buffergeometry, createdMaterials ) : new THREE.LineSegments( buffergeometry, createdMaterials ) );

				} else {

					mesh = ( ! isLine ? new THREE.Mesh( buffergeometry, createdMaterials[ 0 ] ) : new THREE.LineSegments( buffergeometry, createdMaterials[ 0 ] ) );
				}

				mesh.name = object.name;

				container.add( mesh );

			}

			return container;

		}

	};

	return OBJLoader;

} )();
