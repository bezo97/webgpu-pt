export default `

//no pre-processor duh
const PI = 3.14159265;
const EPS = 2e-5;
const max_bounces = 6;
const no_hit = Hit(-1, -1.0, vec3f(0.0));

struct Ray {
    pos: vec3f,
    dir: vec3f,
}

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

struct Hit {
    //-1 means no hit
	object_index: i32,
	distance: f32,
	surface_normal: vec3f,//outer surface
};

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
    sample: f32,//i32
    width: f32,
    height: f32,
    object_count: f32,//i32
    emissive_object_count: f32,//i32
};


struct FragmentStageOutput {
    @location(0) screen: vec4f,
    @location(1) lastFrame: vec4f,
}

//TODO: consider constant memory buffer?

@group(0) @binding(0) var<uniform> settings: SceneSettings;

@group(0) @binding(1) var<storage, read> scene_objects: array<SceneObject>;

@group(0) @binding(2) var<storage, read> scene_materials: array<SceneMaterial>;

@group(1) @binding(0) var lastFrameTexture: texture_2d<f32>;

//TODO: remove and pass as argument
var<private> seed: u32 = 12345;

//pcg hash implementation is wgsl
//https://github.com/bevyengine/bevy/pull/11956/
fn pcg_hash_f(state: ptr<private, u32>) -> f32 {
    *state = *state * 747796405u + 2891336453u;
    let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
    return f32((word >> 22u) ^ word) * bitcast<f32>(0x2f800004u);
}
fn pcg_hash_2f(state: ptr<private, u32>) -> vec2<f32> {
    return vec2(pcg_hash_f(state), pcg_hash_f(state));
}
fn pcg_hash_3f(state: ptr<private, u32>) -> vec3<f32> {
    return vec3(pcg_hash_f(state), pcg_hash_f(state), pcg_hash_f(state));
}

fn cosWeightedRandomHemisphereDirection(n: vec3f) -> vec3f {
    let r = pcg_hash_2f(&seed);
    let uu = normalize(cross(n, vec3(0.0,1.0,1.0)));
    let vv = cross(uu, n);
    let ra = sqrt(r.y);
    let rx = ra*cos(2.0*PI*r.x);
    let ry = ra*sin(2.0*PI*r.x);
    let rz = sqrt(1.0 - r.y);
    let rr = vec3f( rx*uu + ry*vv + rz*n );
    return normalize( rr );
}

fn intersect_sphere(ray: Ray, object_index: i32) -> Hit
{
    let sphere = scene_objects[object_index];

    let offset = sphere.position - ray.pos;
    let b = dot(offset, ray.dir);
    if(b < 0.0) {
        return no_hit;
    }
    let c = dot(offset, offset) - b*b;
    if(c > sphere.scale*sphere.scale){
        return no_hit;
    }
    let thc = sqrt(sphere.scale*sphere.scale - c);
    let t1 = b - thc;
    let t2 = b + thc;

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

fn intersect_object(ray: Ray, object_index: i32) -> Hit {
    let object = scene_objects[object_index];
    switch(i32(object.object_type))
    {
        case 0: {
            return intersect_sphere(ray, object_index);
        }
        case default: {
            return no_hit;
        }
    }
}

fn intersect_scene(ray: Ray) -> Hit {
	var closest_hit = Hit();
	closest_hit.object_index = -1;
	closest_hit.distance = 9999999.0;//TODO: use infinity https://github.com/gpuweb/gpuweb/issues/3431
	for (var object_index = 0; object_index < i32(settings.object_count); object_index++)
	{
		var hit = intersect_object(ray, object_index);
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
		var hit = intersect_object(shadow_ray, object_index);
        if (hit.object_index > 0 && hit.distance < max_distance && object_index != target_object_index) {
			return true;
        }
        //TODO: review. handle the case when the shadow ray hits another emissive object, in which case the light sample could come from there?
    }
    return false;
}

const sky_strength = 0.25;
fn sky_emission(ray_dir: vec3f) -> vec3f {
    //TODO: single color for now
    return sky_strength * settings.sky_color;
}

fn get_brdf_ray(ray_in: Ray, hit: Hit) -> Ray {
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

    var hit_pos = ray_in.pos + ray_in.dir * hit.distance;

    //TODO: importance sample by fresnel weight
    //fresnel weight = ..
    //p_choice = fresnel weight
    //return weight too
    
    switch(i32(hit_material.material_type)) {
        case 0, default: { //diffuse
            //weight:albedo
            hit_pos += normal * EPS;//move back a bit to avoid self-intersection problems
            return Ray(hit_pos, cosWeightedRandomHemisphereDirection(normal));
        }
        case 1: { //reflect
            hit_pos += normal * EPS;//move back a bit to avoid self-intersection problems
            return Ray(hit_pos, reflect(ray_in.dir, normal));
        }
        case 2: { //refract
            hit_pos -= normal * EPS;//move forward a bit to avoid self-intersection problems
            return Ray(hit_pos, refract(ray_in.dir, normal, ior));
        }
    }
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
    var target_index = i32(settings.emissive_object_count * pcg_hash_f(&seed));
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
		return vec3f(0.0);//idk?
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
    var direct_contribution = cos_theta_hit * cos_theta_light * scene_materials[i32(light_source.material_index)].emission; //does the emissive object color matter here?

    //falloff
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

        //russian roulette: for unbiased rendering, stop bouncing if ray is unimportant
		if (bounce > 3)//only after a few bounces (only apply on indirect rays)
		{
            let p_survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.0, 1.0);
			let roulette = pcg_hash_f(&seed);
			if (roulette < p_survive)
			{//alive
				throughput *= 1.0/p_survive;//TODO: check paper
			}
			else
			{//die
				break;
			}
		}


		var hit = intersect_scene(ray);

        if(hit.object_index == -1)
        {//no object hit, sky
            var sky = sky_emission(ray.dir);
            // if(bounce == 0)
            // {//first hit sky
            //     sky /= sky_strength;
            // }
			result += throughput * sky;
            return result;
        }

        let hit_object = scene_objects[hit.object_index];
        let hit_material = scene_materials[i32(hit_object.material_index)];


        //direct light sampling
        //if(cam_ray.dir.x<0.0){
		    //result += throughput * direct_light(hit, ray.pos + ray.dir * hit.distance);
        //}

        result += throughput * hit_material.emission;

        //TODO: calculate reflectance from material
        let reflectance = hit_material.albedo;
        throughput *= reflectance;
        
        //ray,weight = brdf.scatter ray hit

        ray = get_brdf_ray(ray, hit);
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

@fragment
fn fragmentMain(@builtin(position) coord_in: vec4f) -> FragmentStageOutput {
    let bigprime: u32 = 1717885903;
    seed = bigprime*(u32(coord_in.x) + u32(coord_in.y)*u32(settings.width)) + u32(settings.sample);
    //calculate ray
    let fov = (settings.width/2) / tan(settings.cam.fov_angle * PI/180.0);
    let tlc = settings.cam.forward*fov + settings.cam.up*(settings.height/2) - settings.cam.right*(settings.width/2);
    
    let samples = pcg_hash_2f(&seed);
    let aa_offset = vec2f(tent(samples.x)+0.5, tent(samples.y)+0.5);

    let raydir = normalize(tlc + settings.cam.right * (coord_in.x + aa_offset.x) - settings.cam.up * (coord_in.y + aa_offset.y));
    let ray = Ray(settings.cam.position, raydir);

    var trace_result = trace_path(ray);

    var frame_result = tonemap(trace_result);
    
    //TODO: does not converge possibly because of precision
    let last_frame = textureLoad(lastFrameTexture, vec2i(floor(coord_in.xy)), 0).rgb;
	let blend_factor = 1.0 / (settings.sample + 1);
    let output = vec4(mix(last_frame, frame_result, blend_factor), 1.0);
    return FragmentStageOutput(output, output);
}
`;
