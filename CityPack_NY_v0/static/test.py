from pyrosm import OSM
import geopandas as gpd
from shapely.geometry import LineString, Point, Polygon
import pyarrow as pa
import os
import pyarrow.parquet as pq

# 1) 读入裁剪后的 PBF（nyc.osm.pbf）
osm = OSM(os.path.join(os.path.dirname(__file__), "manh.osm.pbf"))

# 2) 提取道路（行车网络）
# network_type 可选: "driving", "walking", "cycling", "driving+service"
edges = osm.get_network(network_type="driving", nodes=False)  # GeoDataFrame, geometry=LineString
# 常用字段清洗与挑选
edge_cols = [
    "id", "geometry", "length",   # 基础
    "highway", "name", "lanes", "maxspeed", "oneway",   # 交通建模必需
    "bridge", "tunnel", "junction", "service", "ref",   # 补充交通结构
    "surface", "sidewalk", "cycleway"   # 扩展到多模态/可视化时很有用
]
edges = edges[[c for c in edge_cols if c in edges.columns]].copy()

# 2.1 计算长度（米）——投影到 UTM 做精确长度，然后再转回 WGS84 存储
edges_utm = edges.to_crs(32618)  # NYC 近似 UTM Zone 18N（EPSG:32618），也常用 32617/32618/32619 视范围而定
edges["length_m"] = edges_utm.geometry.length

# 3) 提取节点（可选 —— 导航/拓扑用）
nodes = osm.get_network(network_type="driving", nodes=True)
if nodes is not None:
    node_cols = ["id", "geometry"]
    nodes = nodes[[c for c in node_cols if c in nodes.columns]].copy()

# 4) 提取建筑（面要素）
buildings = osm.get_data_by_custom_criteria(
    custom_filter={"building": True},
    filter_type="keep",
    keep_nodes=False, keep_ways=True, keep_relations=True
)
if buildings is not None and "geometry" in buildings:
    # 保留常见字段
    b_cols = ["id", "building", "name", "geometry"]
    buildings = buildings[[c for c in b_cols if c in buildings.columns]].copy()

# 5) 统一 CRS 存储为 WGS84（GeoParquet 推荐）
edges = edges.to_crs(4326)
if nodes is not None: nodes = nodes.to_crs(4326)
if buildings is not None: buildings = buildings.to_crs(4326)

# 6) 写入 GeoParquet（PyArrow 元数据里会自动写入 GeoParquet 元信息）
edges.to_parquet("edges_roads.parquet", index=False)
if nodes is not None: nodes.to_parquet("nodes_roads.parquet", index=False)
if buildings is not None: buildings.to_parquet("buildings.parquet", index=False)
