import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";
import { MoveTool } from "./moveTool.js";
import { ZoomTool } from "./zoomTool.js";

export default class GUI {
  constructor(mainPaneContainer, toolsPaneContainer, renderer) {
    this.mainPaneContainer = mainPaneContainer;
    this.toolsPaneContainer = toolsPaneContainer;
    this.renderer = renderer;
    this.mainPane = null;
    this.toolsPane = null;
    this.tools = [];
    this.activeTool = null;
    this.selectedObjectIndex = null;
    this.clickAction = null;
    this.currentObjectEditorPane = null;
    this.currentSetPositionButton = null;
    this.setFocusButton = null;
    this.cameraPane = null;
  }

  initialize = () => {
    this.mainPane = new Pane({
      container: this.mainPaneContainer,
      title: "WebGPU-pt",
      expanded: true,
    });

    this.toolsPane = new Pane({
      container: this.toolsPaneContainer,
      title: "Tools",
      expanded: true,
    });

    // init tools
    this.tools = [new ZoomTool(this.renderer), new MoveTool(this.renderer)];
    for (const tool of this.tools) {
      tool.createGUI(this.toolsPane, () => this.activateTool(tool));
    }

    // prevent context menu whenever a tool is active
    this.renderer.canvas.addEventListener("contextmenu", (event) => {
      if (this.activeTool) {
        event.preventDefault();
      }
    });

    // Setup click-to-position/focus
    this.setupClickToPosition();

    // Setup render settings
    this.setupRenderSettings();

    // Setup scene settings
    this.setupSceneSettings();

    // Activate the initial tool
    this.activateTool(this.tools[0]);
  };

  activateTool = (tool) => {
    const currentTool = this.activeTool;

    if (currentTool) {
      currentTool.deactivate();
      this.activeTool = null;
    }

    if (tool === currentTool) {
      return; // just deactivate the selected tool
    }

    // Activate the new tool
    this.activeTool = tool;
    this.activeTool.activate(null);
  };

  setupClickToPosition = () => {
    this.renderer.canvas.addEventListener("click", async (event) => {
      if (this.selectedObjectIndex !== null && this.clickAction === "position") {
        const canvas = this.renderer.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const depth = await this.renderer.getDepthAt(x, y);
        if (depth !== undefined && depth > 0) {
          const worldPos = this.renderer.screenToWorld(x, y, depth);
          this.renderer.scene.objects[this.selectedObjectIndex].position = worldPos;

          // Deactivate click-to-position
          this.selectedObjectIndex = null;
          this.clickAction = null;

          if (this.currentSetPositionButton) {
            this.currentSetPositionButton.title = "🎯 Set from canvas";
            this.currentSetPositionButton.label = "position";
            this.currentSetPositionButton = null;
          }

          if (this.currentObjectEditorPane) {
            this.currentObjectEditorPane.refresh();
          }

          this.renderer.invalidateAccumulation();
          if (!this.renderer.isRendering) {
            this.renderer.startRendering();
          }
        } else {
          console.log("No depth data available at clicked position");
        }
      } else if (this.clickAction === "focus") {
        const canvas = this.renderer.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const depth = await this.renderer.getDepthAt(x, y);
        if (depth !== undefined && depth > 0) {
          this.renderer.scene.settings.cam.focus_distance = depth;

          // Deactivate click-to-focus
          this.clickAction = null;

          if (this.setFocusButton) {
            this.setFocusButton.title = "🎯 Set from canvas";
            this.setFocusButton.label = "focus";
            this.setFocusButton = null;
          }

          this.cameraPane.refresh();

          this.renderer.invalidateAccumulation();
          if (!this.renderer.isRendering) {
            this.renderer.startRendering();
          }
        } else {
          throw new Error("No depth data available at clicked position");
        }
      }
    });
  };

  setupRenderSettings = () => {
    const startStopButton = this.mainPane.addButton({
      title: "⏸️",
      label: "Start/Stop",
    });
    startStopButton.on("click", () => {
      if (this.renderer.isRendering) this.renderer.stopRendering();
      else this.renderer.startRendering();
      startStopButton.title = this.renderer.isRendering ? "⏸️" : "▶️";
    });
    this.mainPane.addBinding(this.renderer, "isRendering", {
      readonly: true,
    });
    this.mainPane.addBinding(this.renderer, "targetFramerate", {
      min: 1,
      max: 60,
      step: 1,
    });
    this.mainPane.addBinding(this.renderer, "workload_accumulation_steps", {
      label: "Workload size",
      readonly: true,
      format: (v) => v.toFixed(0) + " steps",
    });
    this.mainPane.addBinding(this.renderer, "total_accumulation_steps", {
      label: "Total accumulation",
      readonly: true,
      format: (v) => v.toFixed(0) + " steps",
    });
    this.mainPane.addBinding(this.renderer, "framerate", {
      readonly: true,
      format: (v) => v.toFixed(0) + " FPS",
    });
    this.mainPane.addBinding(this.renderer, "framerate", {
      readonly: true,
      view: "graph",
      min: 0,
      max: 61,
    });

    this.mainPane.addBlade({
      view: "separator",
    });

    const renderSettingsPane = this.mainPane.addFolder({
      title: "Render settings",
      expanded: false,
    });
    renderSettingsPane.on("change", () => {
      this.renderer.invalidateAccumulation();
    });

    renderSettingsPane.addBinding(this.renderer.scene.settings.render_settings, "max_bounces", {
      min: 1,
      max: 20,
      step: 1,
    });
    renderSettingsPane.addBinding(this.renderer.scene.settings.render_settings, "russian_roulette_start_bounce", {
      min: 1,
      max: 20,
      step: 1,
    });
    renderSettingsPane.addBinding(this.renderer.scene.settings.render_settings, "russian_roulette_min_p_reflect", {
      min: 0,
      max: 1,
      step: 0.01,
    });
    renderSettingsPane.addBinding(this.renderer.scene.settings.render_settings, "russian_roulette_min_p_refract", {
      min: 0,
      max: 1,
      step: 0.01,
    });
  };

  setupSceneSettings = () => {
    const sceneSettingsPane = this.mainPane.addFolder({
      title: "Scene",
      expanded: true,
    });
    sceneSettingsPane.on("change", () => {
      this.renderer.invalidateAccumulation();
    });

    sceneSettingsPane.addBinding(this.renderer.scene.settings, "sky_color", {
      view: "color",
      picker: "inline",
      expanded: false,
      color: { type: "float", alpha: false },
    });

    this.cameraPane = sceneSettingsPane.addFolder({
      title: "Camera",
      expanded: false,
    });
    this.cameraPane.addBinding(this.renderer.scene.settings.cam, "fov_angle", {
      label: "Field of view (degrees)",
      min: 1,
      max: 120,
    });
    this.cameraPane.addBinding(this.renderer.scene.settings.cam, "dof_size", {
      label: "Depth of field size",
      min: 0,
      max: 0.1,
      step: 0.0001,
    });
    this.cameraPane.addBinding(this.renderer.scene.settings.cam, "focus_distance", {
      min: 0,
      max: 10,
    });

    const setFocusFromCanvasButton = this.cameraPane.addButton({
      title: "🎯 Set from canvas",
      label: "focus",
    });
    setFocusFromCanvasButton.on("click", () => {
      if (this.clickAction === "focus") {
        this.clickAction = null;
        this.setFocusButton = null;
        setFocusFromCanvasButton.title = "🎯 Set from canvas";
        setFocusFromCanvasButton.label = "focus";
      } else {
        this.clickAction = "focus";
        this.setFocusButton = setFocusFromCanvasButton;
        setFocusFromCanvasButton.title = "❌ Cancel focus setting";
        setFocusFromCanvasButton.label = "focus";
      }
    });
    this.cameraPane
      .addButton({
        title: "⟲",
        label: "Reset",
      })
      .on("click", () => {
        this.renderer.scene.settings.cam.position = { x: 0.0, y: 1.0, z: -5.0 };
        this.renderer.scene.settings.cam.right = { x: 1.0, y: 0.0, z: 0.0 };
        this.renderer.scene.settings.cam.up = { x: 0.0, y: 1.0, z: 0.0 };
        this.renderer.scene.settings.cam.forward = { x: 0.0, y: 0.0, z: 1.0 };
        this.renderer.invalidateAccumulation();
      });

    const tab = sceneSettingsPane.addTab({
      pages: [{ title: "Objects" }, { title: "Materials" }],
    });
    tab.on("change", () => {
      this.renderer.invalidateAccumulation();
    });
    const objectsPane = tab.pages[0];
    const materialsPane = tab.pages[1];

    objectsPane
      .addButton({
        title: "+",
        label: "Add object",
      })
      .on("click", () => {});

    let material_options = {};
    for (let i = 0; i < this.renderer.scene.materials.length; i++) material_options[this.renderer.scene.materials[i].name] = i;

    for (const obj of this.renderer.scene.objects) {
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
        max: 15,
      });

      const setPositionFromCanvasButton = objectEditorPane.addButton({
        title: "🎯 Set from canvas",
        label: "position",
      });
      setPositionFromCanvasButton.on("click", () => {
        if (this.clickAction === "position") {
          this.clickAction = null;
          this.currentObjectEditorPane = null;
          this.currentSetPositionButton = null;
          this.selectedObjectIndex = null;
          setPositionFromCanvasButton.title = "🎯 Set from canvas";
          setPositionFromCanvasButton.label = "position";
        } else {
          this.clickAction = "position";
          this.currentObjectEditorPane = objectEditorPane;
          this.currentSetPositionButton = setPositionFromCanvasButton;
          this.selectedObjectIndex = this.renderer.scene.objects.indexOf(obj);
          setPositionFromCanvasButton.title = "❌ Cancel positioning";
          setPositionFromCanvasButton.label = "position";
        }
      });

      objectEditorPane
        .addButton({
          title: "🗑",
          label: "Delete object",
        })
        .on("click", () => {});
    }

    materialsPane
      .addButton({
        title: "+",
        label: "Add material",
      })
      .on("click", () => {});

    for (const mat of this.renderer.scene.materials) {
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
  };
}
