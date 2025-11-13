#!/usr/bin/env python3
"""
Process NYC Yellow Taxi data for taxi demand prediction task - V2
处理2024年全年数据，生成按天和按小时两种粒度的聚合数据

数据粒度：
1. 按天聚合：用于热力图展示（每个zone每天的总上车/下车数）
2. 按小时聚合：用于详细分析和24小时曲线图（每个zone每天每小时的上车/下车数）
"""

import os
import pandas as pd
import geopandas as gpd
from datetime import datetime
import numpy as np
from shapely.geometry import Point, Polygon
import json
from pathlib import Path
import glob

# -----------------------------
# 0) 配置
# -----------------------------
TAXI_DATA_DIR = "yellow_taxi_data"
TAXI_ZONE_LOOKUP = os.path.join(TAXI_DATA_DIR, "taxi_zone_lookup.csv")
TAXI_ZONE_SHAPEFILE = os.path.join(TAXI_DATA_DIR, "taxi_zones", "taxi_zones.shp")

# 输出文件
OUT_DIR = "out/taxi_demand"
OUT_PARQUET_DAILY = os.path.join(OUT_DIR, "taxi_demand_daily.parquet")
OUT_PARQUET_HOURLY = os.path.join(OUT_DIR, "taxi_demand_hourly.parquet")
OUT_GEOJSON_ZONES = os.path.join(OUT_DIR, "taxi_zones_manhattan_web.geojson")
OUT_HOURLY_DATA = os.path.join(OUT_DIR, "taxi_hourly_by_zone.json")
OUT_STATS = os.path.join(OUT_DIR, "taxi_demand_stats_2024.json")

os.makedirs(OUT_DIR, exist_ok=True)

FOCUS_BOROUGH = "Manhattan"

print("=" * 70)
print("出租车需求预测数据处理 - 2024全年数据")
print("=" * 70)

# -----------------------------
# 1) 读取taxi zone元数据
# -----------------------------
print("\n[1/8] 读取Taxi Zone元数据...")
zone_lookup = pd.read_csv(TAXI_ZONE_LOOKUP)
manhattan_zones = zone_lookup[zone_lookup['Borough'] == FOCUS_BOROUGH].copy()
manhattan_zone_ids = set(manhattan_zones['LocationID'].values)
print(f"  曼哈顿区域: {len(manhattan_zone_ids)} 个zones")

zones_gdf = gpd.read_file(TAXI_ZONE_SHAPEFILE)
zones_gdf = zones_gdf.to_crs('EPSG:4326')
zones_gdf = zones_gdf.merge(zone_lookup, left_on='LocationID', right_on='LocationID', how='left')
manhattan_zones_gdf = zones_gdf[zones_gdf['Borough'] == FOCUS_BOROUGH].copy()
print(f"  曼哈顿zones shapefile: {len(manhattan_zones_gdf)} 个多边形")

# -----------------------------
# 2) 读取全年出租车数据
# -----------------------------
print("\n[2/8] 读取2024年全年出租车数据...")

# 查找所有2024年的parquet文件
parquet_files = sorted(glob.glob(os.path.join(TAXI_DATA_DIR, "yellow_tripdata_2024-*.parquet")))
print(f"  找到 {len(parquet_files)} 个月份的数据文件")

all_data = []
for pf in parquet_files:
    month_name = os.path.basename(pf)
    print(f"  读取: {month_name}")
    df_month = pd.read_parquet(pf)
    
    # 筛选曼哈顿相关行程
    df_month = df_month[
        (df_month['PULocationID'].isin(manhattan_zone_ids)) | 
        (df_month['DOLocationID'].isin(manhattan_zone_ids))
    ].copy()
    
    # 移除无效数据
    df_month = df_month.dropna(subset=['tpep_pickup_datetime', 'tpep_dropoff_datetime', 'PULocationID', 'DOLocationID'])
    
    # 只保留需要的列
    keep_columns = [
        'tpep_pickup_datetime', 'tpep_dropoff_datetime',
        'PULocationID', 'DOLocationID',
        'passenger_count', 'trip_distance', 'fare_amount'
    ]
    df_month = df_month[keep_columns].copy()
    
    all_data.append(df_month)
    print(f"    → {len(df_month):,} 条曼哈顿相关行程")

# 合并所有月份数据
df = pd.concat(all_data, ignore_index=True)
print(f"\n  全年总数据: {len(df):,} 条行程")

# -----------------------------
# 3) 时间特征提取
# -----------------------------
print("\n[3/8] 提取时间特征...")

df['pickup_datetime'] = pd.to_datetime(df['tpep_pickup_datetime'])
df['pickup_date'] = df['pickup_datetime'].dt.date
df['pickup_hour'] = df['pickup_datetime'].dt.hour
df['pickup_month'] = df['pickup_datetime'].dt.month

# 过滤2024年数据
df = df[(df['pickup_datetime'].dt.year == 2024)].copy()
print(f"  2024年数据: {len(df):,} 条")
print(f"  时间范围: {df['pickup_datetime'].min()} 至 {df['pickup_datetime'].max()}")

# -----------------------------
# 4) 按天聚合需求数据（用于热力图）
# -----------------------------
print("\n[4/8] 聚合按天需求数据...")

# 上车需求（按天）
pickup_daily = df.groupby(['pickup_date', 'PULocationID']).agg({
    'tpep_pickup_datetime': 'count',
    'passenger_count': 'sum',
    'trip_distance': 'mean',
    'fare_amount': 'mean'
}).reset_index()
pickup_daily.columns = ['date', 'zone_id', 'pickup_count', 'passenger_sum', 'avg_distance', 'avg_fare']

# 下车需求（按天）
dropoff_daily = df.groupby(['pickup_date', 'DOLocationID']).agg({
    'tpep_dropoff_datetime': 'count'
}).reset_index()
dropoff_daily.columns = ['date', 'zone_id', 'dropoff_count']

# 合并
daily_demand = pickup_daily.merge(dropoff_daily, on=['date', 'zone_id'], how='outer')
daily_demand = daily_demand.fillna(0)
daily_demand = daily_demand[daily_demand['zone_id'].isin(manhattan_zone_ids)].copy()

daily_demand['pickup_count'] = daily_demand['pickup_count'].astype(int)
daily_demand['dropoff_count'] = daily_demand['dropoff_count'].astype(int)
daily_demand['passenger_sum'] = daily_demand['passenger_sum'].astype(int)
daily_demand['total_demand'] = daily_demand['pickup_count'] + daily_demand['dropoff_count']

# 添加日期字符串（方便前端查询）
daily_demand['date_str'] = daily_demand['date'].astype(str)

print(f"  按天聚合数据: {len(daily_demand):,} 条记录")
print(f"  涉及日期: {daily_demand['date'].nunique()} 天")
print(f"  涉及zones: {daily_demand['zone_id'].nunique()} 个")

# -----------------------------
# 5) 按小时聚合需求数据（用于24小时曲线图）
# -----------------------------
print("\n[5/8] 聚合按小时需求数据...")

# 上车需求（按天+小时）
pickup_hourly = df.groupby(['pickup_date', 'pickup_hour', 'PULocationID']).agg({
    'tpep_pickup_datetime': 'count',
    'passenger_count': 'sum'
}).reset_index()
pickup_hourly.columns = ['date', 'hour', 'zone_id', 'pickup_count', 'passenger_sum']

# 下车需求（按天+小时）
dropoff_hourly = df.groupby(['pickup_date', 'pickup_hour', 'DOLocationID']).agg({
    'tpep_dropoff_datetime': 'count'
}).reset_index()
dropoff_hourly.columns = ['date', 'hour', 'zone_id', 'dropoff_count']

# 合并
hourly_demand = pickup_hourly.merge(dropoff_hourly, on=['date', 'hour', 'zone_id'], how='outer')
hourly_demand = hourly_demand.fillna(0)
hourly_demand = hourly_demand[hourly_demand['zone_id'].isin(manhattan_zone_ids)].copy()

hourly_demand['pickup_count'] = hourly_demand['pickup_count'].astype(int)
hourly_demand['dropoff_count'] = hourly_demand['dropoff_count'].astype(int)
hourly_demand['passenger_sum'] = hourly_demand['passenger_sum'].astype(int)
hourly_demand['date_str'] = hourly_demand['date'].astype(str)

print(f"  按小时聚合数据: {len(hourly_demand):,} 条记录")

# -----------------------------
# 6) 保存模型数据（Parquet）
# -----------------------------
print("\n[6/8] 保存模型分析数据...")

# 保存按天数据
daily_demand_with_info = daily_demand.merge(
    manhattan_zones[['LocationID', 'Zone', 'service_zone']], 
    left_on='zone_id', 
    right_on='LocationID',
    how='left'
)
daily_demand_with_info.to_parquet(OUT_PARQUET_DAILY, index=False)
print(f"  ✓ {OUT_PARQUET_DAILY}")

# 保存按小时数据
hourly_demand_with_info = hourly_demand.merge(
    manhattan_zones[['LocationID', 'Zone', 'service_zone']], 
    left_on='zone_id', 
    right_on='LocationID',
    how='left'
)
hourly_demand_with_info.to_parquet(OUT_PARQUET_HOURLY, index=False)
print(f"  ✓ {OUT_PARQUET_HOURLY}")

# -----------------------------
# 7) 生成Web可视化数据
# -----------------------------
print("\n[7/8] 生成Web可视化数据...")

# 7.1) 生成taxi zones GeoJSON（带全年总需求统计）
print("  [7.1] 生成taxi zones多边形...")

zone_total_demand = daily_demand.groupby('zone_id').agg({
    'pickup_count': 'sum',
    'dropoff_count': 'sum',
    'total_demand': 'sum'
}).reset_index()

manhattan_zones_gdf_web = manhattan_zones_gdf.merge(
    zone_total_demand,
    left_on='LocationID',
    right_on='zone_id',
    how='left'
)

manhattan_zones_gdf_web['pickup_count'] = manhattan_zones_gdf_web['pickup_count'].fillna(0).astype(int)
manhattan_zones_gdf_web['dropoff_count'] = manhattan_zones_gdf_web['dropoff_count'].fillna(0).astype(int)
manhattan_zones_gdf_web['total_demand'] = manhattan_zones_gdf_web['total_demand'].fillna(0).astype(int)

# 计算中心点
import warnings
warnings.filterwarnings('ignore')
manhattan_zones_gdf_web['centroid_lon'] = manhattan_zones_gdf_web.geometry.centroid.x
manhattan_zones_gdf_web['centroid_lat'] = manhattan_zones_gdf_web.geometry.centroid.y

zones_web = manhattan_zones_gdf_web[[
    'LocationID', 'Zone', 'Borough', 'service_zone',
    'pickup_count', 'dropoff_count', 'total_demand',
    'centroid_lon', 'centroid_lat', 'geometry'
]].copy()

zones_web.to_file(OUT_GEOJSON_ZONES, driver='GeoJSON')
print(f"  ✓ {OUT_GEOJSON_ZONES}")

# 7.2) 生成按小时数据的JSON（供前端查询）
print("  [7.2] 生成hourly数据JSON...")

# 创建嵌套的数据结构: {zone_id: {date: [24小时的数据]}}
hourly_by_zone = {}

for zone_id in manhattan_zone_ids:
    zone_data = hourly_demand[hourly_demand['zone_id'] == zone_id]
    hourly_by_zone[int(zone_id)] = {}
    
    for date in zone_data['date'].unique():
        date_str = str(date)
        date_data = zone_data[zone_data['date'] == date].sort_values('hour')
        
        # 确保有完整的24小时数据
        hourly_array = []
        for h in range(24):
            hour_row = date_data[date_data['hour'] == h]
            if len(hour_row) > 0:
                hourly_array.append({
                    'hour': h,
                    'pickup': int(hour_row['pickup_count'].iloc[0]),
                    'dropoff': int(hour_row['dropoff_count'].iloc[0]),
                    'passengers': int(hour_row['passenger_sum'].iloc[0])
                })
            else:
                hourly_array.append({
                    'hour': h,
                    'pickup': 0,
                    'dropoff': 0,
                    'passengers': 0
                })
        
        hourly_by_zone[int(zone_id)][date_str] = hourly_array

with open(OUT_HOURLY_DATA, 'w', encoding='utf-8') as f:
    json.dump(hourly_by_zone, f, separators=(',', ':'))
print(f"  ✓ {OUT_HOURLY_DATA}")

# -----------------------------
# 8) 生成统计报告
# -----------------------------
print("\n[8/8] 生成统计报告...")

stats = {
    "summary": {
        "total_trips": int(len(df)),
        "total_passengers": int(df['passenger_count'].sum()),
        "avg_trip_distance_miles": round(float(df['trip_distance'].mean()), 2),
        "avg_fare_amount": round(float(df['fare_amount'].mean()), 2),
        "time_range": {
            "start": str(df['pickup_datetime'].min()),
            "end": str(df['pickup_datetime'].max())
        },
        "zones_count": len(manhattan_zone_ids),
        "total_days": int(daily_demand['date'].nunique()),
        "daily_data_points": len(daily_demand),
        "hourly_data_points": len(hourly_demand)
    },
    "monthly_stats": [],
    "top_zones": zone_total_demand.merge(
        manhattan_zones[['LocationID', 'Zone']], 
        left_on='zone_id', 
        right_on='LocationID'
    ).sort_values('total_demand', ascending=False).head(10)[[
        'zone_id', 'Zone', 'pickup_count', 'dropoff_count', 'total_demand'
    ]].to_dict('records'),
    "date_range": {
        "min": str(daily_demand['date'].min()),
        "max": str(daily_demand['date'].max())
    }
}

# 按月统计
for month in range(1, 13):
    month_data = df[df['pickup_month'] == month]
    if len(month_data) > 0:
        stats['monthly_stats'].append({
            'month': month,
            'trips': int(len(month_data)),
            'avg_daily_trips': int(len(month_data) / 30)
        })

with open(OUT_STATS, 'w', encoding='utf-8') as f:
    json.dump(stats, f, indent=2, ensure_ascii=False)
print(f"  ✓ {OUT_STATS}")

# -----------------------------
# 9) 打印摘要
# -----------------------------
print("\n" + "=" * 70)
print("✅ 处理完成！")
print("=" * 70)
print(f"\n📊 数据摘要:")
print(f"  • 总行程数: {len(df):,}")
print(f"  • 总乘客数: {int(df['passenger_count'].sum()):,}")
print(f"  • 时间跨度: {daily_demand['date'].min()} ~ {daily_demand['date'].max()}")
print(f"  • 覆盖天数: {daily_demand['date'].nunique()} 天")
print(f"  • 曼哈顿zones: {len(manhattan_zone_ids)}")
print(f"  • 按天数据点: {len(daily_demand):,}")
print(f"  • 按小时数据点: {len(hourly_demand):,}")

print(f"\n📂 输出文件:")
print(f"  • {OUT_PARQUET_DAILY}")
print(f"  • {OUT_PARQUET_HOURLY}")
print(f"  • {OUT_GEOJSON_ZONES}")
print(f"  • {OUT_HOURLY_DATA}")
print(f"  • {OUT_STATS}")

print(f"\n🔥 需求最高的5个zones（全年）:")
for _, row in zone_total_demand.merge(
    manhattan_zones[['LocationID', 'Zone']], 
    left_on='zone_id', 
    right_on='LocationID'
).sort_values('total_demand', ascending=False).head(5).iterrows():
    print(f"  {row['Zone']}: {int(row['total_demand']):,} (↑{int(row['pickup_count']):,} ↓{int(row['dropoff_count']):,})")

print("\n📌 下一步:")
print("  1. 使用 tippecanoe 生成 mbtiles")
print("  2. 更新前端页面添加日期选择器")
print("  3. 实现24小时曲线图弹窗")

