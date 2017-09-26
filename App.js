import Expo from 'expo';
import React from 'react';

import * as THREE from 'three';
import ExpoTHREE from 'expo-three';
import * as CANNON from 'cannon';

console.disableYellowBox = true;

export default class App extends React.Component {
  render() {
    return (
      <Expo.GLView
        ref={(ref) => this._glView = ref}
        style={{ flex: 1 }}
        onContextCreate={this._onGLContextCreate}
      />
    );
  }

  _onGLContextCreate = async (gl) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    // ar init
    // const arSession = await this._glView.startARSessionAsync();

    // three.js init
    const scene = new THREE.Scene();
    // scene.background = ExpoTHREE.createARBackgroundTexture(arSession, renderer);
    // const camera = ExpoTHREE.createARCamera(arSession, width, height, 0.01, 1000);
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 1000);
    const renderer = ExpoTHREE.createRenderer({ gl });
    renderer.setSize(width, height);

    // cannon.js init
    const world = new CANNON.World();
    world.gravity.set(0, 0, -9.82);
    world.broadphase = new CANNON.NaiveBroadphase();

    // lights
    const dirLight = new THREE.DirectionalLight(0xffffff);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);
    const ambLight = new THREE.AmbientLight(0x404040);
    scene.add(ambLight);

    // ground
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
    });
    world.add(groundBody);

    // cube
    const cubeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.07),
      new THREE.MeshPhongMaterial({ color: 0x00ff00 }));
    cubeMesh.position.z = -0.4;
    scene.add(cubeMesh);

    // main loop
    const animate = () => {
      // rotate cube
      cubeMesh.rotation.x += 0.07;
      cubeMesh.rotation.y += 0.04;

      // end frame and schedule new one!
      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(animate);
    }
    animate();
  }
}
