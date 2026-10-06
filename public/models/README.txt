💡 CUSTOM 3D MODELS DIRECTORY
=============================

You can customize the graphics of your Table Tennis game by dropping standard `.glb` (binary GLTF) 3D models directly into this folder.

Expected Files:
----------------
1. table.glb
   - Expected Dimensions: ~1.525m (Width) x ~0.76m (Height) x ~2.74m (Length)
   - Pivot/Origin: Center of the tabletop plane.
   - Fallback: Procedural blue cyber table.

2. net.glb
   - Expected Dimensions: ~1.675m (Width) x ~0.1525m (Height)
   - Pivot/Origin: Center of the net baseline.
   - Fallback: Procedural white grids and laser ribbon.

3. racket.glb
   - Expected Dimensions: ~0.2m x ~0.2m x ~0.02m (racket face radius ~0.1m)
   - Pivot/Origin: Base of the handle grip (so it rotates naturally relative to hand coordinates).
   - Fallback: Procedural neon cyan/magenta racket meshes.

Tips for Best Results:
----------------------
- Keep models low-poly (under 50,000 polygons total) for high performance.
- Use Blender to align the pivots before exporting.
- If you place your models here, the game will automatically hide the procedural meshes and render your custom models instead. If a file is missing, the game falls back to the default cyber styles without crashing.
