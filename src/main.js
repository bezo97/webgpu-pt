import defaultScene from "./defaultScene.js";
import { Renderer } from "./rendering/renderer.js";

const canvas = document.getElementById("main_display");
const renderer = new Renderer(canvas);

//setup input
canvas.onmousemove = (event) => {
  if (event.buttons == 1) {
    const mouseX = event.offsetX / canvas.width;
    const mouseY = 1 - event.offsetY / canvas.height;
    renderer.scene.objects[1].position[0] = -3 + 6 * mouseX;
    renderer.scene.objects[1].position[1] = 4 * mouseY;
    renderer.invalidateAccumulation();
  }
};

//setup renderer
renderer.scene = defaultScene;
await renderer.initialize();

renderer.startRendering();
