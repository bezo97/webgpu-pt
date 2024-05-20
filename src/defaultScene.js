const settings = {
  cam: {
    position: { x: 0.0, y: 1.0, z: -10.0 },
    right: [1.0, 0.0, 0.0],
    up: [0.0, 1.0, 0.0],
    forward: [0.0, 0.0, 1.0],
    fov_angle: 20.0,
  },
  sky_color: [0.6, 0.7, 0.8],
  time: 0.0,
  width: 720,
  height: 720,
};

const objects = [
  {
    object_type: 0,
    material_index: 0,
    position: { x: 0.0, y: 1.0, z: 0.0 },
    scale: 1.0,
  },
  {
    object_type: 0,
    material_index: 1,
    position: { x: 1.5, y: 0.5, z: -0.5 },
    scale: 0.25,
  },
  {
    object_type: 0,
    material_index: 2,
    position: { x: 0.2, y: 0.25, z: -3.0 },
    scale: 0.25,
  },
  {
    object_type: 0,
    material_index: 3,
    position: { x: -15.0, y: 10.0, z: 30.0 },
    scale: 20,
  },
  {
    object_type: 0,
    material_index: 0,
    position: { x: 0.0, y: -9999.0, z: 0.0 },
    scale: 9999,
  },
];

const materials = [
  {
    material_type: 0,
    albedo: { r: 0.95, g: 0.5, b: 0.5 },
    ior: 0,
    emission: [0.0, 0.0, 0.0],
  },
  {
    material_type: 0,
    albedo: { r: 1.0, g: 1.0, b: 1.0 },
    ior: 0,
    emission: [40, 40, 40],
  },
  {
    material_type: 2,
    albedo: { r: 0.6, g: 0.6, b: 0.6 },
    ior: 1.5,
    emission: [0, 0, 0],
  },
  {
    material_type: 1,
    albedo: { r: 0.2, g: 0.8, b: 0.8 },
    ior: 0.0,
    emission: [0, 0, 0],
  },
];

export default { settings, objects, materials };
