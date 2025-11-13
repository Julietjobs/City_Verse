#!/usr/bin/env python3
"""
创建曼哈顿区域的网格标记点，用于卫星图和街景图查看
每10-20米放置一个标记点
"""

import json
import numpy as np
from shapely.geometry import Point, Polygon
import geopandas as gpd
from pyproj import Transformer
import os

def create_manhattan_grid(spacing_meters=15):
    """
    创建曼哈顿区域的网格标记点
    
    Args:
        spacing_meters: 网格间距（米）
    
    Returns:
        list: 包含经纬度坐标的网格点列表
    """
    
    # 曼哈顿大致边界 (WGS84)
    # 这些是曼哈顿岛的近似边界坐标
    manhattan_bounds = [
        [-74.0479, 40.6829],  # 西南角
        [-73.9067, 40.6829],  # 东南角  
        [-73.9067, 40.8820],  # 东北角
        [-74.0479, 40.8820],  # 西北角
        [-74.0479, 40.6829]   # 闭合多边形
    ]
    
    # 更精确的曼哈顿边界（主要岛屿轮廓）
    manhattan_detailed_bounds = [
        [-74.0479, 40.6829], [-74.0300, 40.7000], [-74.0200, 40.7100],
        [-74.0150, 40.7200], [-74.0100, 40.7300], [-74.0080, 40.7400],
        [-74.0070, 40.7500], [-74.0060, 40.7600], [-74.0050, 40.7700],
        [-74.0040, 40.7800], [-74.0030, 40.7900], [-74.0020, 40.8000],
        [-74.0010, 40.8100], [-74.0000, 40.8200], [-73.9990, 40.8300],
        [-73.9980, 40.8400], [-73.9970, 40.8500], [-73.9960, 40.8600],
        [-73.9950, 40.8700], [-73.9940, 40.8800], [-73.9930, 40.8820],
        [-73.9200, 40.8820], [-73.9150, 40.8800], [-73.9100, 40.8700],
        [-73.9067, 40.8600], [-73.9067, 40.8500], [-73.9070, 40.8400],
        [-73.9080, 40.8300], [-73.9090, 40.8200], [-73.9100, 40.8100],
        [-73.9110, 40.8000], [-73.9120, 40.7900], [-73.9130, 40.7800],
        [-73.9140, 40.7700], [-73.9150, 40.7600], [-73.9160, 40.7500],
        [-73.9170, 40.7400], [-73.9180, 40.7300], [-73.9190, 40.7200],
        [-73.9200, 40.7100], [-73.9210, 40.7000], [-73.9220, 40.6900],
        [-73.9230, 40.6829], [-74.0479, 40.6829]
    ]
    
    # 创建多边形
    manhattan_polygon = Polygon(manhattan_detailed_bounds)
    
    # 获取边界框
    minx, miny, maxx, maxy = manhattan_polygon.bounds
    
    # 创建坐标转换器 (WGS84 -> UTM Zone 18N for NYC)
    transformer_to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    transformer_to_wgs84 = Transformer.from_crs("EPSG:32618", "EPSG:4326", always_xy=True)
    
    # 将边界转换到UTM坐标系
    utm_bounds = []
    for lon, lat in manhattan_detailed_bounds:
        x, y = transformer_to_utm.transform(lon, lat)
        utm_bounds.append([x, y])
    
    utm_polygon = Polygon(utm_bounds)
    utm_minx, utm_miny, utm_maxx, utm_maxy = utm_polygon.bounds
    
    # 生成UTM网格点
    x_coords = np.arange(utm_minx, utm_maxx, spacing_meters)
    y_coords = np.arange(utm_miny, utm_maxy, spacing_meters)
    
    grid_points = []
    total_points = len(x_coords) * len(y_coords)
    processed = 0
    
    print(f"🗺️ 生成网格点...")
    print(f"   网格间距: {spacing_meters}米")
    print(f"   预计点数: {total_points:,}")
    
    for x in x_coords:
        for y in y_coords:
            processed += 1
            if processed % 1000 == 0:
                print(f"   已处理: {processed:,}/{total_points:,} ({processed/total_points*100:.1f}%)")
            
            # 检查点是否在曼哈顿多边形内
            utm_point = Point(x, y)
            if utm_polygon.contains(utm_point):
                # 转换回WGS84
                lon, lat = transformer_to_wgs84.transform(x, y)
                grid_points.append({
                    'lon': round(lon, 6),
                    'lat': round(lat, 6),
                    'id': len(grid_points)
                })
    
    print(f"✅ 完成！生成了 {len(grid_points):,} 个网格点")
    return grid_points

def create_geojson(grid_points):
    """创建GeoJSON格式的网格点数据"""
    features = []
    
    for point in grid_points:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [point['lon'], point['lat']]
            },
            "properties": {
                "id": point['id'],
                "type": "image_marker",
                "title": f"Images at {point['lat']:.4f}, {point['lon']:.4f}"
            }
        }
        features.append(feature)
    
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    
    return geojson

def main():
    print("🏙️ 创建曼哈顿卫星图和街景图网格标记点")
    
    # 创建输出目录
    output_dir = "../web/data"
    os.makedirs(output_dir, exist_ok=True)
    
    # 生成网格点（15米间距）
    grid_points = create_manhattan_grid(spacing_meters=15)
    
    # 创建GeoJSON
    geojson_data = create_geojson(grid_points)
    
    # 保存GeoJSON文件
    geojson_path = os.path.join(output_dir, "image_grid_markers.geojson")
    with open(geojson_path, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, indent=2, ensure_ascii=False)
    
    print(f"💾 已保存GeoJSON文件: {geojson_path}")
    
    # 创建简化版本（用于性能优化，每30米一个点）
    grid_points_simple = create_manhattan_grid(spacing_meters=30)
    geojson_simple = create_geojson(grid_points_simple)
    
    geojson_simple_path = os.path.join(output_dir, "image_grid_markers_simple.geojson")
    with open(geojson_simple_path, 'w', encoding='utf-8') as f:
        json.dump(geojson_simple, f, indent=2, ensure_ascii=False)
    
    print(f"💾 已保存简化版GeoJSON文件: {geojson_simple_path}")
    
    # 统计信息
    print(f"\n📊 统计信息:")
    print(f"   标准网格 (15m): {len(grid_points):,} 个点")
    print(f"   简化网格 (30m): {len(grid_points_simple):,} 个点")
    print(f"   覆盖区域: 曼哈顿岛")
    
    # 创建配置文件
    config = {
        "grid_spacing_meters": {
            "standard": 15,
            "simple": 30
        },
        "total_points": {
            "standard": len(grid_points),
            "simple": len(grid_points_simple)
        },
        "coverage_area": "Manhattan Island, NYC",
        "coordinate_system": "WGS84",
        "files": {
            "standard": "image_grid_markers.geojson",
            "simple": "image_grid_markers_simple.geojson"
        }
    }
    
    config_path = os.path.join(output_dir, "image_grid_config.json")
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    
    print(f"⚙️ 已保存配置文件: {config_path}")
    print("\n🎉 网格标记点创建完成！")

if __name__ == "__main__":
    main()

