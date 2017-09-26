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
    world.gravity.set(0, -9.82, 0);
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
      position: new CANNON.Vec3(0, -0.22, 0),
    });
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
    world.add(groundBody);

    // objects (three.js mesh <-> cannon.js body pairs)
    const objects = [];

    // cube
    for (let i = 0; i < 50; ++i) {
      const cube = {}
      cube.mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.07),
        new THREE.MeshPhongMaterial({
          color: new THREE.Color(Math.random(), Math.random(), Math.random()),
        }));
      scene.add(cube.mesh);
      cube.body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(0.035, 0.035, 0.035)),
        position: new CANNON.Vec3(Math.random() - 0.5, 0.5 + 3 * Math.random(), -2 + Math.random() - 0.5),
      });
      world.add(cube.body);
      cube.body.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/4 + 0.02);
      objects.push(cube);
    }

    // main loop
    const animate = () => {
      // update world
      world.step(1/ 60);

      // update objects
      objects.forEach(({ mesh, body }) => {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      });

      // end frame and schedule new one!
      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(animate);
    }
    animate();
  }
}
