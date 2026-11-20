"""Bake the London street's lighting in Blender (Cycles): a day map (the grey winter sky, with
every corner and overhang shading it) and a night map (all the street lamps, wall lanterns and lit
windows, with light bouncing off the walls and the wet ground).

Usage (Blender as a Python module, `pip install bpy pillow numpy`):
  python bake-london.py <dir with london.glb + london-lights.json> <out dir> [size] [day samples] [night samples]
Writes london_day.png, london_night.png and london.json into <out dir> (public/game/baked).
"""
import json, math, os, sys, time
import bpy
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
DAY_S = int(sys.argv[4]) if len(sys.argv) > 4 else 96
NIGHT_S = int(sys.argv[5]) if len(sys.argv) > 5 else 256
info = json.load(open(os.path.join(src, 'london-lights.json')))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src, 'london.glb'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3

def b(p):  # three.js (Y up) -> Blender (Z up)
    return (p[0], -p[2], p[1])

img = bpy.data.images.new('LM', SIZE, SIZE, float_buffer=True, alpha=False)
targets = []
for o in scene.objects:
    if o.type != 'MESH':
        continue
    if o.name.startswith('S') and o.name[1:].isdigit():
        targets.append(o)
        mat = o.active_material
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for inp in ('Metallic',):
            bsdf.inputs[inp].default_value = 0
        bsdf.inputs['Roughness'].default_value = 1
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img
        nt.nodes.active = tn
print('surfaces', len(targets))

world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']

lights = []
def light(kind, name, pos, energy, color, size=0.1, rot=None, sx=None, sy=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy; ld.color = color
    if kind == 'POINT':
        ld.shadow_soft_size = size
    else:
        ld.shape = 'RECTANGLE'; ld.size = sx; ld.size_y = sy
    ob = bpy.data.objects.new(name, ld); ob.location = pos
    if rot: ob.rotation_euler = rot
    scene.collection.objects.link(ob); lights.append(ob)

z_mid = 14.0
for i, p in enumerate(info['lamps']):
    light('POINT', f'lamp{i}', b(p), 160, (1.0, 0.8, 0.55), 0.06)
for i, p in enumerate(info['lanterns']):
    light('POINT', f'lantern{i}', b(p), 45, (1.0, 0.78, 0.5), 0.05)
for i, (x, y, z, w, h, d) in enumerate(info['lit']):
    out_dir = 1 if z < z_mid else -1  # three.js +z faces the near row's street side
    pos = b((x, y, z + out_dir * 0.06))
    light('AREA', f'win{i}', pos, 14 * w * h, (1.0, 0.72, 0.45), rot=(-math.pi / 2 if out_dir > 0 else math.pi / 2, 0, 0), sx=w, sy=h)

bpy.ops.object.select_all(action='DESELECT')
for o in targets:
    o.select_set(True)
    o.data.uv_layers.active_index = 0
bpy.context.view_layer.objects.active = targets[0]

def bake(name, samples):
    scene.cycles.samples = samples
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=3, margin_type='EXTEND', use_clear=True)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)[:, :, :3]
    print(f'{name}: {time.time() - t:.0f}s')
    return a

# Day: overcast winter sky, no lamps.
bg.inputs['Color'].default_value = (0.62, 0.66, 0.72, 1); bg.inputs['Strength'].default_value = 1.0
for l in lights: l.hide_render = True
day = bake('day', DAY_S)
# Night: lamps, lanterns and windows; a faint city glow in the sky.
bg.inputs['Color'].default_value = (0.02, 0.022, 0.03, 1); bg.inputs['Strength'].default_value = 1.0
for l in lights: l.hide_render = False
night = bake('night', NIGHT_S)

def save(a, fname, corner):
    # Remove sparkle noise a little (3x3 median within each texel's neighbourhood would blur
    # across patches, so only clamp outliers to the local max of their 4 neighbours).
    nb = np.maximum.reduce([np.roll(a, 1, 0), np.roll(a, -1, 0), np.roll(a, 1, 1), np.roll(a, -1, 1)])
    a = np.minimum(a, nb * 1.5 + 1e-4)
    a[:8, :8] = corner                           # the shared patch for things outside the street
    scale = float(np.percentile(a.max(axis=2), 99.7)) or 1.0
    v = np.clip(a / scale, 0, 1)
    srgb = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    Image.fromarray((srgb[::-1] * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, fname), optimize=True)
    return scale

os.makedirs(out, exist_ok=True)
ds = save(day, 'london_day.png', np.percentile(day.reshape(-1, 3), 60, axis=0))
ns = save(night, 'london_night.png', np.array([0.004, 0.004, 0.005]))
json.dump({'hash': info['hash'], 'day': 'london_day.png', 'night': 'london_night.png', 'dayScale': ds, 'nightScale': ns, 'size': SIZE}, open(os.path.join(out, 'london.json'), 'w'), indent=1)
print('scales', ds, ns)
