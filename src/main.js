import shaderSource from "./shader.wgsl.js";

const startTime = new Date().getTime() / 1000;
const sceneSettings = {
  cam: {
    position: [0.0, 1.0, -10.0],
    right: [1.0, 0.0, 0.0],
    up: [0.0, 1.0, 0.0],
    forward: [0.0, 0.0, 1.0],
    fov_angle: 20.0,
  },
  sky_color: [0.6, 0.7, 0.8],
  time: 0.0,
  sample: 0,
  width: 720,
  height: 720,
};
const sceneObjects = [
  {
    object_type: 0,
    material_index: 0,
    position: [0.0, 1.0, 0.0],
    scale: 1.0,
  },
  {
    object_type: 0,
    material_index: 1,
    position: [1.5, 0.5, -0.5],
    scale: 0.5,
  },
  {
    object_type: 0,
    material_index: 2,
    position: [0.2, 0.25, -3],
    scale: 0.25,
  },
  {
    object_type: 0,
    material_index: 3,
    position: [-15.0, 10.0, 30.0],
    scale: 20,
  },
  {
    object_type: 0,
    material_index: 0,
    position: [0.0, -9999, 0],
    scale: 9999,
  },
];
const sceneMaterials = [
  {
    material_type: 0,
    albedo: [0.95, 0.5, 0.5],
    ior: 0,
    emission: [0.0, 0.0, 0.0],
  },
  {
    material_type: 0,
    albedo: [1, 1, 1],
    ior: 0,
    emission: [5, 5, 5],
  },
  {
    material_type: 2,
    albedo: [0.6, 0.6, 0.6],
    ior: 1.5,
    emission: [0, 0, 0],
  },
  {
    material_type: 1,
    albedo: [0.2, 0.8, 0.8],
    ior: 0.0,
    emission: [0, 0, 0],
  },
];

//setup

const canvas = document.getElementById("main_display");
//setup input
canvas.onmousemove = (event) => {
  if (event.buttons == 1) {
    const mouseX = event.offsetX / canvas.width;
    const mouseY = event.offsetY / canvas.height;
    sceneSettings.sample = 0;
    sceneObjects[0].position[0] = -3 + 6 * mouseX;
  }
};
//get gpu device
if (!navigator.gpu) throw new Error("WebGPU not supported on this browser.");
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No appropriate GPUAdapter found.");
const device = await adapter.requestDevice();
//setup context
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device: device,
  format: canvasFormat,
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
const vertexBuffer = device.createBuffer({
  label: "quad vertices",
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);
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
const settingsBuffer = device.createBuffer({
  label: "settingsBuffer",
  size: 4 * 4 * 7,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const sceneObjectsBuffer = device.createBuffer({
  label: "sceneObjectsBuffer",
  size: 4 * 4 * 4 * sceneObjects.length,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const sceneMaterialsBuffer = device.createBuffer({
  label: "sceneMaterialsBuffer",
  size: 4 * 4 * 4 * sceneMaterials.length,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

//setup shader
const rendererShaderModule = device.createShaderModule({
  label: "Renderer shader",
  code: shaderSource,
});

//create the render pipeline
const renderPipeline = device.createRenderPipeline({
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
        format: canvasFormat,
      },
      {
        format: canvasFormat,
      },
    ],
  },
});

const lastFrameTexturePingView = device
  .createTexture({
    label: "lastFrameTexturePing",
    size: [sceneSettings.width, sceneSettings.height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    format: canvasFormat,
  })
  .createView();
const lastFrameTexturePongView = device
  .createTexture({
    label: "lastFrameTexturePong",
    size: [sceneSettings.width, sceneSettings.height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    format: canvasFormat,
  })
  .createView();

//bind uniform buffers to pipeline locations using bindgroup
const myBindGroup = device.createBindGroup({
  label: "Renderer bind group",
  layout: renderPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: { buffer: settingsBuffer },
    },
    {
      binding: 1,
      resource: { buffer: sceneObjectsBuffer },
    },
    {
      binding: 2,
      resource: { buffer: sceneMaterialsBuffer },
    },
  ],
});
const pingBindGroup = device.createBindGroup({
  label: "ping bind group",
  layout: renderPipeline.getBindGroupLayout(1),
  entries: [
    {
      binding: 0,
      resource: lastFrameTexturePingView,
    },
  ],
});
const pongBindGroup = device.createBindGroup({
  label: "pong bind group",
  layout: renderPipeline.getBindGroupLayout(1),
  entries: [
    {
      binding: 0,
      resource: lastFrameTexturePongView,
    },
  ],
});

//create render bundle encoder to pre-record reusable commands
const renderBundleEncoder = device.createRenderBundleEncoder({
  colorFormats: [canvasFormat, canvasFormat],
});
//record ping pass
recordRenderPass1(renderBundleEncoder, true);
//create the render bundle
const renderBundlePing = renderBundleEncoder.finish();

//create render bundle encoder to pre-record reusable commands
const renderBundleEncoder2 = device.createRenderBundleEncoder({
  colorFormats: [canvasFormat, canvasFormat],
});
//record pong pass
recordRenderPass1(renderBundleEncoder2, false);
//create the render bundle
const renderBundlePong = renderBundleEncoder2.finish();

async function recordRenderPass1(passEncoder, pingpong) {
  passEncoder.setPipeline(renderPipeline);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.setBindGroup(0, myBindGroup); //bind myBindGroup to group 0 slot, so this pass uses it
  passEncoder.setBindGroup(1, pingpong ? pingBindGroup : pongBindGroup);
  passEncoder.draw(vertices.length / 2); // 6 vertices
}

//

async function renderFrame() {
  //update state
  sceneSettings.time = startTime - new Date().getTime() / 1000;

  //wait for previous frame finish
  await device.queue.onSubmittedWorkDone();

  //update uniforms
  device.queue.writeBuffer(
    settingsBuffer,
    0,
    new Float32Array([
      ...sceneSettings.cam.position,
      0.0,
      ...sceneSettings.cam.right,
      0.0,
      ...sceneSettings.cam.up,
      0.0,
      ...sceneSettings.cam.forward,
      sceneSettings.cam.fov_angle,
      ...sceneSettings.sky_color,
      sceneSettings.time,
      sceneSettings.sample,
      sceneSettings.width,
      sceneSettings.height,
      sceneObjects.length, //object_count
      sceneObjects.filter((o) =>
        sceneMaterials[o.material_index].emission.some((e) => e > 0.0)
      ).length, //emissive_object_count
    ])
  );

  device.queue.writeBuffer(
    sceneObjectsBuffer,
    0,
    new Float32Array(
      sceneObjects.flatMap((o) => [
        o.object_type,
        o.material_index,
        0.0,
        0.0,
        ...o.position,
        o.scale,
      ])
    )
  );
  device.queue.writeBuffer(
    sceneMaterialsBuffer,
    0,
    new Float32Array(
      sceneMaterials.flatMap((m) => [
        m.material_type,
        0.0,
        0.0,
        0.0,
        ...m.albedo,
        m.ior,
        ...m.emission,
        0.0,
      ])
    )
  );

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(), //uses the entire texture
        loadOp: "clear", //clear texture when pass starts
        clearValue: { r: 0, g: 0, b: 0.2, a: 1 }, // set color of clear op
        storeOp: "store", //save into texture at the end of the pass
      },
      {
        view:
          sceneSettings.sample % 2 == 0
            ? lastFrameTexturePongView
            : lastFrameTexturePingView,
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0.2, a: 1 },
        storeOp: "store",
      },
    ],
  });
  passEncoder.executeBundles([
    sceneSettings.sample % 2 == 0 ? renderBundlePing : renderBundlePong,
  ]);
  passEncoder.end();
  //create the command buffer
  const commandBuffer = commandEncoder.finish();
  //submit command buffer to queue
  device.queue.submit([commandBuffer]);

  //next frame
  sceneSettings.sample++;
  requestAnimationFrame(renderFrame);
}

//first frame starts on load
requestAnimationFrame(renderFrame);

export default function main() {}