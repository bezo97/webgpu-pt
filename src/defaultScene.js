const settings = {
  cam: {
    position: { x: 0.0, y: 1.0, z: -5.0 },
    right: { x: 1.0, y: 0.0, z: 0.0 },
    up: { x: 0.0, y: 1.0, z: 0.0 },
    forward: { x: 0.0, y: 0.0, z: 1.0 },
    fov_angle: 60.0,
    dof_size: 0.0,
    focus_distance: 3.5,
  },
  render_settings: {
    max_bounces: 6,
    russian_roulette_start_bounce: 3,
    russian_roulette_min_p_reflect: 0.5,
    russian_roulette_min_p_refract: 0.75,
  },
  sky_color: { r: 0.02, g: 0.03, b: 0.05 },
  time: 0.0,
  width: 720,
  height: 720,
};

const objects = [
  {
    object_type: 1,
    material_index: 0,
    position: { x: 0.0, y: 0.0, z: 0.0 },
    scale: 3.75,
  },
  {
    object_type: 0,
    material_index: 1,
    position: { x: 1.0, y: 1.5, z: -1.75 },
    scale: 0.25,
  },
  {
    object_type: 0,
    material_index: 2,
    position: { x: -0.3, y: 0.25, z: -2.75 },
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
    material_index: 5,
    position: { x: 0.0, y: -9999.0, z: 0.0 },
    scale: 9999,
  },
];

const materials = [
  {
    name: "Red_diffuse",
    material_type: 0,
    albedo: { r: 0.95, g: 0.5, b: 0.5 },
    ior: 0,
    emission: { r: 0.0, g: 0.0, b: 0.0 },
    roughness: 0.0,
    metallic: 0.0,
  },
  {
    name: "White_emitter",
    material_type: 0,
    albedo: { r: 1.0, g: 1.0, b: 1.0 },
    ior: 0,
    emission: { r: 40.0, g: 40.0, b: 40.0 },
    roughness: 0.0,
    metallic: 0.0,
  },
  {
    name: "Simple_glass",
    material_type: 2,
    albedo: { r: 0.6, g: 0.6, b: 0.6 },
    ior: 1.5,
    emission: { r: 0.0, g: 0.0, b: 0.0 },
    roughness: 0.0,
    metallic: 0.0,
  },
  {
    name: "Green_mirror",
    material_type: 1,
    albedo: { r: 0.2, g: 0.8, b: 0.8 },
    ior: 0.0,
    emission: { r: 0.0, g: 0.0, b: 0.0 },
    roughness: 0.0,
    metallic: 0.0,
  },
  {
    name: "Yellow_glossy",
    material_type: 3,
    albedo: { r: 0.85, g: 0.95, b: 0.5 },
    ior: 0,
    emission: { r: 0.0, g: 0.0, b: 0.0 },
    roughness: 0.3,
    metallic: 0.0,
  },
  {
    name: "Gray_diffuse",
    material_type: 0,
    albedo: { r: 0.3, g: 0.3, b: 0.3 },
    ior: 0,
    emission: { r: 0.0, g: 0.0, b: 0.0 },
    roughness: 0.0,
    metallic: 0.0,
  },
];

export default { settings, objects, materials };
