# build_weather_data.py
# -*- coding: utf-8 -*-
"""
处理2024年NYC天气数据（Central Park气象站）
从CSV文件读取天气数据，生成按日期分组的天气信息
输出GeoParquet（模型用）和JSON（前端用）格式
"""

import os
import pandas as pd
import numpy as np
import json
from datetime import datetime

# -----------------------------
# 0) 配置
# -----------------------------
# 输入文件
CSV_FILE = "LCD_USW00094728_2024.csv"

# 输出文件
OUT_DIR = "out"
OUT_PARQUET = os.path.join(OUT_DIR, "weather_2024.parquet")
OUT_JSON = os.path.join(OUT_DIR, "weather_2024.json")

# Web前端配置文件
WEB_DATA_DIR = "../web/data"
OUT_WEB_JSON = os.path.join(WEB_DATA_DIR, "weather_2024.json")

# 创建输出目录
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(WEB_DATA_DIR, exist_ok=True)

# 天气类型映射（METAR代码 -> 英文描述和图标）
WEATHER_TYPE_MAPPING = {
    'RA': {'en': 'Rain', 'icon': '🌧️', 'type': 'rain'},
    '-RA': {'en': 'Light Rain', 'icon': '🌦️', 'type': 'rain'},
    '+RA': {'en': 'Heavy Rain', 'icon': '⛈️', 'type': 'rain'},
    'SN': {'en': 'Snow', 'icon': '❄️', 'type': 'snow'},
    '-SN': {'en': 'Light Snow', 'icon': '🌨️', 'type': 'snow'},
    '+SN': {'en': 'Heavy Snow', 'icon': '❄️', 'type': 'snow'},
    'FG': {'en': 'Fog', 'icon': '🌫️', 'type': 'fog'},
    'BR': {'en': 'Mist', 'icon': '🌫️', 'type': 'fog'},
    'HZ': {'en': 'Haze', 'icon': '😶‍🌫️', 'type': 'haze'},
    'TS': {'en': 'Thunderstorm', 'icon': '⛈️', 'type': 'thunderstorm'},
    'DZ': {'en': 'Drizzle', 'icon': '🌦️', 'type': 'drizzle'},
    'FZRA': {'en': 'Freezing Rain', 'icon': '🧊', 'type': 'freezing_rain'},
    'RASN': {'en': 'Sleet', 'icon': '🌨️', 'type': 'sleet'},
}

# 默认晴天
DEFAULT_WEATHER = {'en': 'Clear', 'icon': '☀️', 'type': 'clear'}

# 数据已经是摄氏度，直接使用
def get_celsius(value):
    if pd.isna(value) or value == '':
        return None
    try:
        return round(float(value), 1)
    except:
        return None

# 摄氏度转华氏度
def c_to_f(celsius):
    if celsius is None:
        return None
    return round(celsius * 9.0 / 5.0 + 32, 1)

# 解析天气类型
def parse_weather_type(weather_str):
    """从DailyWeather字符串中提取天气类型"""
    if pd.isna(weather_str) or weather_str == '':
        return DEFAULT_WEATHER
    
    weather_str = str(weather_str).strip().upper()
    
    # 尝试匹配已知天气类型
    for code, info in WEATHER_TYPE_MAPPING.items():
        if code in weather_str:
            return info
    
    # 如果包含特定关键词
    if 'RAIN' in weather_str or 'RA' in weather_str:
        return WEATHER_TYPE_MAPPING.get('RA', DEFAULT_WEATHER)
    elif 'SNOW' in weather_str or 'SN' in weather_str:
        return WEATHER_TYPE_MAPPING.get('SN', DEFAULT_WEATHER)
    elif 'FOG' in weather_str or 'FG' in weather_str:
        return WEATHER_TYPE_MAPPING.get('FG', DEFAULT_WEATHER)
    elif 'THUNDER' in weather_str or 'TS' in weather_str:
        return WEATHER_TYPE_MAPPING.get('TS', DEFAULT_WEATHER)
    
    return DEFAULT_WEATHER

print("开始处理NYC 2024年天气数据...")

# -----------------------------
# 1) 读取和清洗CSV数据
# -----------------------------
print("读取CSV文件...")
df = pd.read_csv(CSV_FILE, low_memory=False)
print(f"原始数据行数: {len(df):,}")

# 转换日期格式
df['DATE'] = pd.to_datetime(df['DATE'], format='%Y-%m-%dT%H:%M:%S', errors='coerce')
df = df.dropna(subset=['DATE'])

# 只保留每天的日统计数据（REPORT_TYPE = 'SOD'）
daily_df = df[df['REPORT_TYPE'] == 'SOD'].copy()
print(f"每日统计数据行数: {len(daily_df):,}")

# -----------------------------
# 2) 提取并处理关键天气信息
# -----------------------------
print("处理天气数据...")

# 提取日期（不含时间）
daily_df['date'] = daily_df['DATE'].dt.date.astype(str)

# 处理天气类型
daily_df['weather_info'] = daily_df['DailyWeather'].apply(parse_weather_type)
daily_df['weather_en'] = daily_df['weather_info'].apply(lambda x: x['en'])
daily_df['weather_icon'] = daily_df['weather_info'].apply(lambda x: x['icon'])
daily_df['weather_type'] = daily_df['weather_info'].apply(lambda x: x['type'])

# 获取温度（数据本身就是摄氏度）
daily_df['temp_max_c'] = daily_df['DailyMaximumDryBulbTemperature'].apply(get_celsius)
daily_df['temp_min_c'] = daily_df['DailyMinimumDryBulbTemperature'].apply(get_celsius)
daily_df['temp_avg_c'] = daily_df['DailyAverageDryBulbTemperature'].apply(get_celsius)

# 同时计算华氏度
daily_df['temp_max_f'] = daily_df['temp_max_c'].apply(c_to_f)
daily_df['temp_min_f'] = daily_df['temp_min_c'].apply(c_to_f)
daily_df['temp_avg_f'] = daily_df['temp_avg_c'].apply(c_to_f)

# 处理降水量（英寸 -> 毫米）
def inch_to_mm(inch_val):
    if pd.isna(inch_val) or inch_val == '' or inch_val == 'T':
        return 0.0
    try:
        return round(float(inch_val) * 25.4, 1)
    except:
        return 0.0

daily_df['precipitation_mm'] = daily_df['DailyPrecipitation'].apply(inch_to_mm)
daily_df['snowfall_mm'] = daily_df['DailySnowfall'].apply(inch_to_mm)

# 处理湿度和风速
def safe_float(val):
    try:
        return round(float(val), 1) if pd.notna(val) and val != '' else None
    except:
        return None

daily_df['humidity_pct'] = daily_df['DailyAverageRelativeHumidity'].apply(safe_float)
daily_df['wind_speed_mph'] = daily_df['DailyAverageWindSpeed'].apply(safe_float)

# -----------------------------
# 3) 构建输出数据结构
# -----------------------------
print("构建输出数据...")

# 选择关键列并重命名
output_columns = {
    'date': 'date',
    'weather_en': 'weather',
    'weather_icon': 'icon',
    'weather_type': 'type',
    'temp_max_c': 'temp_max_c',
    'temp_min_c': 'temp_min_c',
    'temp_avg_c': 'temp_avg_c',
    'temp_max_f': 'temp_max_f',
    'temp_min_f': 'temp_min_f',
    'temp_avg_f': 'temp_avg_f',
    'precipitation_mm': 'precipitation',
    'snowfall_mm': 'snowfall',
    'humidity_pct': 'humidity',
    'wind_speed_mph': 'wind_speed'
}

weather_data = daily_df[list(output_columns.keys())].rename(columns=output_columns)

# 排序
weather_data = weather_data.sort_values('date').reset_index(drop=True)

# -----------------------------
# 4) 保存为Parquet（模型用）
# -----------------------------
print(f"保存Parquet文件: {OUT_PARQUET}")
weather_data.to_parquet(OUT_PARQUET, index=False)

# -----------------------------
# 5) 保存为JSON（前端用）
# -----------------------------
print(f"保存JSON文件: {OUT_JSON}")

# 转换为字典列表
weather_records = weather_data.to_dict('records')

# 处理None值（转换为null）
for record in weather_records:
    for key, value in record.items():
        if pd.isna(value):
            record[key] = None

# 保存JSON
with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(weather_records, f, ensure_ascii=False, indent=2)

# 同时保存到web目录
print(f"保存Web JSON文件: {OUT_WEB_JSON}")
with open(OUT_WEB_JSON, 'w', encoding='utf-8') as f:
    json.dump(weather_records, f, ensure_ascii=False, indent=2)

# -----------------------------
# 6) 生成统计信息
# -----------------------------
print("\n天气数据统计:")
print(f"  总天数: {len(weather_data)}")
print(f"  日期范围: {weather_data['date'].min()} 到 {weather_data['date'].max()}")
print(f"\n天气类型分布:")
weather_type_counts = weather_data['weather'].value_counts()
for weather_type, count in weather_type_counts.head(10).items():
    print(f"  {weather_type}: {count}天")

print(f"\n温度统计（摄氏度）:")
print(f"  最高温度: {weather_data['temp_max_c'].max():.1f}°C ({weather_data['temp_max_f'].max():.1f}°F)")
print(f"  最低温度: {weather_data['temp_min_c'].min():.1f}°C ({weather_data['temp_min_f'].min():.1f}°F)")
print(f"  平均温度: {weather_data['temp_avg_c'].mean():.1f}°C ({weather_data['temp_avg_f'].mean():.1f}°F)")

print(f"\n降水统计:")
total_precip = weather_data['precipitation'].sum()
rainy_days = len(weather_data[weather_data['precipitation'] > 0])
print(f"  总降水量: {total_precip:.1f}mm")
print(f"  降水天数: {rainy_days}天")

print("\n处理完成!")
print(f"\n输出文件:")
print(f"  模型数据: {OUT_PARQUET}")
print(f"  前端数据: {OUT_WEB_JSON}")

