#!/usr/bin/env python3
"""
Satellite and Street View Image API
获取指定经纬度的卫星图像和街景图像

数据源:
- 卫星图像: ESRI World Imagery (免费，无需API密钥)
- 街景图像: Mapillary API (需要access token)

Usage:
    python satellite_streetview_api.py --lat 40.7589 --lon -73.9851
"""

import requests
import json
import argparse
import os
from typing import Optional, Tuple, Dict, Any
import time
from urllib.parse import urlencode

class SatelliteStreetViewAPI:
    def __init__(self):
        # Mapillary API配置 (从README中获取的token)
        self.mapillary_token = "YOUR_MAPILLARY_ACCESS_TOKEN_HERE Start with 'MLY|' "
        self.mapillary_base_url = "https://graph.mapillary.com"
        
        # ESRI World Imagery配置 (免费服务，无需密钥)
        self.esri_base_url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
        
        # 请求头
        self.headers = {
            'User-Agent': 'CityVerse-SatelliteStreetView/1.0'
        }

    def get_satellite_image_url(self, lat: float, lon: float, zoom: int = 18, size: Tuple[int, int] = (512, 512)) -> str:
        """
        获取ESRI卫星图像URL
        
        Args:
            lat: 纬度
            lon: 经度  
            zoom: 缩放级别 (1-20)
            size: 图像尺寸 (宽, 高)
            
        Returns:
            str: 卫星图像URL
        """
        # 计算边界框 (大约500米范围)
        lat_offset = 0.0045  # 约500米
        lon_offset = 0.0055  # 约500米
        
        bbox = f"{lon - lon_offset},{lat - lat_offset},{lon + lon_offset},{lat + lat_offset}"
        
        params = {
            'bbox': bbox,
            'bboxSR': '4326',  # WGS84
            'imageSR': '4326',
            'size': f"{size[0]},{size[1]}",
            'format': 'png',
            'f': 'image'
        }
        
        return f"{self.esri_base_url}?{urlencode(params)}"

    def download_satellite_image(self, lat: float, lon: float, save_path: str = None) -> Optional[str]:
        """
        下载卫星图像
        
        Args:
            lat: 纬度
            lon: 经度
            save_path: 保存路径，如果不提供则自动生成
            
        Returns:
            str: 保存的文件路径，失败返回None
        """
        try:
            url = self.get_satellite_image_url(lat, lon)
            
            if not save_path:
                save_path = f"satellite_{lat:.6f}_{lon:.6f}.png"
            
            response = requests.get(url, headers=self.headers, timeout=30)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            print(f"✅ 卫星图像已保存: {save_path}")
            return save_path
            
        except Exception as e:
            print(f"❌ 获取卫星图像失败: {str(e)}")
            return None

    def search_nearby_streetview(self, lat: float, lon: float, radius: int = 100) -> Optional[Dict[str, Any]]:
        """
        搜索附近的街景图像
        
        Args:
            lat: 纬度
            lon: 经度
            radius: 搜索半径(米)
            
        Returns:
            dict: 最近的街景图像信息，失败返回None
        """
        try:
            # 搜索附近的图像
            search_url = f"{self.mapillary_base_url}/images"
            params = {
                'access_token': self.mapillary_token,
                'fields': 'id,thumb_256_url,thumb_1024_url,thumb_2048_url,computed_geometry,captured_at,compass_angle',
                'bbox': f"{lon-0.001},{lat-0.001},{lon+0.001},{lat+0.001}",
                'limit': 10
            }
            
            response = requests.get(search_url, params=params, headers=self.headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            if not data.get('data'):
                print(f"⚠️  在位置 ({lat}, {lon}) 附近未找到街景图像")
                return None
            
            # 选择最近的图像
            closest_image = data['data'][0]
            
            # 计算距离（简单的欧几里得距离）
            image_coords = closest_image['computed_geometry']['coordinates']
            image_lon, image_lat = image_coords
            distance = ((lat - image_lat) ** 2 + (lon - image_lon) ** 2) ** 0.5 * 111000  # 近似米数
            
            result = {
                'id': closest_image['id'],
                'distance_m': round(distance, 1),
                'lat': image_lat,
                'lon': image_lon,
                'captured_at': closest_image.get('captured_at'),
                'compass_angle': closest_image.get('compass_angle'),
                'thumb_256_url': closest_image.get('thumb_256_url'),
                'thumb_1024_url': closest_image.get('thumb_1024_url'),
                'thumb_2048_url': closest_image.get('thumb_2048_url')
            }
            
            print(f"✅ 找到街景图像，距离目标点 {result['distance_m']}米")
            return result
            
        except Exception as e:
            print(f"❌ 搜索街景图像失败: {str(e)}")
            return None

    def download_streetview_image(self, lat: float, lon: float, save_path: str = None, quality: str = '1024') -> Optional[str]:
        """
        下载街景图像
        
        Args:
            lat: 纬度
            lon: 经度
            save_path: 保存路径，如果不提供则自动生成
            quality: 图像质量 ('256', '1024', '2048')
            
        Returns:
            str: 保存的文件路径，失败返回None
        """
        try:
            # 搜索附近的街景
            streetview_info = self.search_nearby_streetview(lat, lon)
            if not streetview_info:
                return None
            
            # 选择合适的URL
            url_key = f'thumb_{quality}_url'
            image_url = streetview_info.get(url_key)
            
            if not image_url:
                print(f"⚠️  {quality}质量的图像不可用，尝试使用其他质量")
                for alt_quality in ['1024', '256', '2048']:
                    alt_url_key = f'thumb_{alt_quality}_url'
                    image_url = streetview_info.get(alt_url_key)
                    if image_url:
                        quality = alt_quality
                        break
            
            if not image_url:
                print("❌ 无可用的街景图像URL")
                return None
            
            if not save_path:
                save_path = f"streetview_{lat:.6f}_{lon:.6f}_{quality}.jpg"
            
            response = requests.get(image_url, headers=self.headers, timeout=30)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            print(f"✅ 街景图像已保存: {save_path} (质量: {quality}, 距离: {streetview_info['distance_m']}m)")
            return save_path
            
        except Exception as e:
            print(f"❌ 下载街景图像失败: {str(e)}")
            return None

    def get_images_info(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        获取指定位置的卫星图和街景图信息
        
        Args:
            lat: 纬度
            lon: 经度
            
        Returns:
            dict: 包含图像URL和信息的字典
        """
        result = {
            'location': {'lat': lat, 'lon': lon},
            'satellite': {
                'available': True,
                'url': self.get_satellite_image_url(lat, lon),
                'source': 'ESRI World Imagery'
            },
            'streetview': {
                'available': False,
                'info': None,
                'source': 'Mapillary'
            }
        }
        
        # 搜索街景信息
        streetview_info = self.search_nearby_streetview(lat, lon)
        if streetview_info:
            result['streetview']['available'] = True
            result['streetview']['info'] = streetview_info
        
        return result

def main():
    parser = argparse.ArgumentParser(description='获取指定经纬度的卫星图和街景图')
    parser.add_argument('--lat', type=float, required=True, help='纬度')
    parser.add_argument('--lon', type=float, required=True, help='经度')
    parser.add_argument('--download', action='store_true', help='下载图像到本地')
    parser.add_argument('--output-dir', default='.', help='输出目录')
    parser.add_argument('--quality', choices=['256', '1024', '2048'], default='1024', help='街景图像质量')
    
    args = parser.parse_args()
    
    # 创建输出目录
    os.makedirs(args.output_dir, exist_ok=True)
    
    api = SatelliteStreetViewAPI()
    
    print(f"🌍 获取位置 ({args.lat}, {args.lon}) 的图像信息...")
    
    # 获取图像信息
    info = api.get_images_info(args.lat, args.lon)
    
    print("\n📊 图像信息:")
    print(json.dumps(info, indent=2, ensure_ascii=False))
    
    if args.download:
        print(f"\n📥 下载图像到目录: {args.output_dir}")
        
        # 下载卫星图像
        sat_path = os.path.join(args.output_dir, f"satellite_{args.lat:.6f}_{args.lon:.6f}.png")
        api.download_satellite_image(args.lat, args.lon, sat_path)
        
        # 下载街景图像
        if info['streetview']['available']:
            street_path = os.path.join(args.output_dir, f"streetview_{args.lat:.6f}_{args.lon:.6f}_{args.quality}.jpg")
            api.download_streetview_image(args.lat, args.lon, street_path, args.quality)
        else:
            print("⚠️  该位置附近无可用街景图像")

if __name__ == "__main__":
    main()

