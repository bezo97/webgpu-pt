import defaultScene from "./defaultScene.js";
import { Renderer } from "./rendering/renderer.js";
import GUI from "./gui.js";

const canvas = document.getElementById("main_display");
const sidepanel = document.getElementById("sidepanel");
const messageBox = document.getElementById("message");

const renderer = new Renderer(canvas);
renderer.scene = defaultScene;
try {
  await renderer.initialize();
} catch (e) {
  messageBox.innerText = "Failed to initialize: " + e;
}
renderer.startRendering();

const gui = new GUI(sidepanel, renderer);
gui.initialize();
