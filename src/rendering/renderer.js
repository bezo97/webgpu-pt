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
  #resultsBuffer; //contains data produced by the shader, eg. the queried depth value
  #resultsReadBuffer; //resultsBuffer is copied here for reading
  #querySettingsBuffer; //can set the pixel coordinates for depth query, or disable it with (-1, -1)

  #frameCounter = 0;

  scene = null;
  isRendering = false;
  framerate = 0; //fps
  targetFramerate = 60; //fps
  total_accumulation_steps = 0;
  workload_accumulation_steps = 1;
  #pendingDepthQuery = null; // { x, y, promise, resolve }

  get canvas() {
    return this.#displayCanvas;
  }

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
    //TODO: consider using a single buffer
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
    const resultsBufferSize = 1 * 4;
    this.#resultsBuffer = this.#device.createBuffer({
      label: "resultsBuffer",
      size: resultsBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.#resultsReadBuffer = this.#device.createBuffer({
      label: "resultsReadBuffer",
      size: resultsBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.#querySettingsBuffer = this.#device.createBuffer({
      label: "querySettingsBuffer",
      size: 2 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    //init to -1, meaning querying is disabled
    this.#device.queue.writeBuffer(this.#querySettingsBuffer, 0, new Float32Array([-1.0, -1.0]));

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
        {
          binding: 3,
          resource: { buffer: this.#querySettingsBuffer },
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
        {
          binding: 1,
          resource: { buffer: this.#resultsBuffer },
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
    //update state
    this.scene.settings.time = document.timeline.currentTime / 1000;
    //wait for previous frame finish
    await this.#device.queue.onSubmittedWorkDone();
    this.#frameCounter++;

    if (this.#pendingDepthQuery) {
      // set the pixel coords for requested depth query
      const { x, y } = this.#pendingDepthQuery;
      this.#updateQuerySettings(x, y);
    }

    //update uniforms
    this.#updateSettingsBuffer();
    this.#device.queue.writeBuffer(
      this.#objectsBuffer,
      0,
      new Float32Array(
        this.scene.objects.flatMap((o) => [
          o.object_type,
          this.scene.materials.findIndex((m) => m.id === o.material_id),
          0.0,
          0.0,
          ...[o.position.x, o.position.y, o.position.z],
          o.scale,
        ]),
      ),
    );
    this.#device.queue.writeBuffer(
      this.#materialsBuffer,
      0,
      new Float32Array(
        this.scene.materials.flatMap((m) => [
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
        ]),
      ),
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

    if (this.#pendingDepthQuery) {
      // Resolve the requested depth query by reading from buffer
      const depth = await this.#readDepthResult();
      this.#pendingDepthQuery.resolve(depth);
      this.#pendingDepthQuery = null;
    }

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

  /**
   * @param {number} x 0-canvasWidth horizontal coordinate for depth query
   * @param {number} y 0-canvasHeight vertical coordinate for depth query
   * @returns {Promise<number>} Promise resolved by the next renderFrame(), containing the depth at the specified screen coords
   */
  async getDepthAt(x, y) {
    if (!this.isRendering) return null;

    // Check if same query is already pending
    if (this.#pendingDepthQuery && this.#pendingDepthQuery.x === x && this.#pendingDepthQuery.y === y) {
      return this.#pendingDepthQuery.promise;
    }

    // Create new pending query
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    await this.#pendingDepthQuery?.promise; //wait for previous query to finish if exists
    this.#pendingDepthQuery = { x, y, promise, resolve };

    return promise; // next renderFrame will resolve the promise
  }

  async #readDepthResult() {
    // Copy resultsBuffer to resultsReadBuffer
    const commandEncoder = this.#device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(this.#resultsBuffer, 0, this.#resultsReadBuffer, 0, 1 * 4);
    this.#device.queue.submit([commandEncoder.finish()]);

    // Wait for GPU and read the depth value
    await this.#resultsReadBuffer.mapAsync(GPUMapMode.READ, 0, 1 * 4);
    const depthBufferCopy = this.#resultsReadBuffer.getMappedRange(0, 1 * 4).slice(0);
    this.#resultsReadBuffer.unmap();

    // disable depth capture
    this.#updateQuerySettings(-1.0, -1.0);

    return new Float32Array(depthBufferCopy)[0];
  }

  #updateQuerySettings(query_pixel_x, query_pixel_y) {
    this.#device.queue.writeBuffer(this.#querySettingsBuffer, 0, new Float32Array([query_pixel_x, query_pixel_y]));
  }

  #updateSettingsBuffer() {
    const scene = this.scene;
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
          const materialIndex = this.scene.materials.findIndex((m) => m.id === o.material_id);
          const e = scene.materials[materialIndex]?.emission || { r: 0, g: 0, b: 0 };
          return e.r + e.g + e.b > 0.0;
        }).length, //emissive_object_count
      ]),
    );
  }

  /**
   * @param {number} x 0-canvasWidth horizontal coordinate for depth query
   * @param {number} y 0-canvasHeight vertical coordinate for depth query
   * @param {number} depth depth value at the pixel, as returned by getDepthAt()
   * @returns {{x: number, y: number, z: number}} world position at specified screen coordinates and depth
   */
  screenToWorld(x, y, depth) {
    const canvas = this.canvas;
    const cam = this.scene.settings.cam;

    const fovRad = (cam.fov_angle * Math.PI) / 180.0;
    const fov = canvas.width / 2 / Math.tan(fovRad / 2.0);

    // top left corner
    const tlcX = cam.forward.x * fov + cam.up.x * (canvas.height / 2) - cam.right.x * (canvas.width / 2);
    const tlcY = cam.forward.y * fov + cam.up.y * (canvas.height / 2) - cam.right.y * (canvas.width / 2);
    const tlcZ = cam.forward.z * fov + cam.up.z * (canvas.height / 2) - cam.right.z * (canvas.width / 2);

    // ray direction for the pixel
    const rayX = tlcX + cam.right.x * x - cam.up.x * y;
    const rayY = tlcY + cam.right.y * x - cam.up.y * y;
    const rayZ = tlcZ + cam.right.z * x - cam.up.z * y;
    // normalize
    const len = Math.sqrt(rayX * rayX + rayY * rayY + rayZ * rayZ);
    const rayDir = {
      x: rayX / len,
      y: rayY / len,
      z: rayZ / len,
    };

    return {
      x: cam.position.x + depth * rayDir.x,
      y: cam.position.y + depth * rayDir.y,
      z: cam.position.z + depth * rayDir.z,
    };
  }
}
