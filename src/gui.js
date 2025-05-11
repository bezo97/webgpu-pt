import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js";

export default function createGUI(containerElement, renderer) {
  const pane = new Pane({
    container: containerElement,
    title: "WebGPU-pt",
    expanded: true,
  });

  const startStopButton = pane
    .addButton({
      title: "⏸️",
      label: "Start/Stop",
    })
    .on("click", () => {
      if (renderer.isRendering) renderer.stopRendering();
      else renderer.startRendering();
      startStopButton.title = renderer.isRendering ? "⏸️" : "▶️";
    });
  pane.addBinding(renderer, "isRendering", {
    readonly: true,
  });
  pane.addBinding(renderer, "targetFramerate", {
    min: 1,
    max: 60,
    step: 1,
  });
  pane.addBinding(renderer, "workload_accumulation_steps", {
    label: "Workload size",
    readonly: true,
    format: (v) => v.toFixed(0) + " steps",
  });
  pane.addBinding(renderer, "framerate", {
    readonly: true,
    format: (v) => v.toFixed(0) + " FPS",
  });
  pane.addBinding(renderer, "framerate", {
    readonly: true,
    view: "graph",
    min: 0,
    max: 61,
  });

  pane.addBlade({
    view: "separator",
  });

  const sceneSettingsPane = pane.addFolder({
    title: "Scene",
    expanded: true,
  });
  sceneSettingsPane.on("change", (a) => {
    renderer.invalidateAccumulation();
  });

  sceneSettingsPane.addBinding(renderer.scene.settings, "sky_color", {
    view: "color",
    picker: "inline",
    expanded: false,
    color: { type: "float", alpha: false },
  });

  const cameraPane = sceneSettingsPane.addFolder({
    title: "Camera",
    expanded: false,
  });
  cameraPane.addBinding(renderer.scene.settings.cam, "fov_angle", {
    min: 1,
    max: 60,
  });
  cameraPane
    .addButton({
      title: "⟲",
      label: "Reset",
    })
    .on("click", () => {
      renderer.scene.settings.cam.position = { x: 0.0, y: 1.0, z: -10.0 };
      renderer.scene.settings.cam.right = { x: 1.0, y: 0.0, z: 0.0 };
      renderer.scene.settings.cam.up = { x: 0.0, y: 1.0, z: 0.0 };
      renderer.scene.settings.cam.forward = { x: 0.0, y: 0.0, z: 1.0 };
      renderer.invalidateAccumulation();
    });

  const tab = pane.addTab({
    pages: [{ title: "Objects" }, { title: "Materials" }],
  });
  tab.on("change", (a) => {
    renderer.invalidateAccumulation();
  });
  const objectsPane = tab.pages[0];
  const materialsPane = tab.pages[1];

  const addObjectButton = objectsPane
    .addButton({
      title: "+",
      label: "Add object",
    })
    .on("click", () => {});

  let material_options = {};
  for (let i = 0; i < renderer.scene.materials.length; i++) material_options[renderer.scene.materials[i].name] = i;

  for (const obj of renderer.scene.objects) {
    const objectEditorPane = objectsPane.addFolder({
      title: "object",
      expanded: false,
    });

    objectEditorPane.addBinding(obj, "object_type", {
      options: {
        sphere: 0,
        fractal: 1,
      },
    });

    objectEditorPane.addBinding(obj, "material_index", {
      label: "Material",
      options: material_options,
    });

    objectEditorPane.addBinding(obj, "position", {
      picker: "inline",
      expanded: true,
      x: { min: -10, max: 10 },
      y: { min: -10, max: 10 },
      z: { min: -10, max: 10 },
    });

    objectEditorPane.addBinding(obj, "scale", {
      min: 0,
      max: 5,
    });

    const deleteObjectButton = objectEditorPane
      .addButton({
        title: "🗑",
        label: "Delete object",
      })
      .on("click", () => {});
  }

  const addMaterialButton = materialsPane
    .addButton({
      title: "+",
      label: "Add material",
    })
    .on("click", () => {});

  for (const mat of renderer.scene.materials) {
    const materialEditorPane = materialsPane.addFolder({
      title: mat.name,
      expanded: false,
    });

    materialEditorPane.addBinding(mat, "material_type", {
      options: {
        diffuse: 0,
        reflective: 1,
        refractive: 2,
      },
    });

    materialEditorPane.addBinding(mat, "albedo", {
      view: "color",
      picker: "inline",
      expanded: true,
      color: { type: "float", alpha: false },
    });

    materialEditorPane.addBinding(mat, "emission", {
      view: "color",
      picker: "inline",
      expanded: true,
      color: { type: "float", alpha: false },
    });
  }
}
