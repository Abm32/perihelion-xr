import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';

/** Browser-side welcome card with the Enter XR button. Hidden once immersive. */
export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    if (panel == null || xrButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      return;
    }
    const launchXR = () => this.world.launchXR();
    xrButton.addEventListener('click', launchXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      this.world.visibilityState.subscribe((state) => {
        panel.visible = state === VisibilityState.NonImmersive;
      }),
    );
  }
}
