import Expo from 'expo';
import React from 'react';

import * as THREE from 'three';
import ExpoTHREE from 'expo-three';

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

    // lights
    const dirLight = new THREE.DirectionalLight(0xffffff);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);
    const ambLight = new THREE.AmbientLight(0x404040);
    scene.add(ambLight);

    // cube
    const geometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.z = -0.4;
    scene.add(cube);

    // main loop
    const animate = () => {
      // rotate cube
      cube.rotation.x += 0.07;
      cube.rotation.y += 0.04;

      // end frame and schedule new one!
      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(animate);
    }
    animate();
  }
}
