# build_nyc_crime.py
# -*- coding: utf-8 -*-
"""
处理NYPD犯罪数据，生成时间序列犯罪热力图数据
从CSV文件读取2014-2024年犯罪数据，转换为GeoParquet和GeoJSON格式
支持按年份分层的犯罪热力图可视化
"""

import os
import pandas as pd
import geopandas as gpd
from datetime import datetime
import numpy as np
from shapely.geometry import Point
import json

# -----------------------------
# 0) 配置
# -----------------------------
# 输入文件
CSV_FILE = "NYPD_Complaint_Data_Historic_20250908.csv"

# 输出文件
OUT_DIR = "out/crime"
OUT_PARQUET = os.path.join(OUT_DIR, "nyc_crime_points.parquet")
OUT_GEOJSON = os.path.join(OUT_DIR, "nyc_crime_points_web.geojson")

# 创建输出目录
os.makedirs(OUT_DIR, exist_ok=True)

# 只处理曼哈顿数据（与其他数据保持一致）
FOCUS_BOROUGH = "MANHATTAN"

# 犯罪类型映射（简化分类）
CRIME_TYPE_MAPPING = {
    'FELONY': 'felony',
    'MISDEMEANOR': 'misdemeanor', 
    'VIOLATION': 'violation'
}

# 颜色映射用于前端渲染
CRIME_COLORS = {
    'felony': '#dc2626',      # 红色 - 重罪
    'misdemeanor': '#ea580c', # 橙色 - 轻罪  
    'violation': '#facc15'    # 黄色 - 违规
}

# 是否对地理坐标进行简化（减少文件大小）
SIMPLIFY_COORDS = True
COORD_PRECISION = 6  # 小数位数

print("开始处理NYC犯罪数据...")

# -----------------------------
# 1) 读取和清洗CSV数据
# -----------------------------
print("读取CSV文件...")
df = pd.read_csv(CSV_FILE, low_memory=False)
print(f"原始数据行数: {len(df):,}")

# 过滤有效的地理坐标
df = df.dropna(subset=['Latitude', 'Longitude'])
df = df[(df['Latitude'] != 0) & (df['Longitude'] != 0)]
print(f"有效地理坐标数据: {len(df):,}")

# 只保留曼哈顿数据
df = df[df['BORO_NM'] == FOCUS_BOROUGH].copy()
print(f"曼哈顿犯罪数据: {len(df):,}")

# -----------------------------
# 2) 时间数据处理
# -----------------------------
print("处理时间数据...")

# 转换日期格式
df['CMPLNT_FR_DT'] = pd.to_datetime(df['CMPLNT_FR_DT'], format='%m/%d/%Y', errors='coerce')
df = df.dropna(subset=['CMPLNT_FR_DT'])

# 提取年份
df['year'] = df['CMPLNT_FR_DT'].dt.year
df['month'] = df['CMPLNT_FR_DT'].dt.month
df['day'] = df['CMPLNT_FR_DT'].dt.day

# 只保留2014-2024年数据
df = df[(df['year'] >= 2014) & (df['year'] <= 2024)]
print(f"2014-2024年数据: {len(df):,}")

# -----------------------------
# 3) 犯罪类型分类
# -----------------------------
print("处理犯罪类型...")

# 映射犯罪等级
df['crime_category'] = df['LAW_CAT_CD'].map(CRIME_TYPE_MAPPING)
df = df.dropna(subset=['crime_category'])

# 添加犯罪描述（简化）
df['crime_desc'] = df['OFNS_DESC'].fillna('UNKNOWN')

print("各年份犯罪数量:")
year_counts = df['year'].value_counts().sort_index()
for year, count in year_counts.items():
    print(f"  {year}: {count:,}")

print("\n犯罪类型分布:")
crime_counts = df['crime_category'].value_counts()
for crime_type, count in crime_counts.items():
    print(f"  {crime_type}: {count:,}")

# -----------------------------
# 4) 创建GeoDataFrame
# -----------------------------
print("创建地理数据...")

# 坐标精度处理
if SIMPLIFY_COORDS:
    df['Longitude'] = df['Longitude'].round(COORD_PRECISION)
    df['Latitude'] = df['Latitude'].round(COORD_PRECISION)

# 创建点几何
geometry = [Point(xy) for xy in zip(df['Longitude'], df['Latitude'])]
gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

# 选择需要的字段
keep_columns = [
    'CMPLNT_NUM', 'year', 'month', 'day',
    'crime_category', 'crime_desc', 
    'ADDR_PCT_CD', 'Latitude', 'Longitude',
    'geometry'
]

gdf = gdf[keep_columns].copy()

# 重命名字段使其更友好
gdf = gdf.rename(columns={
    'CMPLNT_NUM': 'complaint_id',
    'ADDR_PCT_CD': 'precinct',
    'crime_desc': 'description'
})

# -----------------------------
# 5) 输出GeoParquet（用于后端分析）
# -----------------------------
print(f"保存GeoParquet: {OUT_PARQUET}")
gdf.to_parquet(OUT_PARQUET, index=False)

# -----------------------------
# 6) 为Web渲染准备数据
# -----------------------------
print("准备Web渲染数据...")

# 保留完整的犯罪数据，不进行采样
# 为了性能优化，我们将在前端通过图层显示策略来控制渲染

web_features = []
for year in sorted(gdf['year'].unique()):
    year_data = gdf[gdf['year'] == year].copy()
    
    print(f"  {year}: {len(year_data):,} 个犯罪点（完整数据）")
    
    # 转换为GeoJSON特征
    for _, row in year_data.iterrows():
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row['Longitude'], row['Latitude']]
            },
            "properties": {
                "complaint_id": str(row['complaint_id']),
                "year": int(row['year']),
                "month": int(row['month']),
                "day": int(row['day']),
                "crime_category": row['crime_category'],
                "description": str(row['description'])[:100],  # 限制描述长度
                "precinct": str(row['precinct']) if pd.notna(row['precinct']) else '',
                "color": CRIME_COLORS.get(row['crime_category'], '#666666')
            }
        }
        web_features.append(feature)

# -----------------------------
# 7) 输出Web用GeoJSON
# -----------------------------
geojson_data = {
    "type": "FeatureCollection",
    "features": web_features,
    "metadata": {
        "title": "NYC Crime Data (Manhattan)",
        "years": list(range(2014, 2025)),
        "crime_categories": list(CRIME_COLORS.keys()),
        "colors": CRIME_COLORS,
        "total_features": len(web_features)
    }
}

print(f"保存Web GeoJSON: {OUT_GEOJSON}")
with open(OUT_GEOJSON, 'w', encoding='utf-8') as f:
    json.dump(geojson_data, f, separators=(',', ':'))

# -----------------------------
# 8) 生成统计报告
# -----------------------------
print("\n=== 处理完成 ===")
print(f"总犯罪记录数: {len(gdf):,}")
print(f"时间范围: {gdf['year'].min()}-{gdf['year'].max()}")
print(f"GeoParquet文件: {OUT_PARQUET}")
print(f"GeoJSON文件: {OUT_GEOJSON}")

print("\n年度统计:")
for year in sorted(gdf['year'].unique()):
    count = len(gdf[gdf['year'] == year])
    print(f"  {year}: {count:,}")

print("\n犯罪类型统计:")
for category in sorted(gdf['crime_category'].unique()):
    count = len(gdf[gdf['crime_category'] == category])
    color = CRIME_COLORS.get(category, '#666666')
    print(f"  {category}: {count:,} (颜色: {color})")

print("\n✅ 犯罪数据处理完成！")
print("下一步: 使用tippecanoe生成mbtiles瓦片文件")