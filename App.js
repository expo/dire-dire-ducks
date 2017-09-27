import Expo from 'expo';
import React from 'react';
import { PanResponder } from 'react-native';

const THREE = require('three');
global.THREE = THREE;
require('three/examples/js/loaders/OBJLoader');
import ExpoTHREE from 'expo-three';
import * as CANNON from 'cannon';

const WATER_Y = -0.15;

console.disableYellowBox = true;

if (!console.time) {
  console.time = () => {};
}
if (!console.timeEnd) {
  console.timeEnd = () => {};
}

const scaleLongestSideToSize = (mesh, size) => {
  const { x: width, y: height, z: depth } =
    new THREE.Box3().setFromObject(mesh).size();
  const longest = Math.max(width, Math.max(height, depth));
  const scale = size / longest;
  mesh.scale.set(scale, scale, scale);
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
      <Expo.GLView
        {...this.panResponder.panHandlers}
        ref={(ref) => this._glView = ref}
        style={{ flex: 1 }}
        onContextCreate={this._onGLContextCreate}
      />
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
    const buoyancy = 20;
    const animate = () => {
      // calculate camera position
      camera.position.setFromMatrixPosition(camera.matrixWorld);
      const cameraPos = new THREE.Vector3(0, 0, 0);
      cameraPos.applyMatrix4(camera.matrixWorld);

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
