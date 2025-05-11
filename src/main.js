import defaultScene from "./defaultScene.js";
import { Renderer } from "./rendering/renderer.js";
import createGUI from "./gui.js";
import { setupCameraControls } from "./controls.js";

const canvas = document.getElementById("main_display");
const sidepanel = document.getElementById("sidepanel");

const renderer = new Renderer(canvas);
setupCameraControls(renderer, canvas);
renderer.scene = defaultScene;
createGUI(sidepanel, renderer);
await renderer.initialize();
renderer.startRendering();
