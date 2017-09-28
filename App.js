import Expo, { Asset } from 'expo';
import React from 'react';
import { View, PanResponder } from 'react-native';

const THREE = require('three');
global.THREE = THREE;
require('./OBJLoader');
require('./Water');
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

    // model and texture assets
    let modelAsset = Asset.fromModule(require('./assets/wooden-duck.obj'));
    let textureAsset = Asset.fromModule(require('./assets/wooden-duck.png'));

    // preload assets
    await Promise.all([
      modelAsset.downloadAsync(),
      textureAsset.downloadAsync(),
    ]);

    // model
    const loader = new THREE.OBJLoader();
    const model = await new Promise((resolve, reject) => 
      loader.load(
        modelAsset.uri,
        resolve,
        () => {}, 
        reject
      )
    );

    // texture
    const ballTexture = new THREE.Texture();
    ballTexture.image = {
      data: textureAsset,
      width: textureAsset.width,
      height: textureAsset.height,
    };
    ballTexture.needsUpdate = true;
    ballTexture.isDataTexture = true; // send to gl.texImage2D() verbatim
    const ballMaterial =  new THREE.MeshPhongMaterial({map: ballTexture});

    scaleLongestSideToSize(model, 0.18);

    // ball
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
