export default `

//no pre-processor duh
const PI = 3.14159265;
const EPS = 2e-5;
const no_hit = Hit(-1, -1.0, vec3f(0.0), vec3f(0.0));

//uniform structs:

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
}

struct SceneSettings {
    cam: Camera,
    render_settings: RenderSettings,
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
    center_depth: f32,
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

//TODO: consider constant memory buffer?

@group(0) @binding(0) var<uniform> settings: SceneSettings;

@group(0) @binding(1) var<storage, read> scene_objects: array<SceneObject>;

@group(0) @binding(2) var<storage, read> scene_materials: array<SceneMaterial>;

@group(1) @binding(0) var<storage, read_write> histogram: array<vec4f>;

@group(1) @binding(1) var<storage, read_write> results: PassResults;

var<private> seed: u32 = 12345;

var<private> pixel_rand: vec3f = vec3f(0.0);//random offset on the low-discrepancy samples, per pixel
var<private> current_accumulation_step: u32 = 0u;
var<private> save_depth_data: bool = false;

// Hash function for 32 bit uint
// Found here: https://nullprogram.com/blog/2018/07/31/
fn lowbias32(x_in: u32) -> u32
{
    var x = x_in;
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
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
    let uu = normalize(cross(n, vec3(0.0,1.0,1.0)));
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

fn de_mandelbox(p: vec3f, steps: i32, scale: f32) -> f32
{//based on: https://www.shadertoy.com/view/MtXXDl
    let q0 = vec4f(p*10.0, 1.0);
    var q = q0;
    for (var n = 0; n < steps; n++) {
        q = vec4f(clamp(q.xyz, vec3f(-1.0), vec3f(1.0)) * 2.0 - q.xyz, q.w);
        q = q * scale / clamp(dot(q.xyz, q.xyz), 0.5, 1.) + q0;
    }
    return length(q.xyz) / abs(q.w)/10.0;
}

fn estimate_distance(pos: vec3f, de_object: SceneObject, fast_eval: bool) -> f32 {
    //transform by object's translation/scale
    var pos_tf = (pos - de_object.position)/de_object.scale;
    
    var iterations = 10;
    if(fast_eval){
        iterations = 5;
    }

    let de = de_mandelbox(pos_tf, iterations, 2.62);

    //tranform back
    return de*de_object.scale;
}

fn get_tetrahedron_normal(p: vec3f, de_object: SceneObject, normal_eps: f32, fast_eval: bool) -> vec3f {
    let k1 = vec3f(1.0, -1.0, -1.0);
    let k2 = vec3f(-1.0, -1.0, 1.0);
    let k3 = vec3f(-1.0, 1.0, -1.0);
    let k4 = vec3f(1.0, 1.0, 1.0);
    return normalize(
        k1 * estimate_distance(p + normal_eps * k1, de_object, fast_eval) +
        k2 * estimate_distance(p + normal_eps * k2, de_object, fast_eval) +
        k3 * estimate_distance(p + normal_eps * k3, de_object, fast_eval) +
        k4 * estimate_distance(p + normal_eps * k4, de_object, fast_eval)
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
    var total_distance = max(EPS, bounding_sphere_t1t2.x);

    var max_marching_steps = 500;
    var raystep_multiplier = 0.9;//aka. fuzzy factor
    if(fast_eval) {
        max_marching_steps = 100;
        raystep_multiplier = 1.0;
    }

    let pixel_angular_resolution = 2.0*tan((settings.cam.fov_angle * PI / 180.0)*0.5) / settings.width; //TODO: this could be a uniform
    var surface_eps = EPS;
    var is_surface_hit = false;
    for(var i = 0; i < max_marching_steps; i++)
    {
        let pos = ray.pos + ray.dir * total_distance;
        var raystep_estimate = estimate_distance(pos, fractal_object, fast_eval);

        total_distance += raystep_estimate * raystep_multiplier;

        if(total_distance > bounding_sphere_t1t2.y) {
            return no_hit;//ray intersected the bounding sphere but not the fractal
        }

        let distance_to_camera = length(settings.cam.position - pos);
        surface_eps = max(EPS, 0.1*distance_to_camera * pixel_angular_resolution);
        if(fast_eval) {
            surface_eps *= 100.0;
        }

        if(abs(raystep_estimate) < surface_eps)
        {
            is_surface_hit = true;
            break;
        }
    }

    if(!is_surface_hit) {
        return no_hit;
    }

    total_distance -= 2.0*surface_eps; //move back a bit to avoid self-intersection problems
    let hit_pos = ray.pos + ray.dir * total_distance;
    var surface_normal = get_tetrahedron_normal(hit_pos, fractal_object, surface_eps, fast_eval);

    return Hit(
        object_index,
        total_distance,
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
        {//save depth data for the center pixel
            results.center_depth = hit.distance;
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

fn ACESFilm(color_in: vec3f) -> vec3f
{
    var color = color_in;
    color *= 0.6;
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color*(a*color+b)) / (color*(c*color+d)+e), vec3f(0.0), vec3f(1.0));
}

fn tonemap(color_in: vec3f) -> vec3f
{
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
    save_depth_data = (settings.total_accumulation_steps == 0.0 && u32(coord_in.x)==u32(settings.width/2.0) && u32(coord_in.y)==u32(settings.height/2.0));

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
