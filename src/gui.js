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

  let selectedObject = renderer.scene.objects[0];

  objectsPane
    .addBlade({
      view: "list",
      label: "objects",
      options: renderer.scene.objects.map((v, i) => {
        return {
          text: `${i}`,
          value: i,
        };
      }),
      value: 0,
    })
    .on("change", (i) => {
      selectedObject = renderer.scene.objects[i];
    });

  const objectEditorPane = objectsPane.addFolder({
    title: "Edit Selection",
    expanded: true,
  });

  objectEditorPane.addBinding(selectedObject, "position", {
    picker: "inline",
    expanded: true,
    x: { min: -10, max: 10 },
    y: { min: -10, max: 10 },
    z: { min: -10, max: 10 },
  });

  objectEditorPane.addBinding(selectedObject, "scale", {
    min: 0,
    max: 5,
  });

  const deleteObjectButton = objectEditorPane
    .addButton({
      title: "🗑",
      label: "Delete object",
    })
    .on("click", () => {});

  const addMaterialButton = materialsPane
    .addButton({
      title: "+",
      label: "Add material",
    })
    .on("click", () => {});

  let selectedMaterial = renderer.scene.materials[0];

  materialsPane
    .addBlade({
      view: "list",
      label: "materials",
      options: renderer.scene.materials.map((v, i) => {
        return {
          text: v.name,
          value: i,
        };
      }),
      value: 0,
    })
    .on("change", (i) => {
      selectedMaterial = renderer.scene.materials[i];
    });

  const materialEditorPane = materialsPane.addFolder({
    title: "Edit Selection",
    expanded: true,
  });

  materialEditorPane.addBinding(selectedMaterial, "material_type", {
    options: {
      diffuse: 0,
      reflective: 1,
      refractive: 2,
    },
  });

  materialEditorPane.addBinding(selectedMaterial, "albedo", {
    view: "color",
    picker: "inline",
    expanded: true,
    color: { type: "float", alpha: false },
  });
}
