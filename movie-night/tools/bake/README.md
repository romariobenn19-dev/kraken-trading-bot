# Baked lighting for Our World (London)

The street's lighting is precalculated in Blender, like big games do: how the grey winter sky
lights every wall and corner by day, and how all the lamps, wall lanterns and lit windows light the
street at night (light bouncing off walls and the wet ground included). The game blends the two
light textures (`public/game/baked/`) as day turns to night.

The textures only fit the street exactly as `public/game/london.js` builds it. The game checks a
fingerprint (`hash` in `london.json`); if the street has changed, it simply lights everything live
until the bake is redone:

1. Run Movie Night (with `game-assets` downloaded) and export the street:
   `node tools/bake/export-london.js "http://localhost:3000/?key=YOURKEY" bake-in`
2. Bake (Blender as a Python module: `pip install bpy pillow numpy`; about 15 minutes on 4 cores):
   `python tools/bake/bake-london.py bake-in public/game/baked 2048 64 192`
