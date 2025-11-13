# build_nyc_2024_crime.py
# -*- coding: utf-8 -*-
"""
处理2024年NYPD犯罪数据，生成按周/月分组的时间序列数据
从CSV文件读取2024年犯罪数据，转换为GeoParquet和GeoJSON格式
支持按周或月的犯罪热力图可视化，数据点在适当缩放级别完全显示
"""

import os
import pandas as pd
import geopandas as gpd
from datetime import datetime, timedelta
import numpy as np
from shapely.geometry import Point
import json
import calendar

# -----------------------------
# 0) 配置
# -----------------------------
# 输入文件
CSV_FILE = "NYPD_Complaint_Data_Historic_20250908.csv"

# 输出文件
OUT_DIR = "out/crime"
OUT_PARQUET_2024 = os.path.join(OUT_DIR, "nyc_crime_2024_weekly.parquet")
OUT_GEOJSON_2024 = os.path.join(OUT_DIR, "nyc_crime_2024_weekly_web.geojson")

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

# 时间分组方式：'weekly' 或 'monthly'
TIME_GROUP = 'weekly'  # 可以改为 'monthly'

print("开始处理NYC 2024年犯罪数据...")

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
# 2) 时间数据处理 - 只保留2024年
# -----------------------------
print("处理时间数据...")

# 转换日期格式
df['CMPLNT_FR_DT'] = pd.to_datetime(df['CMPLNT_FR_DT'], format='%m/%d/%Y', errors='coerce')
df = df.dropna(subset=['CMPLNT_FR_DT'])

# 提取年份并只保留2024年数据
df['year'] = df['CMPLNT_FR_DT'].dt.year
df = df[df['year'] == 2024]
print(f"2024年数据: {len(df):,}")

if len(df) == 0:
    print("❌ 没有找到2024年的数据，请检查数据文件")
    exit(1)

# 提取时间组件
df['month'] = df['CMPLNT_FR_DT'].dt.month
df['day'] = df['CMPLNT_FR_DT'].dt.day
df['date'] = df['CMPLNT_FR_DT'].dt.date

# 根据配置添加时间分组
if TIME_GROUP == 'weekly':
    # 计算周数（ISO周）
    df['week'] = df['CMPLNT_FR_DT'].dt.isocalendar().week
    df['week_start'] = df['CMPLNT_FR_DT'].dt.to_period('W').dt.start_time
    df['time_group'] = df['week']
    df['time_group_label'] = df['week_start'].dt.strftime('Week %U (%b %d)')
    time_unit = 'week'
    print("使用周分组模式")
elif TIME_GROUP == 'monthly':
    df['time_group'] = df['month']
    df['time_group_label'] = df['CMPLNT_FR_DT'].dt.strftime('%B 2024')
    time_unit = 'month'
    print("使用月分组模式")

# -----------------------------
# 3) 犯罪类型分类
# -----------------------------
print("处理犯罪类型...")

# 映射犯罪等级
df['crime_category'] = df['LAW_CAT_CD'].map(CRIME_TYPE_MAPPING)
df = df.dropna(subset=['crime_category'])

# 添加犯罪描述（简化）
df['crime_desc'] = df['OFNS_DESC'].fillna('UNKNOWN')

print(f"各{time_unit}犯罪数量:")
time_counts = df['time_group'].value_counts().sort_index()
for time_val, count in time_counts.items():
    if TIME_GROUP == 'weekly':
        label = f"Week {time_val}"
    else:
        label = calendar.month_name[time_val]
    print(f"  {label}: {count:,}")

print(f"\n犯罪类型分布:")
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
    'CMPLNT_NUM', 'year', 'month', 'day', 'date',
    'time_group', 'time_group_label',
    'crime_category', 'crime_desc', 
    'ADDR_PCT_CD', 'Latitude', 'Longitude',
    'geometry'
]

# 如果是周分组，添加周相关字段
if TIME_GROUP == 'weekly':
    keep_columns.extend(['week', 'week_start'])

gdf = gdf[keep_columns].copy()

# 重命名字段使其更友好
rename_dict = {
    'CMPLNT_NUM': 'complaint_id',
    'ADDR_PCT_CD': 'precinct',
    'crime_desc': 'description'
}
gdf = gdf.rename(columns=rename_dict)

# -----------------------------
# 5) 输出GeoParquet（用于后端分析）
# -----------------------------
print(f"保存GeoParquet: {OUT_PARQUET_2024}")
gdf.to_parquet(OUT_PARQUET_2024, index=False)

# -----------------------------
# 6) 为Web渲染准备数据
# -----------------------------
print("准备Web渲染数据...")

# 保留完整的犯罪数据，按时间组分组
web_features = []
time_groups = sorted(gdf['time_group'].unique())

for time_val in time_groups:
    time_data = gdf[gdf['time_group'] == time_val].copy()
    
    if TIME_GROUP == 'weekly':
        label = f"Week {time_val}"
    else:
        label = calendar.month_name[time_val]
    
    print(f"  {label}: {len(time_data):,} 个犯罪点（完整数据）")
    
    # 转换为GeoJSON特征
    for _, row in time_data.iterrows():
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row['Longitude']), float(row['Latitude'])]
            },
            "properties": {
                "complaint_id": str(row['complaint_id']),
                "year": int(row['year']),
                "month": int(row['month']),
                "day": int(row['day']),
                "time_group": int(row['time_group']),
                "time_group_label": str(row['time_group_label']),
                "crime_category": str(row['crime_category']),
                "description": str(row['description'])[:100],  # 限制描述长度
                "precinct": str(row['precinct']) if pd.notna(row['precinct']) else '',
                "color": CRIME_COLORS.get(row['crime_category'], '#666666')
            }
        }
        
        # 如果是周分组，添加周相关属性
        if TIME_GROUP == 'weekly':
            feature["properties"]["week"] = int(row['week'])
            if pd.notna(row['week_start']):
                feature["properties"]["week_start"] = row['week_start'].strftime('%Y-%m-%d')
        
        web_features.append(feature)

# -----------------------------
# 7) 生成时间组统计信息
# -----------------------------
time_stats = {}
for time_val in time_groups:
    time_data = gdf[gdf['time_group'] == time_val]
    stats = {
        'total': int(len(time_data)),
        'felony': int(len(time_data[time_data['crime_category'] == 'felony'])),
        'misdemeanor': int(len(time_data[time_data['crime_category'] == 'misdemeanor'])),
        'violation': int(len(time_data[time_data['crime_category'] == 'violation']))
    }
    time_stats[str(int(time_val))] = stats

# -----------------------------
# 8) 输出Web用GeoJSON
# -----------------------------
geojson_data = {
    "type": "FeatureCollection",
    "features": web_features,
    "metadata": {
        "title": f"NYC 2024 Crime Data (Manhattan) - {TIME_GROUP.title()} View",
        "year": 2024,
        "time_grouping": TIME_GROUP,
        "time_groups": [int(x) for x in time_groups],
        "time_stats": time_stats,
        "crime_categories": list(CRIME_COLORS.keys()),
        "colors": CRIME_COLORS,
        "total_features": len(web_features),
        "rendering_strategy": "complete_points_with_zoom_threshold"
    }
}

print(f"保存Web GeoJSON: {OUT_GEOJSON_2024}")
with open(OUT_GEOJSON_2024, 'w', encoding='utf-8') as f:
    json.dump(geojson_data, f, separators=(',', ':'))

# -----------------------------
# 9) 生成统计报告
# -----------------------------
print("\n=== 2024年犯罪数据处理完成 ===")
print(f"总犯罪记录数: {len(gdf):,}")
print(f"时间分组方式: {TIME_GROUP}")
print(f"GeoParquet文件: {OUT_PARQUET_2024}")
print(f"GeoJSON文件: {OUT_GEOJSON_2024}")

print(f"\n{time_unit.title()}统计:")
for time_val in time_groups:
    stats = time_stats[str(time_val)]
    if TIME_GROUP == 'weekly':
        label = f"Week {time_val}"
    else:
        label = calendar.month_name[time_val]
    print(f"  {label}: {stats['total']:,} (重罪: {stats['felony']}, 轻罪: {stats['misdemeanor']}, 违规: {stats['violation']})")

print("\n犯罪类型总计:")
for category in sorted(gdf['crime_category'].unique()):
    count = len(gdf[gdf['crime_category'] == category])
    color = CRIME_COLORS.get(category, '#666666')
    print(f"  {category}: {count:,} (颜色: {color})")

print(f"\n渲染策略说明:")
print(f"- 数据点在缩放级别10+完全显示（不进行采样）")
print(f"- 热力图在缩放级别8-15显示")
print(f"- 中等缩放级别时热力图和数据点可同时显示")
print(f"- 每个{time_unit}的完整数据都包含在文件中")

print("\n✅ 2024年犯罪数据处理完成！")
print("下一步: 使用tippecanoe生成2024年专用的mbtiles瓦片文件")
