const settings = {
  cam: {
    position: [0.0, 1.0, -10.0],
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
    position: [0.0, 1.0, 0.0],
    scale: 1.0,
  },
  {
    object_type: 0,
    material_index: 1,
    position: [1.5, 0.5, -0.5],
    scale: 0.25,
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

const materials = [
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
    emission: [40, 40, 40],
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

export default { settings, objects, materials };
