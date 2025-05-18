import shaderSource from "./shader.wgsl.js";

export class Renderer {
  #displayCanvas;
  #device;
  #graphicsContext;
  #textureFormat;
  #renderBundle;
  //buffer handles
  #settingsBuffer;
  #objectsBuffer;
  #materialsBuffer;
  #histogramBuffer;

  #frameCounter = 0;

  scene = null;
  isRendering = false;
  framerate = 0; //fps
  targetFramerate = 60; //fps
  total_accumulation_steps = 0;
  workload_accumulation_steps = 1;

  constructor(canvas) {
    this.#displayCanvas = canvas;
  }

  async initialize() {
    if (this.#renderBundle) throw new Error("Already initialized");

    //get gpu device
    if (!navigator.gpu) throw new Error("WebGPU not supported on this browser.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No appropriate GPUAdapter found.");
    this.#device = await adapter.requestDevice();

    //setup graphics context
    this.#graphicsContext = this.#displayCanvas.getContext("webgpu");
    this.#textureFormat = navigator.gpu.getPreferredCanvasFormat();
    this.#graphicsContext.configure({
      device: this.#device,
      format: this.#textureFormat,
    });

    //setup fullscreen quad, made of 2 triangles
    const quad_margin = 0.995;
    const vertices = new Float32Array([
      //triangle 1
      -quad_margin,
      -quad_margin,
      quad_margin,
      -quad_margin,
      quad_margin,
      quad_margin,
      //triangle 2
      -quad_margin,
      -quad_margin,
      quad_margin,
      quad_margin,
      -quad_margin,
      quad_margin,
    ]);
    const vertexBuffer = this.#device.createBuffer({
      label: "quad vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(vertexBuffer, 0, vertices);
    const vertexBufferLayout = {
      arrayStride: 8, //each vertex is 2x4 bytes
      attributes: [
        {
          format: "float32x2",
          offset: 0,
          shaderLocation: 0, // buffer loc in the vertex shader
        },
      ],
    };

    //setup uniform buffers
    //TODO: find a way to correctly set up buffer sizes
    this.#settingsBuffer = this.#device.createBuffer({
      label: "settingsBuffer",
      size: 4 * 4 * 9,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#objectsBuffer = this.#device.createBuffer({
      label: "objectsBuffer",
      size: 4 * 4 * 4 * this.scene.objects.length,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#materialsBuffer = this.#device.createBuffer({
      label: "materialsBuffer",
      size: 4 * 4 * 4 * this.scene.materials.length,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#histogramBuffer = this.#device.createBuffer({
      label: "histogramBuffer",
      size: 4 * 4 * this.scene.settings.width * this.scene.settings.height,
      usage: GPUBufferUsage.STORAGE,
    });
    //TODO: consider using a single buffer

    //setup shader
    const rendererShaderModule = this.#device.createShaderModule({
      label: "Renderer shader",
      code: shaderSource,
    });

    //create the render pipeline
    const renderPipeline = this.#device.createRenderPipeline({
      label: "Render pipeline",
      layout: "auto",
      vertex: {
        module: rendererShaderModule,
        entryPoint: "vertexMain",
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: rendererShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format: this.#textureFormat,
          },
        ],
      },
    });

    //bind uniform/storage buffers to pipeline locations using bindgroups
    const sceneDataBindGroup = this.#device.createBindGroup({
      label: "sceneDataBindGroup",
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.#settingsBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.#objectsBuffer },
        },
        {
          binding: 2,
          resource: { buffer: this.#materialsBuffer },
        },
      ],
    });
    const renderDataBindGroup = this.#device.createBindGroup({
      label: "renderDataBindGroup",
      layout: renderPipeline.getBindGroupLayout(1),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.#histogramBuffer },
        },
      ],
    });

    //create render bundle encoder to pre-record reusable commands
    const renderBundleEncoder = this.#device.createRenderBundleEncoder({
      colorFormats: [this.#textureFormat],
    });
    recordRenderPass1(renderBundleEncoder);
    async function recordRenderPass1(passEncoder) {
      passEncoder.setPipeline(renderPipeline);
      passEncoder.setVertexBuffer(0, vertexBuffer);
      passEncoder.setBindGroup(0, sceneDataBindGroup); //bind sceneDataBindGroup to group 0 slot, so this pass uses it
      passEncoder.setBindGroup(1, renderDataBindGroup);
      passEncoder.draw(vertices.length / 2); // 6 vertices
    }
    this.#renderBundle = renderBundleEncoder.finish();

    //start measuring framerate and adjusting workload size
    setInterval(() => {
      this.framerate = this.#frameCounter;

      //adjust workload size
      if (!document.hidden && this.isRendering) {
        //avoid adjusting the workload and measuring fps when the page is in background, since animation-frame is not invoked

        const targetDelta = this.#frameCounter / this.targetFramerate;
        if (this.#frameCounter < this.targetFramerate) this.workload_accumulation_steps *= targetDelta;
        else this.workload_accumulation_steps *= 1.2;
        this.workload_accumulation_steps = Math.max(1, this.workload_accumulation_steps);
        //reset counter for fps
        this.#frameCounter = 0;
      }
    }, 1000);
  }

  #renderFrame = async () => {
    const scene = this.scene;
    //update state
    scene.settings.time = document.timeline.currentTime / 1000;
    //wait for previous frame finish
    await this.#device.queue.onSubmittedWorkDone();
    this.#frameCounter++;

    //update uniforms
    this.#device.queue.writeBuffer(
      this.#settingsBuffer,
      0,
      new Float32Array([
        ...[scene.settings.cam.position.x, scene.settings.cam.position.y, scene.settings.cam.position.z],
        0.0,
        ...[scene.settings.cam.right.x, scene.settings.cam.right.y, scene.settings.cam.right.z],
        0.0,
        ...[scene.settings.cam.up.x, scene.settings.cam.up.y, scene.settings.cam.up.z],
        0.0,
        ...[scene.settings.cam.forward.x, scene.settings.cam.forward.y, scene.settings.cam.forward.z],
        scene.settings.cam.fov_angle,
        scene.settings.cam.dof_size,
        scene.settings.cam.focus_distance,
        ...[0.0, 0.0], //padding
        scene.settings.render_settings.max_bounces,
        scene.settings.render_settings.russian_roulette_start_bounce,
        scene.settings.render_settings.russian_roulette_min_p_reflect,
        scene.settings.render_settings.russian_roulette_min_p_refract,
        ...[scene.settings.sky_color.r, scene.settings.sky_color.g, scene.settings.sky_color.b],
        scene.settings.time,
        scene.settings.width,
        scene.settings.height,
        //extra data that is not configurable
        this.total_accumulation_steps,
        this.workload_accumulation_steps,
        scene.objects.length, //object_count
        scene.objects.filter((o) => {
          const e = scene.materials[o.material_index].emission;
          return e.r + e.g + e.b > 0.0;
        }).length, //emissive_object_count
      ])
    );
    this.#device.queue.writeBuffer(
      this.#objectsBuffer,
      0,
      new Float32Array(scene.objects.flatMap((o) => [o.object_type, o.material_index, 0.0, 0.0, ...[o.position.x, o.position.y, o.position.z], o.scale]))
    );
    this.#device.queue.writeBuffer(
      this.#materialsBuffer,
      0,
      new Float32Array(
        scene.materials.flatMap((m) => [
          m.material_type,
          0.0,
          0.0,
          0.0,
          ...[m.albedo.r, m.albedo.g, m.albedo.b],
          m.ior,
          ...[m.emission.r, m.emission.g, m.emission.b],
          m.roughness,
          m.metallic,
          0.0,
          0.0,
          0.0,
        ])
      )
    );

    const commandEncoder = this.#device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#graphicsContext.getCurrentTexture().createView(), //uses the entire texture
          loadOp: "clear", //clear texture when pass starts
          clearValue: { r: 0, g: 0, b: 0.2, a: 1 }, // set color of clear op
          storeOp: "store", //save into texture at the end of the pass
        },
      ],
    });
    passEncoder.executeBundles([this.#renderBundle]);
    passEncoder.end();
    //create the command buffer
    const commandBuffer = commandEncoder.finish();
    //submit command buffer to queue
    this.#device.queue.submit([commandBuffer]);

    this.total_accumulation_steps += this.workload_accumulation_steps;
    //next frame
    if (this.isRendering) requestAnimationFrame(this.#renderFrame);
  };

  startRendering() {
    if (this.isRendering) throw new Error("Already rendering");
    this.isRendering = true;
    requestAnimationFrame(this.#renderFrame);
  }

  stopRendering() {
    this.isRendering = false;
  }

  invalidateAccumulation() {
    this.total_accumulation_steps = 0;
  }
}
