export default `

//no pre-processor duh
const PI = 3.14159265;
const EPS = 2e-5;
const no_hit = Hit(-1, -1.0, vec3f(0.0), vec3f(0.0));

//uniform structs:

struct FractalSettings {
    julia_c: vec3f,
    julia_mode: f32,//bool
    bailout_value: f32,
    iterations: f32,
    offset_multiplier: f32,
    max_marching_steps: f32,
    raystep_multiplier: f32,
}

struct SceneMaterial {
    material_type: f32,//i32
    albedo: vec3f,
    ior: f32,
    emission: vec3f,
    roughness: f32,
    metallic: f32,
}

struct SceneObject {
    object_type: f32,//i32
	material_index: f32,//i32
    position: vec3f,
    scale: f32,
}

struct Camera {
    position: vec3f,
    right: vec3f,
    up: vec3f,
    forward: vec3f,
    fov_angle: f32,
    dof_size: f32,
    focus_distance: f32,
    padding3: f32,
    padding4: f32,
}

struct RenderSettings {
    max_bounces: f32,//i32
    russian_roulette_start_bounce: f32,//i32
    russian_roulette_min_p_reflect: f32,
    russian_roulette_min_p_refract: f32,
    screenXGradient: vec3f,
    screenYGradient: vec3f,
    screenZGradient: vec3f,
}

struct QuerySettings {
    query_pixel: vec2f,
}

struct SceneSettings {
    cam: Camera,
    render_settings: RenderSettings,
    fractal_settings: FractalSettings,
    sky_color: vec3f,
    time: f32,
    width: f32,
    height: f32,
    //extra data that is not configurable
    total_accumulation_steps: f32,//i32
    workload_accumulation_steps: f32,//i32
    object_count: f32,//i32
    emissive_object_count: f32,//i32
};

struct PassResults {
    query_depth: f32,
}

//helper structs:

struct Ray {
    pos: vec3f,
    dir: vec3f,
}

struct Hit {
	object_index: i32,//-1 means no hit
	distance: f32,
    position: vec3f,
	surface_normal: vec3f,//outer surface
};

struct BRDFSample {
    scattered_ray: Ray,
    reflectance : vec3f,
    cos_theta: f32,
    pdf: f32,
}

struct DirectLightSample {
    contribution: vec3f,
    pdf: f32,
}

struct MISData {
    hit: Hit,
    brdf: BRDFSample,
    is_material_specular: bool,
}

struct IterationLoopResult {
    escape_length: f32,
    potential: f32,         // for example log/pow formula based on escape_length and iteration count
    escaped: bool,          // Whether bailout was reached
    orbit_trap_min: f32,      // Minimum |position|² during iteration
    position: vec4f,
};

struct DEResults {
    de: f32,
    center: IterationLoopResult,
    offsets: array<IterationLoopResult, 4>,
}

//TODO: consider constant memory buffer?

@group(0) @binding(0) var<uniform> settings: SceneSettings;

@group(0) @binding(1) var<storage, read> scene_objects: array<SceneObject>;

@group(0) @binding(2) var<storage, read> scene_materials: array<SceneMaterial>;

@group(0) @binding(3) var<uniform> query_settings: QuerySettings;

@group(1) @binding(0) var<storage, read_write> histogram: array<vec4f>;

@group(1) @binding(1) var<storage, read_write> results: PassResults;

var<private> seed: u32 = 12345;

var<private> pixel_rand: vec3f = vec3f(0.0);//random offset on the low-discrepancy samples, per pixel
var<private> current_accumulation_step: u32 = 0u;
var<private> save_depth_data: bool = false;

// Hash function for 32 bit uint
// Current lowest bias 2-round function from here: https://github.com/skeeto/hash-prospector
fn lowbias32(x_in: u32) -> u32
{
    var x = x_in;
    x ^= x >> 16;
    x *= 0x21f0aaadu;
    x ^= x >> 15;
    x *= 0xd35a2d97u;
    x ^= x >> 15;
    return x;
}

fn f_hash(seed: ptr<private, u32>) -> f32 {
    *seed = lowbias32(*seed);
    return f32(*seed) / f32(0xffffffffu);
}
fn f_hash2(seed: ptr<private, u32>) -> vec2f {
    return vec2f(f_hash(seed), f_hash(seed));
}
fn f_hash3(seed: ptr<private, u32>) -> vec3f {
    return vec3f(f_hash(seed), f_hash(seed), f_hash(seed));
}

//Low-discrepancy quasirandom sequences
//Info: https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
fn r1(index: u32) -> f32 {
    let i_m =  f32((current_accumulation_step + index + 1) % 16777216u);
    return 
        fract(pixel_rand.x + i_m*0.61803398875); // 1/goldenratio
}
fn r2(index: u32) -> vec2f {
    let i_m =  f32((current_accumulation_step + index + 1) % 16777216u);
    return vec2f(
        fract(pixel_rand.x + i_m*0.75487766624),
        fract(pixel_rand.y + i_m*0.56984029099)
    );
}
fn r3(index: u32) -> vec3f {
    let i_m =  f32((current_accumulation_step + index + 1) % 16777216u);
    return vec3f(
        fract(pixel_rand.x + i_m*0.81917251339),
        fract(pixel_rand.y + i_m*0.67104360670),
        fract(pixel_rand.z + i_m*0.54970047790)
    );
}

fn schlick_fresnel(cos_theta: f32, r0: vec3f) -> vec3f {
    return r0 + (vec3f(1.0) - r0) * pow(1.0 - cos_theta, 5.0);
}

// calculate weight for mis using power heuristic where beta is 2
// Veach: beta at 2 is empirically best
fn power_heuristic_beta2(pdf_a: f32, pdf_b: f32) -> f32 {
    let power_a = pdf_a * pdf_a;
    let power_b = pdf_b * pdf_b;
    return power_a / (power_a + power_b);
}

fn light_pdf(hit_pos: vec3f, light_hit_pos: vec3f, emissive_object: SceneObject) -> f32 {
    let lightvec = light_hit_pos - hit_pos;
    let dist2 = dot(lightvec, lightvec);
    let lightdir = normalize(lightvec);
    switch(i32(emissive_object.object_type))
    {
        case 0, default: { //sphere
            let sphere_surface_normal = normalize(light_hit_pos - emissive_object.position);
            let cos_theta = dot(-lightdir, sphere_surface_normal);
            if (cos_theta <= 0.0) {
                return 0.0; //TODO: deal with back side of the sphere
            }
            let sphere_radius = emissive_object.scale;
            let sphere_area = 4.0 * PI * sphere_radius * sphere_radius;
            let area_pdf = 1.0 / sphere_area;
            let solid_angle_pdf = area_pdf * (dist2 / cos_theta);
            return solid_angle_pdf;
        }
    }
}

var<private> scatter_seq_index: u32 = 0;
var<private> light_seq_index: u32 = 1;
fn cosWeightedRandomHemisphereDirection(n: vec3f, seq_index: ptr<private, u32>) -> vec3f {
    let r = r2(*seq_index);
    *seq_index++;
    let uu = normalize(cross(n, vec3f(0.0,1.0,1.0)));
    let vv = cross(uu, n);
    let ra = sqrt(r.y);
    let rx = ra*cos(2.0*PI*r.x);
    let ry = ra*sin(2.0*PI*r.x);
    let rz = sqrt(1.0 - r.y);
    let rr = vec3f( rx*uu + ry*vv + rz*n );
    return normalize( rr );
}

//Returns (t1, t2) of the ray-sphere intersection or (-1, -1) if no intersection
fn sphere_t1t2(ray: Ray, radius: f32, position: vec3f) -> vec2f
{
    let offset = position - ray.pos;
    let b = dot(offset, ray.dir);
    // if(b < 0.0) {
    //     return vec2f(-1.0);
    // } //commented out, because we want to hit the inside of the sphere too
    let c = dot(offset, offset) - b*b;
    if(c > radius*radius){
        return vec2f(-1.0);
    }
    let thc = sqrt(radius*radius - c);
    let t1 = b - thc;
    let t2 = b + thc;
    return vec2f(t1, t2);
}

const MANDALAY_ROT: vec3f = vec3f(1.0, 1.0, 1.0);
const MANDALAY_FO: f32 = 1.0;
const MANDALAY_ZTOWER: f32 = 0.0;
const MANDALAY_G: f32 = 0.0;
const MANDALAY_MINRAD2: f32 = 1.0;
const MANDALAY_SCALE: f32 = 2.62;

fn fractal_mandalay_iterate(p: vec4f, c: vec4f) -> vec4f
{
    let p_xyz_rotated: vec3f = MANDALAY_ROT * p.xyz;
    
    // Get absolute values
    let n: vec3f = abs(p_xyz_rotated);
    
    // Kifs Octahedral fold:
    var n_sorted: vec3f = n;
    if (n_sorted.y > n_sorted.x) {
        n_sorted = vec3f(n_sorted.y, n_sorted.x, n_sorted.z);
    }
    if (n_sorted.z > n_sorted.y) {
        n_sorted = vec3f(n_sorted.x, n_sorted.z, n_sorted.y);
    }
    if (n_sorted.y > n_sorted.x) {
        n_sorted = vec3f(n_sorted.y, n_sorted.x, n_sorted.z);
    }
    
    // ABoxKali-like abs folding:
    let fx: f32 = -2.0 * MANDALAY_FO + n_sorted.x;
    
    let gy: f32 = MANDALAY_G + n_sorted.y;
    
    // Edges:
    var xf: f32 = (MANDALAY_FO - abs(-MANDALAY_FO + n_sorted.x));
    var yf: f32 = (MANDALAY_FO - abs(-MANDALAY_FO + n_sorted.y));
    var zf: f32 =  MANDALAY_ZTOWER + n_sorted.z;
    
    if (fx > 0.0 && fx > n_sorted.y) {
        if (fx > gy) {
            xf += MANDALAY_G;
            yf = (MANDALAY_FO - abs(MANDALAY_G - MANDALAY_FO + n_sorted.y));
        } else {
            xf = -n_sorted.y;
            yf = (MANDALAY_FO - abs(-3.0 * MANDALAY_FO + n_sorted.x));
        }
    }
    
    // Build new p_vec4 with updated x, y, z (keeping original w)
    var result: vec4f = vec4f(xf, yf, zf, p.w);
    
    // Ball folding
    let r2: f32 = dot(result.xyz, result.xyz);
    let fold_factor: f32 = clamp(max(MANDALAY_MINRAD2 / r2, MANDALAY_MINRAD2), 0.0, 1.0);
    result *= fold_factor;
    
    return result * MANDALAY_SCALE + c;
}

//scale: anything beyond 1.5 doesn't really work
fn fractal_amoser_sine_iterate(p: vec4f, scale: f32, c: vec4f) -> vec4f
{
    return vec4f(
        sin(p.x) * cosh(p.y),
        cos(p.x) * cos(p.z) * sinh(p.y),
        sin(p.z) * cosh(p.y),
        p.w
    ) * scale + c;
}

fn fractal_mandelbox_iterate(p: vec4f, scale: f32, c: vec4f) -> vec4f
{
    let folded = clamp(p.xyz, vec3f(-1.0), vec3f(1.0)) * 2.0 - p.xyz;
    return vec4f(folded, p.w) * scale / clamp(dot(p.xyz, p.xyz), 0.5, 1.0) + c;
}

fn fractal_iteration_step(fractal_object: SceneObject, p: vec4f, c: vec4f) -> vec4f {    
    switch(i32(fractal_object.object_type)) { //TODO: option to select the fractal type
        case 1: {
            return fractal_mandalay_iterate(10.0*p, c)/10.0;
        }
        case 2: {
            return fractal_amoser_sine_iterate(p, 1.0, c);
        }
        case 3: {
            return fractal_mandelbox_iterate(p, 2.62, c);
        }
        case default: {
            return vec4f(0.0);
        }
    }
}

fn compute_fractal_state(pos: vec3f, de_object: SceneObject, max_iter: i32) -> IterationLoopResult {
    var p: vec4f = vec4f(pos, 1.0);
    var r2: f32 = 0.0;
    var orbit_trap_min: f32 = 1e20;

    // Julia mode handling for the refinement
    var c: vec4f = p;
    if (settings.fractal_settings.julia_mode > 0.0) {
        c = vec4f(settings.fractal_settings.julia_c, 1.0);
    }
    
    var i: i32 = 0;
    for (; i < max_iter; i++) {
        p = fractal_iteration_step(de_object, p, c);
        r2 = dot(p.xyz, p.xyz);
        orbit_trap_min = min(orbit_trap_min, r2);
        if (r2 > settings.fractal_settings.bailout_value) {
            break;
        }
    }
    let iter_count = i + 1;
    let escape_length = length(p.xyz);
    
    let potential = log(escape_length) * f32(iter_count) / escape_length; //not sure this is good in general
    //let potential = log(escape_length) / pow(8.0, f32(iter_count)); // example for pow8 Mandelbulb-like fractals
    
    let escaped = r2 > settings.fractal_settings.bailout_value;
    return IterationLoopResult(escape_length, potential, escaped, orbit_trap_min, p);
}

fn estimate_distance(pos0: vec3f, de_object: SceneObject, fast_eval: bool, offset_eps: f32) -> DEResults {
    //transform by object's translation/scale
    var pos = (pos0 - de_object.position) / de_object.scale;

    var iterations = i32(settings.fractal_settings.iterations);
    if (fast_eval) {
        iterations = 5;
    }
    
    let iteration_result = compute_fractal_state(pos, de_object, iterations);

    if (!iteration_result.escaped) {
        return DEResults(0.0, iteration_result, array<IterationLoopResult, 4>(iteration_result, iteration_result, iteration_result, iteration_result));
    }

    // Compute numerical gradient using finite differences
    let offset_results = get_tetrahedron_offsets(pos, de_object, offset_eps, iterations);
    let rx = offset_results[0];
    let ry = offset_results[1];
    let rz = offset_results[2];
    let rw = offset_results[3];
    
    //Some DE methods based on: http://blog.hvidtfeldts.net/index.php/2011/09/distance-estimated-3d-fractals-v-the-mandelbulb-different-de-approximations/
    var de: f32 = 0.0;
    if(0.0 == 0.0)
    {
        //makin-buddhi de:
        // DE = 0.5 * r * log(r) / |grad(r)|
        let grad = vec4f(rx.escape_length, ry.escape_length, rz.escape_length, rw.escape_length) - vec4f(iteration_result.escape_length);
        let grad_len = length(grad / offset_eps);
        de = 0.5 * iteration_result.escape_length * log(iteration_result.escape_length) / grad_len;
    }
    else if(0.0 == 0.0)
    {
        //potential gradient de:
        // DE = (0.5 / exp(G)) * sinh(G) / |grad(G)|
        let G = iteration_result.potential;
        let grad = vec4f(rx.potential, ry.potential, rz.potential, rw.potential) - vec4f(G);
        let grad_len = length(grad / offset_eps);
        let sinh_G = (exp(G) - exp(-G)) / 2.0;// Using sinh(G) approximation for numerical stability
        de = (0.5 / exp(G)) * sinh_G / grad_len;
    }
    else if(0.0 == 0.0)
    {
        //iq de:
        // DE = G / |grad(G)|
        let G = iteration_result.potential;
        let grad = vec4f(rx.potential, ry.potential, rz.potential, rw.potential) - vec4f(G);
        let grad_len = length(grad / offset_eps);
        de =  G / grad_len;
    }

    // transform back
    de = de * de_object.scale;

    return DEResults(de, iteration_result, offset_results);
}

fn get_tetrahedron_offsets(p_center: vec3f, de_object: SceneObject, offset_eps: f32, iterations: i32) -> array<IterationLoopResult, 4> {
    let k1 = vec3f(1.0, -1.0, -1.0);
    let k2 = vec3f(-1.0, -1.0, 1.0);
    let k3 = vec3f(-1.0, 1.0, -1.0);
    let k4 = vec3f(1.0, 1.0, 1.0);
    return array<IterationLoopResult, 4>(
        compute_fractal_state(p_center + offset_eps * k1, de_object, iterations),
        compute_fractal_state(p_center + offset_eps * k2, de_object, iterations),
        compute_fractal_state(p_center + offset_eps * k3, de_object, iterations),
        compute_fractal_state(p_center + offset_eps * k4, de_object, iterations)
    );

}

fn intersect_fractal(ray: Ray, object_index: i32, fast_eval: bool) -> Hit
{
    let fractal_object = scene_objects[object_index];
    //first check if ray intersects bounding sphere
    let bounding_sphere_t1t2 = sphere_t1t2(ray, fractal_object.scale, fractal_object.position);
    if(bounding_sphere_t1t2.y < 0.0) {
        return no_hit;//behind the ray
    }

    //start estimation on bounds
    var estimated_distance = max(EPS, bounding_sphere_t1t2.x);

    var max_marching_steps = i32(settings.fractal_settings.max_marching_steps);
    var raystep_multiplier = settings.fractal_settings.raystep_multiplier;
    if(fast_eval) {
        max_marching_steps = 100;
        raystep_multiplier = 1.0;
    }

    let pixel_angular_resolution = 2.0*tan((settings.cam.fov_angle * PI / 180.0)*0.5) / settings.width; //TODO: this could be a uniform
    var hit_eps = EPS;
    var offset_eps = EPS;
    var is_surface_hit = false;
    var iteration_results: DEResults;
    for(var i = 0; i < max_marching_steps; i++)
    {
        let pos = ray.pos + ray.dir * estimated_distance;
        offset_eps = settings.fractal_settings.offset_multiplier * hit_eps * 0.5;
        iteration_results = estimate_distance(pos, fractal_object, fast_eval, offset_eps);
    
        let raystep_estimate = iteration_results.de * raystep_multiplier;

        estimated_distance += raystep_estimate;

        if(estimated_distance > bounding_sphere_t1t2.y) {
            return no_hit;//ray intersected the bounding sphere but not the fractal
        }

        let distance_to_camera = length(settings.cam.position - pos);
        hit_eps = EPS * (1.0 + 10.0 * distance_to_camera * settings.width * pixel_angular_resolution);
        if(fast_eval) {
            hit_eps *= 100.0;
        }

        if(abs(raystep_estimate) < hit_eps)
        {
            is_surface_hit = true;
            break;
        }
    }

    if(!is_surface_hit) {
        return no_hit;
    }
    
    // After initial raymarching finds a point near the surface, binary search for more precise intersection
    // figure out search range
    var t_near: f32;
    var t_far: f32;
    if (iteration_results.center.escaped) {
        // iteration escaped, position is outside, surface is ahead
        t_near = estimated_distance;
        t_far = estimated_distance + hit_eps;
    } else {
        let last_raystep = iteration_results.de * raystep_multiplier;
        // iteration did not escape, position is inside, surface is behind
        t_near = estimated_distance - last_raystep;
        t_far = estimated_distance;
    }
    let binary_search_steps = /*10*/i32(settings.render_settings.russian_roulette_start_bounce);
    for (var i = 0; i < binary_search_steps; i++) {
        let t_mid = 0.5 * (t_far + t_near);
        let pos_mid = ray.pos + ray.dir * t_mid;
    
        //transform by object's translation/scale
        var pos_mid_tf = (pos_mid - fractal_object.position) / fractal_object.scale;
        
        // Evaluate fractal at midpoint
        let state = compute_fractal_state(pos_mid_tf, fractal_object, i32(settings.fractal_settings.iterations));
        
        if (state.escaped) {
            t_near = t_mid; // Midpoint is outside, move closer
        } else {
            t_far = t_mid; // Midpoint is inside, move back
        }
    }
    var refined_distance = 0.5 * (t_near + t_far);
    var refined_pos = ray.pos + ray.dir * refined_distance;
    refined_pos = (refined_pos - fractal_object.position) / fractal_object.scale; //transform back

    let final_offset_eps = settings.fractal_settings.offset_multiplier * hit_eps * 0.5;
    let offset_results = get_tetrahedron_offsets(refined_pos, fractal_object, final_offset_eps, i32(settings.fractal_settings.iterations));
    let surface_normal = normalize(
        offset_results[0].escape_length * vec3f(1.0, -1.0, -1.0) + 
        offset_results[1].escape_length * vec3f(-1.0, -1.0, 1.0) +
        offset_results[2].escape_length * vec3f(-1.0, 1.0, -1.0) + 
        offset_results[3].escape_length * vec3f(1.0, 1.0, 1.0)
    );
    
    refined_distance -= 2.0*hit_eps; //move back a bit to avoid self-intersection problems
    let hit_pos = ray.pos + ray.dir * refined_distance;

    return Hit(
        object_index,
        refined_distance,
        hit_pos,
        surface_normal
    );
}

fn intersect_sphere(ray: Ray, object_index: i32) -> Hit
{
    let sphere = scene_objects[object_index];

    let t1t2 = sphere_t1t2(ray, sphere.scale, sphere.position);
    if(t1t2.y < 0.01) {//TODO: why does this need so big eps?
        return no_hit;
    }
    let t1 = t1t2.x;
    let t2 = t1t2.y;

    var t = 0.0;
    //avoid self-intersection with small epsilon
    if(t2 > EPS) {
        t = t2;
    }
    if(t1 > EPS) {
        t = t1;
    }

    let hit_pos = ray.pos + ray.dir * t;
    let surface_normal = normalize(hit_pos - sphere.position);
    return Hit(
        object_index,
        t,
        hit_pos,
        surface_normal
    );
}

fn intersect_object(ray: Ray, object_index: i32, fast_eval: bool) -> Hit {
    let object = scene_objects[object_index];
    switch(i32(object.object_type))
    {
        case 0: {
            return intersect_sphere(ray, object_index);
        }
        case 1: {
            return intersect_fractal(ray, object_index, fast_eval);
        }
        case default: {
            return no_hit;
        }
    }
}

fn intersect_scene(ray: Ray, fast_eval: bool) -> Hit {
	var closest_hit = Hit();
	closest_hit.object_index = -1;
	closest_hit.distance = 9999999.0;//TODO: use infinity https://github.com/gpuweb/gpuweb/issues/3431
	for (var object_index = 0; object_index < i32(settings.object_count); object_index++)
	{
		var hit = intersect_object(ray, object_index, fast_eval);
		if (hit.object_index >= 0 && hit.distance < closest_hit.distance)
		{
			closest_hit = hit;
		}
	}
	return closest_hit;
}

//return true if any object intersects the specified ray in max_distance
fn intersect_shadow(shadow_ray: Ray, max_distance: f32, target_object_index: i32) -> bool {
	for (var object_index = 0; object_index < i32(settings.object_count); object_index++)
	{
        if (object_index != target_object_index)
        {
		    var hit = intersect_object(shadow_ray, object_index, false);
            if (hit.object_index >= 0 && hit.distance < max_distance) {
			    return true;
            }
            //TODO: review. handle the case when the shadow ray hits another emissive object, in which case the light sample could come from there?
        }
    }
    return false;
}

const sky_strength = 1.0;
fn sky_emission(ray_dir: vec3f) -> vec3f {
    //TODO: single color for now
    return sky_strength * settings.sky_color;
}

var<private> fresnel_seq_index: u32 = 0;
fn get_brdf_sample(ray_in: Ray, hit: Hit) -> BRDFSample {
    let hit_object = scene_objects[hit.object_index];
    let hit_material = scene_materials[i32(hit_object.material_index)];
    

    var normal = hit.surface_normal;
    var ior = hit_material.ior;
    if(dot(hit.surface_normal, ray_in.dir) > 0.0) 
    {//hit from inside
        normal *= -1;
    } else {
        ior = 1.0/ior;
    }

    let cos_theta_cam = max(0.0, dot(-ray_in.dir, normal));
    var ray_origin = hit.position;
    var brdf = BRDFSample();

    switch(i32(hit_material.material_type)) { //fun fact: no fallthrough in wgsl, no need for break;
        case 0, default: { //diffuse
            ray_origin += normal * EPS;//move back a bit to avoid self-intersection problems
            let scatter_dir = cosWeightedRandomHemisphereDirection(normal, &scatter_seq_index);
            brdf.scattered_ray = Ray(ray_origin, scatter_dir);
            brdf.reflectance = hit_material.albedo/PI;
            brdf.cos_theta = max(0.0, dot(scatter_dir, normal));
            brdf.pdf = dot(scatter_dir, normal) / PI;//pdf for cosine weighted hemisphere
        }
        case 1: { //reflect
            ray_origin += normal * EPS;//move back a bit to avoid self-intersection problems
            let scatter_dir = reflect(ray_in.dir, normal);
            brdf.scattered_ray = Ray(ray_origin, scatter_dir);
            brdf.reflectance = schlick_fresnel(cos_theta_cam, hit_material.albedo);
            brdf.cos_theta = 1.0;
            brdf.pdf = 1.0;
        }
        case 2: { //reflect+refract
            let r0 = pow((1.0 - hit_material.ior) / (1.0 + hit_material.ior), 2.0);
            let fresnel = schlick_fresnel(cos_theta_cam, vec3f(r0));
            let fresnel_strength = (fresnel.r + fresnel.g + fresnel.b) / 3.0;
            var scatter_dir: vec3f;
            if (r1(fresnel_seq_index) < fresnel_strength) {
                ray_origin += normal * EPS;
                scatter_dir = reflect(ray_in.dir, normal);
                brdf.reflectance = fresnel;
                brdf.pdf = fresnel_strength;
            } else {
                ray_origin -= normal * EPS;
                scatter_dir = refract(ray_in.dir, normal, ior);
                brdf.reflectance = vec3f(1.0) - fresnel;
                brdf.pdf = 1.0 - fresnel_strength;
            }
            fresnel_seq_index++;
            brdf.scattered_ray = Ray(ray_origin, scatter_dir);
            brdf.cos_theta = 1.0;
        }
    }
    return brdf;
}

//starts a ray from the surface of the specified object
fn sample_light_ray(emissive_object: SceneObject, preferred_direction: vec3f) -> Ray {
    switch(i32(emissive_object.object_type))
    {
        case 0, default: { //sphere
            let dir = cosWeightedRandomHemisphereDirection(preferred_direction, &light_seq_index);
            let pos = emissive_object.position + (emissive_object.scale+EPS) * dir;
            return Ray(pos, dir);
        }
    }

}

//uniformly picks from all objects having emissive materials
//returns the index of the picked object
fn sample_emissive_object() -> i32
{
    var target_index = i32(settings.emissive_object_count * r1(light_seq_index));
    for (var i = 0; i < i32(settings.object_count); i++)
    {
        if (length(scene_materials[i32(scene_objects[i].material_index)].emission) > 0.0) {
            target_index--;
        }
        if (target_index == -1) {
            return i;//found the one we picked
        }
    }
    return -1;//no lights in the scene
}

fn direct_light(hit: Hit) -> DirectLightSample
{
    let hit_object = scene_objects[hit.object_index];
    let hit_material = scene_materials[i32(hit_object.material_index)];

	if(length(hit_material.emission) > 0.0) {
		return DirectLightSample(vec3f(0.0), 0.0);//we already handle this in the main path tracing loop
    }

    let light_source_index = sample_emissive_object();
    let light_source = scene_objects[light_source_index];
    let preferred_dir = normalize(hit.position - light_source.position);
    let light_ray = sample_light_ray(light_source, preferred_dir);
    let direct_light_vector = light_ray.pos - hit.position;

    let shadow_ray = Ray(hit.position + hit.surface_normal*EPS, normalize(direct_light_vector));
    let is_shadow = intersect_shadow(shadow_ray, length(direct_light_vector), light_source_index);
    if(is_shadow) {
        return DirectLightSample(vec3f(0.0), 0.0);
    }

    let light_pdf = light_pdf(hit.position, light_ray.pos, light_source);

    let cos_theta_light = max(0.0, dot(light_ray.dir, -normalize(direct_light_vector)));
    let cos_theta_hit = max(0.0, dot(normalize(direct_light_vector), hit.surface_normal));
    let surface_brdf = hit_material.albedo / PI; //direct light calculated for diffuse only
    var direct_contribution = surface_brdf * cos_theta_hit * cos_theta_light * scene_materials[i32(light_source.material_index)].emission;

    //light falloff: instead of 1/r^2, add +1 to avoid saturation near the light source
    direct_contribution *= 1.0 / (1.0 + length(direct_light_vector)*length(direct_light_vector));

    direct_contribution = max(vec3f(0.0), direct_contribution);

    return DirectLightSample(direct_contribution, light_pdf);
}

fn trace_path(cam_ray: Ray) -> vec3f
{
    var result = vec3f(0.0);
    var throughput = vec3f(1.0);//is 100% at the camera
    var bounce = 0u;
    var ray = cam_ray;
    var prev_bounce_data = MISData();

	while (bounce < u32(settings.render_settings.max_bounces))
	{
        let fast_eval = false;//bounce > 2;
		var hit = intersect_scene(ray, fast_eval);

        if(hit.object_index == -1)
        {//no object hit, sky
            var sky = sky_emission(ray.dir);
			result += throughput * sky;
            break;
        }

        if(bounce == 0 && save_depth_data)
        {//save depth data for the queried pixel
            results.query_depth = hit.distance;
        }

        let hit_object = scene_objects[hit.object_index];
        let hit_material = scene_materials[i32(hit_object.material_index)];

        if(length(hit_material.emission) > 0.0)
        {
            var mis_weight = 1.0;
            if(bounce > 0 && !prev_bounce_data.is_material_specular)
            {//after the first bounce, we can calculate MIS weight
                let light_pdf = light_pdf(prev_bounce_data.hit.position, hit.position, hit_object);
                mis_weight = power_heuristic_beta2(prev_bounce_data.brdf.pdf, light_pdf);
            }
            result += throughput * hit_material.emission * mis_weight;
            break;//terminate at light hit
        }
                
        let brdf = get_brdf_sample(ray, hit);

        if(hit_material.material_type == 0)
        {//direct light sampling on diffuse materials
            if(dot(hit.surface_normal, ray.dir) > 0.0)
            {//hit from inside
                hit.surface_normal *= -1;
            }
            let direct_light_sample = direct_light(hit);
            if(length(direct_light_sample.contribution) + direct_light_sample.pdf > 0.0) {
                let mis_weight = power_heuristic_beta2(direct_light_sample.pdf, brdf.pdf);
                result += throughput * (direct_light_sample.contribution / direct_light_sample.pdf) * mis_weight;
            }
        }
        
        //russian roulette: for unbiased rendering, stop bouncing if ray is unimportant
		if (bounce >= u32(settings.render_settings.russian_roulette_start_bounce))//only after a few bounces (only apply on indirect rays)
		{
            var p_survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.0, 1.0);
            //modify survival chance based on the material type
            if (i32(hit_material.material_type) == 1) {
                p_survive = max(p_survive, settings.render_settings.russian_roulette_min_p_reflect);
            } else if (i32(hit_material.material_type) == 2) {
                p_survive = max(p_survive, settings.render_settings.russian_roulette_min_p_refract); //glass: keep alive longer for caustics
            }
			let p_die = r1(bounce);
			if (p_die > p_survive) { //die
                break; 
            }
            else { //alive
				throughput *= 1.0/p_survive;
            }
		}
        
        let weight = brdf.reflectance * brdf.cos_theta / brdf.pdf;
        throughput *= weight;
        ray = brdf.scattered_ray;

        //save info for next bounce
        prev_bounce_data.hit = hit;
        prev_bounce_data.brdf = brdf;
        prev_bounce_data.is_material_specular = (i32(hit_material.material_type) != 0);

        bounce++;
    }

    return result;
}

fn ACESFilm(color_in: vec3f) -> vec3f {
    var color = color_in;
    color *= 0.6;
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color*(a*color+b)) / (color*(c*color+d)+e), vec3f(0.0), vec3f(1.0));
}

fn tonemap(color_in: vec3f) -> vec3f {
    var color = color_in;

    color = ACESFilm(color);

    //gamma correction (convert RGB to SRGB), this is the last step
    let inv_gamma = 1.0/2.4;
    if (color.x <= 0.0031308) {
        color.x = color.x * 12.92;
    } else {
        color.x = 1.055 * pow(color.x, inv_gamma) - 0.055;
    }
    if (color.y <= 0.0031308) {
        color.y = color.y * 12.92;
    } else {
        color.y = 1.055 * pow(color.y, inv_gamma) - 0.055;
    }    
    if (color.z <= 0.0031308) {
        color.z = color.z * 12.92;
    } else {
        color.z = 1.055 * pow(color.z, inv_gamma) - 0.055;
    }

    return color;
}

@vertex
fn vertexMain(@location(0) pos: vec2f) -> @builtin(position) vec4f {
    return vec4f(pos, 0, 1);
}

fn tent(x_in: f32) -> f32 {
    var x = x_in;
    x = 2.f * x - 1.f;
    if (x == 0) { return 0.0; }
    return x / sqrt(abs(x)) - sign(x);
}

@fragment
fn fragmentMain(@builtin(position) coord_in: vec4f) -> @location(0) vec4f {
    let bigprime: u32 = 1717885903u;
    seed = bigprime*(u32(coord_in.x) + u32(coord_in.y)*u32(settings.width)) + u32(settings.total_accumulation_steps);
    
    let query_pixel = query_settings.query_pixel;
    save_depth_data = (query_pixel.x >= 0.0 && query_pixel.y >= 0.0 && 
                       u32(coord_in.x) == u32(query_pixel.x) && u32(coord_in.y) == u32(query_pixel.y));

    //TODO: these could be uniforms
    let fov = (settings.width/2) / tan(settings.cam.fov_angle * PI/180.0 / 2.0);
    let tlc = settings.cam.forward*fov + settings.cam.up*(settings.height/2) - settings.cam.right*(settings.width/2);
    
    var frame_acc = vec3f(0.0);
    for (var i = 0u; i < u32(settings.workload_accumulation_steps); i++)
    {
        current_accumulation_step = u32(settings.total_accumulation_steps) + i;
        pixel_rand = f_hash3(&seed);
        seed++;

        let aa_samples = r2(i);
        let aa_offset = vec2f(tent(aa_samples.x)+0.5, tent(aa_samples.y)+0.5);

        let raydir = normalize(tlc + settings.cam.right * (coord_in.x + aa_offset.x) - settings.cam.up * (coord_in.y + aa_offset.y));
        var ray = Ray(settings.cam.position, raydir);

        if(settings.cam.dof_size > 0.0)
        {//depth of field
            let focuspoint = settings.cam.position + (ray.dir*settings.cam.focus_distance / dot(ray.dir, settings.cam.forward)); //divide by cos(theta) so that focus is a plane, not a sphere
            let dof_samples = r2(i);
            let aperture_radius = sqrt(dof_samples.x) * settings.cam.dof_size;
            let aperture_angle = dof_samples.y * 2.0 * PI;
            ray.pos += 
                settings.cam.right * aperture_radius * cos(aperture_angle) + 
                settings.cam.up    * aperture_radius * sin(aperture_angle);
            ray.dir = normalize(focuspoint - ray.pos);
        }

        frame_acc += trace_path(ray);
    }

    //add accumulated samples to histogram
    var histogram_value = vec3f(0.0);
    if(settings.total_accumulation_steps > 0){
        histogram_value = histogram[i32(coord_in.x+coord_in.y*settings.width)].rgb;
    }
    let accumulated = histogram_value + frame_acc;
    histogram[i32(coord_in.x+coord_in.y*settings.width)] = vec4f(accumulated, 0.0);

    //display tonemapped image
    let norm = settings.total_accumulation_steps + settings.workload_accumulation_steps;
    let display_frag = vec4(tonemap(accumulated.rgb/norm), 1.0);
    return display_frag;
}
`;
