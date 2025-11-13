#!/usr/bin/env python3
"""
简化的图像服务器，使用Python内置HTTP服务器
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import sys
from satellite_streetview_api import SatelliteStreetViewAPI
import requests

class ImageHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.api = SatelliteStreetViewAPI()
        super().__init__(*args, **kwargs)

    def do_GET(self):
        try:
            parsed_url = urlparse(self.path)
            path = parsed_url.path
            query_params = parse_qs(parsed_url.query)
            
            if path == '/api/images':
                self.handle_images_info(query_params)
            elif path == '/api/satellite':
                self.handle_satellite_image(query_params)
            elif path == '/api/streetview':
                self.handle_streetview_image(query_params)
            elif path == '/health':
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok'}).encode())
            else:
                self.send_error(404)
        except Exception as e:
            print(f"Error: {e}")
            self.send_error(500, str(e))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def get_lat_lon(self, query_params):
        try:
            lat = float(query_params.get('lat', [None])[0])
            lon = float(query_params.get('lon', [None])[0])
            return lat, lon
        except:
            raise ValueError("Missing lat/lon parameters")

    def handle_images_info(self, query_params):
        try:
            lat, lon = self.get_lat_lon(query_params)
            info = self.api.get_images_info(lat, lon)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(info).encode())
        except Exception as e:
            self.send_error(400, str(e))

    def handle_satellite_image(self, query_params):
        try:
            lat, lon = self.get_lat_lon(query_params)
            url = self.api.get_satellite_image_url(lat, lon)
            
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response.content)
        except Exception as e:
            self.send_error(500, str(e))

    def handle_streetview_image(self, query_params):
        try:
            lat, lon = self.get_lat_lon(query_params)
            quality = query_params.get('quality', ['1024'])[0]
            
            streetview_info = self.api.search_nearby_streetview(lat, lon)
            if not streetview_info:
                self.send_error(404, "No street view available")
                return
            
            url_key = f'thumb_{quality}_url'
            image_url = streetview_info.get(url_key)
            
            if not image_url:
                for alt_quality in ['1024', '256', '2048']:
                    alt_url_key = f'thumb_{alt_quality}_url'
                    image_url = streetview_info.get(alt_url_key)
                    if image_url:
                        break
            
            if not image_url:
                self.send_error(404, "No image URL available")
                return
            
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()
            
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response.content)
        except Exception as e:
            self.send_error(500, str(e))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    server = HTTPServer(('localhost', port), ImageHandler)
    print(f"🚀 Image server running on http://localhost:{port}")
    print("Endpoints:")
    print(f"  /api/images?lat=40.7589&lon=-73.9851")
    print(f"  /api/satellite?lat=40.7589&lon=-73.9851")
    print(f"  /api/streetview?lat=40.7589&lon=-73.9851")
    print(f"  /health")
    server.serve_forever()
