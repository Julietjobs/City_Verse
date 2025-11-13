# CityVerse 



## Deployment & Usage

### 1. Start the Tile Server

Make sure **Docker** is running.

```bash
cd CityPack_NY_v0
docker run --rm -it -p 8080:8080 \
  -v "$(pwd)/web/tiles:/data" \
  maptiler/tileserver-gl -p 8080 -c /data/config.json
```

### 2. Start the Frontend Server

```bash
cd web
python -m http.server 8000
```

Access the frontend at:

👉 **http://localhost:8000/**

Use the panel on the right to toggle data layers and visualize them on the map.



![image-20251113170657193](./imgs/image-20251113170657193.png)







------

## Simulation Replay

To run a trajectory & traffic signal replay:

1. Visit **http://localhost:8000/**
2. Enable the layer **“🚦 Traffic Flow Control”**
3. Wait for the road network to finish loading
4. Upload a replay file (`replay.txt`)
    Example: `sim/CityFlow/examples/replay_manhattan/log.txt`
5. Use the replay panel or keyboard shortcuts to control playback



![image-20251113171055143](.\imgs\image-20251113171055143.png)



------

## Image Viewer Mode

The image viewer supports displaying **satellite images** and **street-level photos** at any clicked point on the map.

##### Supported Sources

- **Satellite imagery**: ESRI World Imagery (no configuration required)
- **Street-level imagery**: Mapillary API (requires token)

### 1. Mapillary API Setup:

1. Register a developer account
    https://www.mapillary.com/developer
2. Create an app and obtain your **access token**
3. Open `satellite_streetview_api.py` and update:

```python
# Line 25
self.mapillary_token = "YOUR_MAPILLARY_ACCESS_TOKEN_HERE Start with 'MLY|' "
```

------

### 2. Start the Image Service

```bash
python simple_image_server.py 8081
```

After launching the server:

1. Enable **Image Viewer Mode** in the frontend
2. Click on any point on the map
3. Satellite and street-view images for that location will be displayed

![image-20251113171301508](.\imgs\image-20251113171301508.png)