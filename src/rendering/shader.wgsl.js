export default `

//no pre-processor duh
const PI = 3.14159265;
const EPS = 2e-5;
const max_bounces = 6;
const no_hit = Hit(-1, -1.0, vec3f(0.0));

//uniform structs:

struct SceneMaterial {
    material_type: f32,//i32
    albedo: vec3f,
    ior: f32,
    emission: vec3f,
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
}

struct SceneSettings {
    cam: Camera,
    sky_color: vec3f,
    time: f32,
    width: f32,
    height: f32,
    total_accumulation_steps: f32,//i32
    workload_accumulation_steps: f32,//i32
    object_count: f32,//i32
    emissive_object_count: f32,//i32
};

//helper structs:

struct Ray {
    pos: vec3f,
    dir: vec3f,
}

struct Hit {
	object_index: i32,//-1 means no hit
	distance: f32,
	surface_normal: vec3f,//outer surface
};

struct BRDFSample {
    scattered_ray: Ray,
    reflectance : vec3f,
    cos_theta: f32,
    pdf: f32,
}

//TODO: consider constant memory buffer?

@group(0) @binding(0) var<uniform> settings: SceneSettings;

@group(0) @binding(1) var<storage, read> scene_objects: array<SceneObject>;

@group(0) @binding(2) var<storage, read> scene_materials: array<SceneMaterial>;

@group(1) @binding(0) var<storage, read_write> histogram: array<vec4f>;

//TODO: remove and pass as argument
var<private> seed: u32 = 12345;

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

fn schlick_fresnel(cos_theta: f32, r0: vec3f) -> vec3f {
    return r0 + (vec3f(1.0) - r0) * pow(1.0 - cos_theta, 5.0);
}

fn cosWeightedRandomHemisphereDirection(n: vec3f) -> vec3f {
    let r = f_hash2(&seed);
    let uu = normalize(cross(n, vec3(0.0,1.0,1.0)));
    let vv = cross(uu, n);
    let ra = sqrt(r.y);
    let rx = ra*cos(2.0*PI*r.x);
    let ry = ra*sin(2.0*PI*r.x);
    let rz = sqrt(1.0 - r.y);
    let rr = vec3f( rx*uu + ry*vv + rz*n );
    return normalize( rr );
}

fn sphere_t1t2(ray: Ray, radius: f32, position: vec3f) -> vec2f
{
    let offset = position - ray.pos;
    let b = dot(offset, ray.dir);
    if(b < 0.0) {
        return vec2f(0.0);
    }
    let c = dot(offset, offset) - b*b;
    if(c > radius*radius){
        return vec2f(0.0);
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

fn intersect_fractal(ray: Ray, object_index: i32, fast_eval: bool) -> Hit
{
    let fractal_object = scene_objects[object_index];
    //first check if ray intersects bounding sphere
    let bounding_sphere_t1t2 = sphere_t1t2(ray, fractal_object.scale, fractal_object.position);
    if(length(bounding_sphere_t1t2) == 0.0) {
        return no_hit;
    }

    var total_distance = 0.0;
    //start estimation on bounds if we're outside the bounds
    if(bounding_sphere_t1t2.x > 0.0) {
        total_distance = bounding_sphere_t1t2.x;
    }

    var max_marching_steps = 500;
    if(fast_eval) {
        max_marching_steps = 100;
    }
    var is_surface_hit = false;
    for(var i = 0; i < max_marching_steps; i++)
    {
        let pos = ray.pos + ray.dir * total_distance;
        var raystep_estimate = estimate_distance(pos, fractal_object, fast_eval);

        var raystep_multiplier = 0.9;//aka. fuzzy factor
        if(fast_eval) {
            raystep_multiplier = 1.0;
        }
        total_distance += raystep_estimate * raystep_multiplier;

        if(total_distance > bounding_sphere_t1t2.y) {
            return no_hit;//ray intersected the bounding sphere but not the fractal
        }

        var surface_eps = 0.00001;
        if(fast_eval) {
            surface_eps = 0.01;
        }
        if(raystep_estimate < surface_eps)
        {
            is_surface_hit = true;
            break;
        }
    }

    if(!is_surface_hit) {
        return no_hit;
    }

    let p = ray.pos + ray.dir * total_distance;
    let n_eps = 1000.0*EPS;
    var surface_normal: vec3f;
    if(fast_eval) {
        surface_normal = normalize(vec3f(
            estimate_distance(vec3f(p.x + n_eps, p.y, p.z), fractal_object, fast_eval),
            estimate_distance(vec3f(p.x, p.y + n_eps, p.z), fractal_object, fast_eval),
            estimate_distance(vec3f(p.x, p.y, p.z + n_eps), fractal_object, fast_eval)) - p);
    } else {
        surface_normal = normalize(vec3f(
            estimate_distance(vec3f(p.x + n_eps, p.y, p.z), fractal_object, fast_eval) - estimate_distance(vec3f(p.x - n_eps, p.y, p.z), fractal_object, fast_eval),
            estimate_distance(vec3f(p.x, p.y + n_eps, p.z), fractal_object, fast_eval) - estimate_distance(vec3f(p.x, p.y - n_eps, p.z), fractal_object, fast_eval),
            estimate_distance(vec3f(p.x, p.y, p.z + n_eps), fractal_object, fast_eval) - estimate_distance(vec3f(p.x, p.y, p.z - n_eps), fractal_object, fast_eval)));
    }

    return Hit(
        object_index,
        total_distance,
        surface_normal
    );
}

fn intersect_sphere(ray: Ray, object_index: i32) -> Hit
{
    let sphere = scene_objects[object_index];

    let t1t2 = sphere_t1t2(ray, sphere.scale, sphere.position);
    if(length(t1t2) == 0.0) {
        return no_hit;
    }
    let t1 = t1t2.x;
    let t2 = t1t2.y;

    var t = 0.0;
    //avoid self-intersection with small epsilon
    if(t2 > EPS) {
        t = t2;
    }
    if(t1 > EPS && t1 < t2) {
        t = t1;
    }

    let surface_normal = normalize((ray.pos+ray.dir*t) - sphere.position);
    return Hit(
        object_index,
        t,
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
		var hit = intersect_object(shadow_ray, object_index, false);
        if (hit.object_index >= 0 && hit.distance < max_distance && object_index != target_object_index) {
			return true;
        }
        //TODO: review. handle the case when the shadow ray hits another emissive object, in which case the light sample could come from there?
    }
    return false;
}

const sky_strength = 1.0;
fn sky_emission(ray_dir: vec3f) -> vec3f {
    //TODO: single color for now
    return sky_strength * settings.sky_color;
}

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
    var hit_pos = ray_in.pos + ray_in.dir * hit.distance;
    var brdf = BRDFSample();

    switch(i32(hit_material.material_type)) { //fun fact: no fallthrough in wgsl, no need for break;
        case 0, default: { //diffuse
            hit_pos += normal * EPS;//move back a bit to avoid self-intersection problems
            let scatter_dir = cosWeightedRandomHemisphereDirection(normal);
            brdf.scattered_ray = Ray(hit_pos, scatter_dir);
            brdf.reflectance = hit_material.albedo/PI;
            brdf.cos_theta = max(0.0, dot(scatter_dir, normal));
            brdf.pdf = dot(scatter_dir, normal) / PI;//pdf for cosine weighted hemisphere
        }
        case 1: { //reflect
            hit_pos += normal * EPS;//move back a bit to avoid self-intersection problems
            let scatter_dir = reflect(ray_in.dir, normal);
            brdf.scattered_ray = Ray(hit_pos, scatter_dir);
            brdf.reflectance = schlick_fresnel(cos_theta_cam, hit_material.albedo);
            brdf.cos_theta = 1.0;
            brdf.pdf = 1.0;
        }
        case 2: { //reflect+refract
            let r0 = pow((1.0 - hit_material.ior) / (1.0 + hit_material.ior), 2.0);
            let fresnel = schlick_fresnel(cos_theta_cam, vec3f(r0));
            let fresnel_strength = (fresnel.r + fresnel.g + fresnel.b) / 3.0;
            var scatter_dir: vec3f;
            if (f_hash(&seed) < fresnel_strength) {
                hit_pos += normal * EPS;
                scatter_dir = reflect(ray_in.dir, normal);
                brdf.reflectance = fresnel / fresnel_strength;
            } else {
                hit_pos -= normal * EPS;
                scatter_dir = refract(ray_in.dir, normal, ior);
                brdf.reflectance = (vec3f(1.0) - fresnel) / (1.0 - fresnel_strength);
            }
                brdf.scattered_ray = Ray(hit_pos, scatter_dir);
            brdf.cos_theta = 1.0;
            brdf.pdf = 1.0;
        }
    }
    return brdf;
}

//starts a ray from the surface of the specified object
fn sample_light_ray(emissive_object: SceneObject, preferred_direction: vec3f) -> Ray {
    switch(i32(emissive_object.object_type))
    {
        case 0, default: { //sphere
            let dir = cosWeightedRandomHemisphereDirection(preferred_direction);
            let pos = emissive_object.position + (emissive_object.scale+EPS) * dir;
            return Ray(pos, dir);
        }
    }

}

//uniformly picks from all objects having emissive materials
//returns the index of the picked object
fn sample_emissive_object() -> i32
{
    var target_index = i32(settings.emissive_object_count * f_hash(&seed));
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

fn direct_light(hit: Hit, hit_position: vec3f) -> vec3f
{
    let hit_object = scene_objects[hit.object_index];
    let hit_material = scene_materials[i32(hit_object.material_index)];

	if(length(hit_material.emission) > 0.0) {
		return vec3f(0.0);//we already handle this in the main path tracing loop
    }

    let light_source_index = sample_emissive_object();
    let light_source = scene_objects[light_source_index];
    let preferred_dir = normalize(hit_position - light_source.position);
    let light_ray = sample_light_ray(light_source, preferred_dir);

    let direct_light_vector = light_ray.pos - hit_position;
    let shadow_ray = Ray(hit_position+hit.surface_normal*EPS, normalize(direct_light_vector));
    let is_shadow = intersect_shadow(shadow_ray, length(direct_light_vector), light_source_index);

    if(is_shadow) {
        return vec3f(0.0);
    }

    let cos_theta_light = max(0.0, dot(light_ray.dir, -normalize(direct_light_vector)));
    let cos_theta_hit = max(0.0, dot(normalize(direct_light_vector), hit.surface_normal));
    let surface_brdf = hit_material.albedo / PI;
    var direct_contribution = surface_brdf * cos_theta_hit * cos_theta_light * scene_materials[i32(light_source.material_index)].emission;

    //light falloff: instead of 1/r^2, add +1 to avoid saturation near the light source
    direct_contribution *= 1.0 / (1.0 + length(direct_light_vector)*length(direct_light_vector));

    direct_contribution = max(vec3f(0.0), direct_contribution);

    return direct_contribution;
}

fn trace_path(cam_ray: Ray) -> vec3f
{
    var result = vec3f(0.0);
    var throughput = vec3f(1.0);//is 100% at the camera

    var bounce = 0;
    var ray = cam_ray;
	while (bounce < max_bounces)
	{
        let fast_eval = bounce > 1;
		var hit = intersect_scene(ray, fast_eval);

        if(hit.object_index == -1)
        {//no object hit, sky
            var sky = sky_emission(ray.dir);
			result += throughput * sky;
            return result;
        }

        let hit_object = scene_objects[hit.object_index];
        let hit_material = scene_materials[i32(hit_object.material_index)];

        result += throughput * hit_material.emission;
        
        //direct light sampling
        if(hit_material.material_type == 0) {
		    result += throughput * direct_light(hit, ray.pos + ray.dir * hit.distance);
        }
        
        //russian roulette: for unbiased rendering, stop bouncing if ray is unimportant
		if (bounce > 3)//only after a few bounces (only apply on indirect rays)
		{
            var p_survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.0, 1.0);
            //modify survival chance based on the material type
            if (i32(hit_material.material_type) == 1) {
                p_survive = max(0.5, p_survive);
            } else if (i32(hit_material.material_type) == 2) {
                p_survive = max(0.75, p_survive); //glass: keep alive longer for caustics
            }
			let p_die = f_hash(&seed);
			if (p_die > p_survive) { //die
                break; 
            }
            else { //alive
				throughput *= 1.0/p_survive;
            }
		}
        
        let brdf = get_brdf_sample(ray, hit);
        let weight = brdf.reflectance * brdf.cos_theta / brdf.pdf;
        throughput *= weight;
        ray = brdf.scattered_ray;
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
    //TODO: these could be uniforms
    let fov = (settings.width/2) / tan(settings.cam.fov_angle * PI/180.0);
    let tlc = settings.cam.forward*fov + settings.cam.up*(settings.height/2) - settings.cam.right*(settings.width/2);
    
    var frame_acc = vec3f(0.0);
    for (var i = 0; i < i32(settings.workload_accumulation_steps); i++)
    {
        let aa_samples = f_hash2(&seed);
        let aa_offset = vec2f(tent(aa_samples.x)+0.5, tent(aa_samples.y)+0.5);

        let raydir = normalize(tlc + settings.cam.right * (coord_in.x + aa_offset.x) - settings.cam.up * (coord_in.y + aa_offset.y));
        let ray = Ray(settings.cam.position, raydir);

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
