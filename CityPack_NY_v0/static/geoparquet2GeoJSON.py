import geopandas as gpd
import os

# 只用 *_web.parquet 更轻，若没有就用对应的非 web 版本
layers = [
    (os.path.join(os.path.dirname(__file__), "out/roads_web.parquet"), "CityPack_NY_v0/web/data/GeoJSON/roads_web.geojson"),
    (os.path.join(os.path.dirname(__file__), "out/buildings_web.parquet"), "CityPack_NY_v0/web/data/GeoJSON/buildings_web.geojson"),
    (os.path.join(os.path.dirname(__file__), "out/traffic_signals.parquet"), "CityPack_NY_v0/web/data/GeoJSON/traffic_signals.geojson"),
]
for src, dst in layers:
    try:
        gdf = gpd.read_parquet(src)
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
        gdf.to_file(dst, driver="GeoJSON")
        print(f"Wrote {dst}, {len(gdf)} features")
    except Exception as e:
        print(f"Skip {src}: {e}")