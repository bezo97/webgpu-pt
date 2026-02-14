import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

export default function createGUI(containerElement, renderer) {
  const pane = new Pane({
    container: containerElement,
    title: "WebGPU-pt",
    expanded: true,
  });

  let selectedObjectIndex = null;
  // Represents what the next click on the canvas will do (select, setPosition, lookAt, focus, etc.)
  let clickAction = null;

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
  pane.addBinding(renderer, "total_accumulation_steps", {
    label: "Total accumulation",
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

  const renderSettingsPane = pane.addFolder({
    title: "Render settings",
    expanded: false,
  });
  renderSettingsPane.on("change", (a) => {
    renderer.invalidateAccumulation();
  });

  renderSettingsPane.addBinding(renderer.scene.settings.render_settings, "max_bounces", {
    min: 1,
    max: 20,
    step: 1,
  });
  renderSettingsPane.addBinding(renderer.scene.settings.render_settings, "russian_roulette_start_bounce", {
    min: 1,
    max: 20,
    step: 1,
  });
  renderSettingsPane.addBinding(renderer.scene.settings.render_settings, "russian_roulette_min_p_reflect", {
    min: 0,
    max: 1,
    step: 0.01,
  });
  renderSettingsPane.addBinding(renderer.scene.settings.render_settings, "russian_roulette_min_p_refract", {
    min: 0,
    max: 1,
    step: 0.01,
  });

  const sceneSettingsPane = pane.addFolder({
    title: "Scene",
    expanded: true,
  });
  sceneSettingsPane.on("change", (a) => {
    renderer.invalidateAccumulation();
  });

  // Store references to current object editor pane and button for button reset
  let currentObjectEditorPane = null;
  let currentSetPositionButton = null;

  renderer.canvas.addEventListener("click", async (event) => {
    if (selectedObjectIndex !== null && clickAction === "position") {
      const canvas = renderer.canvas;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const depth = await renderer.getDepthAt(x, y);
      if (depth !== undefined && depth > 0) {
        const worldPos = renderer.screenToWorld(x, y, depth);
        renderer.scene.objects[selectedObjectIndex].position = worldPos;

        // Deactivate click-to-position
        selectedObjectIndex = null;
        clickAction = null;

        if (currentSetPositionButton) {
          currentSetPositionButton.title = "🎯 Set from canvas";
          currentSetPositionButton.label = "position";
        }
        currentObjectEditorPane?.refresh();

        renderer.invalidateAccumulation();
        // Ensure rendering continues after accumulation is reset
        if (!renderer.isRendering) {
          renderer.startRendering();
        }
      } else {
        console.log("No depth data available at clicked position");
      }
    } else if (clickAction === "focus") {
      const canvas = renderer.canvas;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const depth = await renderer.getDepthAt(x, y);
      if (depth !== undefined && depth > 0) {
        // Set focus distance to the depth at clicked position
        renderer.scene.settings.cam.focus_distance = depth;

        // Deactivate click-to-focus
        clickAction = null;

        if (setFocusButton) {
          setFocusButton.title = "🎯 Set from canvas";
          setFocusButton.label = "focus";
        }

        // Refresh the camera pane to update the focus_distance slider
        cameraPane.refresh();

        renderer.invalidateAccumulation();
        // Ensure rendering continues after accumulation is reset
        if (!renderer.isRendering) {
          renderer.startRendering();
        }
      } else {
        console.log("No depth data available at clicked position");
      }
    }
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
    label: "Field of view (degrees)",
    min: 1,
    max: 120,
  });
  cameraPane.addBinding(renderer.scene.settings.cam, "dof_size", {
    label: "Depth of field size",
    min: 0,
    max: 0.2,
  });
  cameraPane.addBinding(renderer.scene.settings.cam, "focus_distance", {
    min: 0,
    max: 10,
  });

  // Store reference to the set focus button for button reset
  let setFocusButton = null;

  const setFocusFromCanvasButton = cameraPane.addButton({
    title: "🎯 Set from canvas",
    label: "focus",
  });
  setFocusFromCanvasButton.on("click", () => {
    if (clickAction === "focus") {
      clickAction = null;
      setFocusButton = null;
      setFocusFromCanvasButton.title = "🎯 Set from canvas";
      setFocusFromCanvasButton.label = "focus";
    } else {
      clickAction = "focus";
      setFocusButton = setFocusFromCanvasButton;
      setFocusFromCanvasButton.title = "❌ Cancel focus setting";
      setFocusFromCanvasButton.label = "focus";
    }
  });
  cameraPane
    .addButton({
      title: "⟲",
      label: "Reset",
    })
    .on("click", () => {
      renderer.scene.settings.cam.position = { x: 0.0, y: 1.0, z: -5.0 };
      renderer.scene.settings.cam.right = { x: 1.0, y: 0.0, z: 0.0 };
      renderer.scene.settings.cam.up = { x: 0.0, y: 1.0, z: 0.0 };
      renderer.scene.settings.cam.forward = { x: 0.0, y: 0.0, z: 1.0 };
      renderer.invalidateAccumulation();
    });

  const tab = sceneSettingsPane.addTab({
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

    const setPositionFromCanvasButton = objectEditorPane.addButton({
      title: "🎯 Set from canvas",
      label: "position",
    });
    setPositionFromCanvasButton.on("click", () => {
      if (clickAction === "position") {
        clickAction = null;
        currentObjectEditorPane = null;
        currentSetPositionButton = null;
        selectedObjectIndex = null;
        setPositionFromCanvasButton.title = "🎯 Set from canvas";
        setPositionFromCanvasButton.label = "position";
      } else {
        clickAction = "position";
        currentObjectEditorPane = objectEditorPane;
        currentSetPositionButton = setPositionFromCanvasButton;
        selectedObjectIndex = renderer.scene.objects.indexOf(obj);
        setPositionFromCanvasButton.title = "❌ Cancel positioning";
        setPositionFromCanvasButton.label = "position";
      }
    });

    const deleteObjectButton = objectEditorPane.addButton({
      title: "🗑",
      label: "Delete object",
    });
    deleteObjectButton.on("click", () => {});
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
    materialEditorPane.addBinding(mat, "roughness", {
      min: 0,
      max: 1,
    });
    materialEditorPane.addBinding(mat, "metallic", {
      min: 0,
      max: 1,
    });
  }
}
