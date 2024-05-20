import defaultScene from "./defaultScene.js";
import { Renderer } from "./rendering/renderer.js";
import createGUI from "./gui.js";

const canvas = document.getElementById("main_display");
const sidepanel = document.getElementById("sidepanel");
const renderer = new Renderer(canvas);

//setup input
canvas.onmousemove = (event) => {
  if (event.buttons == 1) {
    const mouseX = event.offsetX / canvas.width;
    const mouseY = 1 - event.offsetY / canvas.height;
    renderer.scene.settings.cam.position.x = -3 + 6 * mouseX;
    renderer.scene.settings.cam.position.z = -10 + 10 * mouseY;
    renderer.invalidateAccumulation();
  }
};

//setup renderer
renderer.scene = defaultScene;

//setup gui
createGUI(sidepanel, renderer);

await renderer.initialize();

renderer.startRendering();
