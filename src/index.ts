import { DepthSensingSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { OrrerySystem } from './orrery.js';
import { PanelSystem } from './panel.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Real hands and objects hide the board. Depth is requested as optional, so
  // on a device without it the system idles. `?occlusion=0` turns it off.
  if (new URLSearchParams(location.search).get('occlusion') !== '0') {
    world.registerSystem(DepthSensingSystem, {
      configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true, blurRadius: 20 },
    });
  }
  world.registerSystem(OrrerySystem);
  world.registerSystem(PanelSystem);
});
