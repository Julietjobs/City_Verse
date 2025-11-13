# build_nyc_tract_pop_density.py
# -*- coding: utf-8 -*-
"""
从 TIGER/Line Tract 边界 + ACS 人口表，生成 NYC 人口总数与人口密度图层
输出: GeoParquet 与 Web 用 GeoJSON（已简化）
"""

import os
import json
import requests
import pandas as pd
import geopandas as gpd

# -----------------------------
# 0) 配置
# -----------------------------
# 你的 shapefile 主文件路径（.shp）
SHAPEFILE_PATH = r"CityPack_NY_v0/static/Census_Track_shapefile/2023/tl_2023_36_tract.shp"   # 改成你的实际路径

# 输出文件
OUT_PARQUET = r"CityPack_NY_v0/static/out/nyc_tracts_pop.parquet"
OUT_GEOJSON = r"CityPack_NY_v0/static/out/nyc_tracts_pop_web.geojson"

# 选择 ACS 年份与表（B01003_001E = 总人口）
ACS_YEAR = 2023                 # 建议用 2023（2019-2023 五年期，2024 年发布）
ACS_DATASET = "acs/acs5"
ACS_VARS = ["B01003_001E", "NAME"]  # 可按需再加字段

# 纽约州与五区 county FIPS
STATE_FIPS = "36"
NYC_COUNTIES = {"061"}  # New York
# NYC_COUNTIES = {"005","047","061","081","085"}  # Bronx, Kings, New York, Queens, Richmond

# 目标投影（用于精确面积计算）：UTM 18N 适合 NYC
AREA_EPSG = 32618

# GeoJSON 输出是否做简化（大幅减小前端负载）
DO_SIMPLIFY = True
SIMPLIFY_TOLERANCE_M = 8.0   # 8 米左右，一般效果不错；按需调整

# 是否只保留渲染需要的字段（更小）
KEEP_COLUMNS = ["GEOID","NAME","COUNTYFP","population","area_km2","density_km2"]

# 可选：环境变量中的 Census API Key（强烈建议设置，提高速率与稳定性）
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", None)


# -----------------------------
# 1) 读取 Tract 边界 & 只保留 NYC 五区
# -----------------------------
print("读取 shapefile ...")
gdf = gpd.read_file(SHAPEFILE_PATH)

# 容错：常见字段名
# TIGER/Line tract 一般有 GEOID、COUNTYFP、NAME 等
for col in ["GEOID","COUNTYFP"]:
    if col not in gdf.columns:
        raise ValueError(f"在 shapefile 中没有找到必须字段: {col}")

# 只保留 NYC country
gdf = gdf[gdf["COUNTYFP"].astype(str).isin(NYC_COUNTIES)].copy()

# 统一 GEOID 为字符串
gdf["GEOID"] = gdf["GEOID"].astype(str).str.zfill(11)

print(f"NYC tract 边界数: {len(gdf)}")


# -----------------------------
# 2) 拉取 ACS tract 级人口数据
#    为减少数据量，这里按 county 分批请求
# -----------------------------
def fetch_acs_tract_population(state_fips, county_fips, year, dataset, vars_list, api_key=None):
    base = f"https://api.census.gov/data/{year}/{dataset}"
    # 例如: get=B01003_001E,NAME&for=tract:*&in=state:36+county:061
    params = {
        "get": ",".join(vars_list + ["GEO_ID"]),  # 带上 GEO_ID 便于核对
        "for": "tract:*",
        "in": f"state:{state_fips} county:{county_fips}",
    }
    if api_key:
        params["key"] = api_key

    r = requests.get(base, params=params, timeout=60)
    r.raise_for_status()
    arr = r.json()
    cols = arr[0]
    rows = arr[1:]
    df = pd.DataFrame(rows, columns=cols)

    # 标准化 GEOID（GEOID = state(2)+county(3)+tract(6)）
    df["state"] = df["state"].astype(str).str.zfill(2)
    df["county"] = df["county"].astype(str).str.zfill(3)
    df["tract"]  = df["tract"].astype(str).str.zfill(6)
    df["GEOID"]  = df["state"] + df["county"] + df["tract"]

    # 重命名人口字段
    if "B01003_001E" in df.columns:
        df["population"] = pd.to_numeric(df["B01003_001E"], errors="coerce")
    else:
        raise ValueError("返回结果未包含 B01003_001E（总人口）")

    return df[["GEOID","population","NAME","state","county","tract"]]


print("从 ACS API 拉取 manhattan 人口 ...")
acs_list = []
for cfp in sorted(NYC_COUNTIES):
    acs_list.append(
        fetch_acs_tract_population(
            STATE_FIPS, cfp, ACS_YEAR, ACS_DATASET, ACS_VARS, CENSUS_API_KEY
        )
    )
acs_df = pd.concat(acs_list, ignore_index=True)
print(f"ACS 记录数: {len(acs_df)}")


# -----------------------------
# 3) Join 边界与 ACS 人口
# -----------------------------
print("Join shapefile & ACS ...")
g = gdf.merge(acs_df[["GEOID","population","NAME"]], on="GEOID", how="left")

missing = g["population"].isna().sum()
if missing:
    print(f"警告: 有 {missing} 个 tract 没匹配到人口（多为水域/无居住区或边界版本差异），其人口记为 0")
    g["population"] = g["population"].fillna(0)

# -----------------------------
# 4) 计算面积与人口密度
# -----------------------------
print("计算面积与人口密度 ...")
g_area = g.to_crs(epsg=AREA_EPSG)
g["area_m2"]   = g_area.geometry.area
g["area_km2"]  = g["area_m2"] / 1_000_000.0

# 避免除零
g.loc[g["area_km2"] <= 0, "area_km2"] = None
g["density_km2"] = (g["population"] / g["area_km2"]).round(2)

# 只留必要字段（更小）
if KEEP_COLUMNS:
    keep = [c for c in KEEP_COLUMNS if c in g.columns] + ["geometry"]
    g = g[keep].copy()

# -----------------------------
# 5) 输出 GeoParquet（离线分析与后端友好）
# -----------------------------
print(f"写出 GeoParquet: {OUT_PARQUET}")
g.to_parquet(OUT_PARQUET, index=False)

# -----------------------------
# 6) 输出前端用 GeoJSON（可选简化）
# -----------------------------
print("准备 Web 用 GeoJSON ...")
gw = g.to_crs(epsg=AREA_EPSG)

if DO_SIMPLIFY:
    print(f"几何简化（tolerance ~ {SIMPLIFY_TOLERANCE_M} m）以降低前端负载 ...")
    gw["geometry"] = gw.geometry.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)

# 回到 WGS84 (EPSG:4326) 以便 Web 地图使用
gw = gw.to_crs(epsg=4326)

print(f"写出 GeoJSON: {OUT_GEOJSON}")
# 避免坐标写太多小数
gw.to_file(OUT_GEOJSON, driver="GeoJSON")

print("✅ 完成！")
print(f"- GeoParquet: {OUT_PARQUET}")
print(f"- GeoJSON   : {OUT_GEOJSON}")
print("字段说明：population=总人口，area_km2=面积(km²)，density_km2=人口密度(人/平方公里)")
