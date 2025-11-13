#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import math
import os
from typing import Optional, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
from pyrosm import OSM
from shapely.geometry import Polygon, MultiPolygon
from shapely.geometry.base import BaseGeometry

# ------------- Utils ------------- #

def parse_poly(poly_path: str) -> Optional[BaseGeometry]:
    """
    解析 OSM .poly 文件为 shapely (Multi)Polygon。
    .poly 是纯文本格式：多环坐标，'END' 结尾。
    """
    if not poly_path or not os.path.exists(poly_path):
        return None

    polys = []
    with open(poly_path, "r", encoding="utf-8") as f:
        lines = [ln.strip() for ln in f.readlines()]

    ring = []
    rings = []
    in_ring = False
    for ln in lines:
        if ln == "END":
            if in_ring:
                if ring:
                    rings.append(ring)
                ring = []
                in_ring = False
            else:
                break
            continue
        # 开始一个 ring 的标题（忽略名称）
        if not in_ring and ln and not ln[0].isdigit() and not ln[0] == '-':
            in_ring = True
            if ring:
                rings.append(ring)
                ring = []
            continue
        # 读坐标
        if in_ring and ln:
            parts = ln.split()
            if len(parts) >= 2:
                x, y = float(parts[0]), float(parts[1])
                ring.append((x, y))

    # .poly 可能包含多个 ring，第一为外环，之后为洞；也可能多个多边形
    # 简化处理：将所有 rings 当作单独 polygon 的外环（常见是一个外环）
    # 若需要严格洞处理，可增强解析逻辑（此处已足够多数行政边界）
    for r in (rings or []):
        if len(r) >= 3:
            polys.append(Polygon(r))

    if not polys:
        return None
    if len(polys) == 1:
        return polys[0]
    return MultiPolygon(polys)

def coalesce_series_to_int(s, default=None):
    try:
        return s.astype("Int64")
    except Exception:
        return pd.Series([default] * len(s), dtype="Int64")

def normalize_oneway(val) -> Optional[bool]:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    v = str(val).strip().lower()
    if v in ("yes", "true", "1"):
        return True
    if v in ("no", "false", "0"):
        return False
    if v == "-1":  # OSM 中表示与几何方向相反的单行
        return True
    return None  # 未知

def normalize_lanes(val) -> Optional[int]:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    v = str(val).split(";")[0].strip()
    try:
        n = int(v)
        if n <= 0 or n > 12:
            return None
        return n
    except Exception:
        return None

def parse_maxspeed(val) -> Optional[float]:
    """
    解析 OSM maxspeed: 支持 '50', '50 km/h', '30 mph', 'signals', 'walk' 等。
    返回 km/h；无法解析返回 None。
    """
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    v = str(val).lower().strip()
    # 常见非法值
    if any(k in v for k in ["signals", "walk", "none", "variable"]):
        return None
    v = v.replace("kph", "km/h")
    # mph
    if "mph" in v:
        try:
            num = float(v.replace("mph", "").strip())
            return num * 1.609344
        except Exception:
            return None
    # km/h
    if "km/h" in v:
        try:
            num = float(v.replace("km/h", "").strip())
            return num
        except Exception:
            return None
    # 纯数字，默认 km/h
    try:
        return float(v)
    except Exception:
        return None

def estimate_speed_kmh(row) -> float:
    """
    对缺失 maxspeed 的道路估计一个保守限速（km/h），按 highway 类型猜测。
    可根据本地规则调整。
    """
    if not pd.isna(row.get("maxspeed_kmh")):
        return row["maxspeed_kmh"]

    hwy = str(row.get("highway", "")).lower()
    # 粗略规则（NYC 可再校准）
    if hwy in ("motorway", "trunk"):
        return 80.0
    if hwy in ("primary", "secondary"):
        return 50.0
    if hwy in ("tertiary", "unclassified"):
        return 40.0
    if hwy in ("residential", "living_street", "service"):
        return 30.0
    return 40.0

def simplify_for_web(gdf: gpd.GeoDataFrame, tolerance_m: float, crs_metric_epsg: int) -> gpd.GeoDataFrame:
    """将几何投影到米制 CRS，按 tolerance 简化，再投回 WGS84。"""
    if tolerance_m <= 0:
        return gdf
    tmp = gdf.to_crs(crs_metric_epsg)
    tmp["geometry"] = tmp.geometry.simplify(tolerance_m, preserve_topology=True)
    return tmp.to_crs(4326)

# ------------- Core Extractors ------------- #

def extract_roads(osm: OSM, clip_geom: Optional[BaseGeometry], utm_epsg: int,
                  web_tolerance: Optional[float]) -> Tuple[gpd.GeoDataFrame, Optional[gpd.GeoDataFrame]]:
    # driving network（edges）
    edges = osm.get_network(network_type="driving", nodes=False)
    if edges is None or edges.empty:
        raise RuntimeError("未从 PBF 中提取到驾驶道路（edges）。")

    # 可选几何裁剪（与 osmium extract 的“拓扑抽取”互补，真正切断越界几何）
    if clip_geom is not None:
        edges = gpd.clip(edges, clip_geom)

    # 选择/重命名常用字段
    wanted = [
        "id", "u", "v", "highway", "name", "maxspeed", "oneway", "lanes",
        "bridge", "tunnel", "junction", "service", "ref",
        "surface", "sidewalk", "cycleway", "access",
        "geometry"
    ]
    keep_cols = [c for c in wanted if c in edges.columns] + (["geometry"] if "geometry" not in wanted else [])
    edges = edges[keep_cols].copy()

    # 规范化字段
    edges["oneway"] = edges["oneway"].apply(normalize_oneway) if "oneway" in edges.columns else None
    edges["lanes"] = edges["lanes"].apply(normalize_lanes) if "lanes" in edges.columns else None
    edges["maxspeed_kmh"] = edges["maxspeed"].apply(parse_maxspeed) if "maxspeed" in edges.columns else None
    edges["maxspeed_kmh"] = edges.apply(estimate_speed_kmh, axis=1)

    # 长度（米）在 UTM 下计算
    m = edges.to_crs(utm_epsg)
    edges["length_m"] = m.geometry.length

    # 估算自由流旅行时间（秒）
    # v(km/h) -> m/s: v * 1000/3600
    edges["speed_mps"] = edges["maxspeed_kmh"] * (1000.0 / 3600.0)
    edges["ff_time_s"] = edges["length_m"] / edges["speed_mps"]
    edges.loc[~np.isfinite(edges["ff_time_s"]), "ff_time_s"] = np.nan

    # 回到 WGS84 存储
    edges = edges.to_crs(4326)

    # Web 简化版本
    edges_web = None
    if web_tolerance and web_tolerance > 0:
        edges_web = simplify_for_web(edges[["id", "highway", "name", "geometry"]].copy(),
                                     web_tolerance, utm_epsg)

    return edges, edges_web

# def extract_nodes(osm: OSM, clip_geom: Optional[BaseGeometry]) -> Optional[gpd.GeoDataFrame]:
#     nodes = osm.get_network(network_type="driving", nodes=True)
#     if nodes is None or nodes.empty:
#         return None
#     if clip_geom is not None:
#         nodes = gpd.clip(nodes, clip_geom)
#     # 只保留 id + geometry
#     keep = [c for c in ["id", "geometry"] if c in nodes.columns]
#     nodes = nodes[keep].copy().to_crs(4326)
#     return nodes

def extract_nodes(osm: OSM, clip_geom: Optional[BaseGeometry]) -> Optional[gpd.GeoDataFrame]:
    res = osm.get_network(network_type="driving", nodes=True)
    if res is None:
        return None
    
    # pyrosm 返回 (nodes, edges)
    if isinstance(res, tuple):
        nodes, _ = res
    else:
        nodes = res

    if nodes is None or nodes.empty:
        return None

    if clip_geom is not None:
        nodes = gpd.clip(nodes, clip_geom)

    keep = [c for c in ["id", "geometry"] if c in nodes.columns]
    nodes = nodes[keep].copy().to_crs(4326)
    return nodes


def extract_buildings(osm: OSM, clip_geom: Optional[BaseGeometry], utm_epsg: int,
                      web_tolerance: Optional[float]) -> Tuple[Optional[gpd.GeoDataFrame], Optional[gpd.GeoDataFrame]]:
    gdf = osm.get_data_by_custom_criteria(
        custom_filter={"building": True},
        filter_type="keep",
        keep_nodes=False, keep_ways=True, keep_relations=True
    )
    if gdf is None or gdf.empty:
        return None, None
    if clip_geom is not None:
        gdf = gpd.clip(gdf, clip_geom)
    keep = [c for c in ["id", "building", "name", "geometry"] if c in gdf.columns]
    gdf = gdf[keep].copy()

    # 面积（平方米）
    m = gdf.to_crs(utm_epsg)
    gdf["area_m2"] = m.geometry.area
    gdf = gdf.to_crs(4326)

    gdf_web = None
    if web_tolerance and web_tolerance > 0:
        gdf_web = simplify_for_web(gdf[["id", "building", "name", "geometry"]].copy(),
                                   web_tolerance, utm_epsg)
    return gdf, gdf_web

def extract_traffic_signals(osm: OSM, clip_geom: Optional[BaseGeometry]) -> Optional[gpd.GeoDataFrame]:
    # OSM 上 traffic_signals 通常为节点（highway=traffic_signals）
    pois = osm.get_pois(custom_filter={"highway": ["traffic_signals"]})
    if pois is None or pois.empty:
        return None
    if clip_geom is not None:
        pois = gpd.clip(pois, clip_geom)
    keep = [c for c in ["id", "highway", "geometry"] if c in pois.columns]
    pois = pois[keep].copy().to_crs(4326)
    return pois

# ------------- Main ------------- #

def main():
    parser = argparse.ArgumentParser(
        description="Convert clipped .osm.pbf to GeoParquet (roads/nodes/optional layers), "
                    "with field cleaning & metrics for simulation/navigation/web."
    )
    parser.add_argument("--pbf", required=True, help="Input .osm.pbf (建议已用 poly 抽到目标城市/分区)")
    parser.add_argument("--poly", default=None, help="Optional .poly for extra geometric clip")
    parser.add_argument("--outdir", required=True, help="Output directory")
    parser.add_argument("--city-crs-epsg", type=int, default=32618,
                        help="Metric CRS EPSG for length/area (e.g., NYC≈32618)")
    parser.add_argument("--keep-buildings", action="store_true", help="Extract buildings")
    parser.add_argument("--keep-poi", action="store_true", help="(示例位) Extract POI（可扩展）")
    parser.add_argument("--keep-traffic-signals", action="store_true", help="Extract traffic signals")
    parser.add_argument("--web-simplify-tolerance", type=float, default=0.0,
                        help="Simplification tolerance (meters) for web-ready layers; 0=skip")

    args = parser.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    clip_geom = parse_poly(args.poly) if args.poly else None

    print(f"[INFO] Reading PBF: {args.pbf}")
    osm = OSM(args.pbf)

    # Roads
    print("[INFO] Extracting driving roads...")
    roads, roads_web = extract_roads(osm, clip_geom, args.city_crs_epsg, args.web_simplify_tolerance)
    # 统一字段顺序（适合你的平台）
    cols_order = [
        "id", "highway", "name", "oneway", "lanes",
        "maxspeed_kmh", "speed_mps", "length_m", "ff_time_s",
        "bridge", "tunnel", "junction", "service", "ref",
        "surface", "sidewalk", "cycleway", "access",
        "geometry"
    ]
    roads = roads[[c for c in cols_order if c in roads.columns]]
    roads.to_parquet(os.path.join(args.outdir, "roads.parquet"), index=False)
    if roads_web is not None and not roads_web.empty:
        roads_web.to_parquet(os.path.join(args.outdir, "roads_web.parquet"), index=False)

    # Road nodes (optional but useful)
    print("[INFO] Extracting road nodes...")
    nodes = extract_nodes(osm, clip_geom)
    if nodes is not None and not nodes.empty:
        nodes.to_parquet(os.path.join(args.outdir, "road_nodes.parquet"), index=False)

    # Buildings (optional)
    if args.keep_buildings:
        print("[INFO] Extracting buildings...")
        buildings, buildings_web = extract_buildings(osm, clip_geom, args.city_crs_epsg, args.web_simplify_tolerance)
        if buildings is not None and not buildings.empty:
            buildings.to_parquet(os.path.join(args.outdir, "buildings.parquet"), index=False)
        if buildings_web is not None and not buildings_web.empty:
            buildings_web.to_parquet(os.path.join(args.outdir, "buildings_web.parquet"), index=False)

    # Traffic signals (optional)
    if args.keep_traffic_signals:
        print("[INFO] Extracting traffic signals...")
        ts = extract_traffic_signals(osm, clip_geom)
        if ts is not None and not ts.empty:
            ts.to_parquet(os.path.join(args.outdir, "traffic_signals.parquet"), index=False)

    # （扩展TODO）POI / landuse / waterways 等
    # if args.keep_poi: ...

    print("[OK] Done. GeoParquet written to:", os.path.abspath(args.outdir))
    print("      roads.parquet / road_nodes.parquet / buildings.parquet / traffic_signals.parquet (按需)")

    # 提示：若需 MBTiles（矢量瓦片），推荐用 tippecanoe：
    print("\n[HINT] 生成 MBTiles 示例（需安装 tippecanoe）：")
    print("  tippecanoe -o nyc.mbtiles -zg --read-parallel --drop-densest-as-needed \\")
    print("    -l roads:roads.geojson -l buildings:buildings.geojson")
    print("  # 先用 GeoPandas 将 parquet 导成 GeoJSON：")
    print("  python -c \"import geopandas as gpd; gpd.read_parquet('out/roads.parquet').to_file('roads.geojson', driver='GeoJSON')\"")

if __name__ == "__main__":
    main()
