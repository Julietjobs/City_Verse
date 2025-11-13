#!/usr/bin/env python3
"""
Create POI points from buildings data - separate script to ensure correct geometry conversion
"""

import json
import geopandas as gpd
import pandas as pd
from pathlib import Path
from shapely.geometry import Point

def main():
    print("=== Creating POI Points ===")
    
    # Set up paths
    base_dir = Path(__file__).parent
    web_data_dir = base_dir.parent / "web" / "data"
    output_dir = base_dir / "out"
    
    # Load buildings data
    buildings_file = web_data_dir / "buildings_web.geojson"
    print(f"Loading buildings from {buildings_file}")
    gdf = gpd.read_file(buildings_file)
    print(f"Loaded {len(gdf)} buildings")
    
    # POI categories mapping
    poi_categories = {
        'transportation': ['train_station', 'subway_entrance', 'transportation', 'bridge'],
        'education': ['school', 'university', 'college', 'library', 'kindergarten'],
        'healthcare': ['hospital'],
        'commercial': ['retail', 'commercial', 'office', 'bank', 'hotel'],
        'entertainment': ['theatre', 'cinema', 'museum', 'art_gallery'],
        'religious': ['church', 'synagogue', 'mosque', 'cathedral', 'chapel', 'religious'],
        'government': ['government', 'public', 'civic', 'fire_station'],
        'sports': ['sports_centre'],
        'industrial': ['industrial', 'warehouse', 'service', 'works', 'depot'],
        'residential': ['apartments', 'house', 'residential', 'dormitory', 'mansion'],
        'historic': ['fort', 'ruins', 'triumphal_arch'],
        'other': ['tower', 'ship', 'pavilion', 'kiosk']
    }
    
    # Create building type to category mapping
    building_to_category = {}
    for category, building_types in poi_categories.items():
        for building_type in building_types:
            building_to_category[building_type] = category
    
    # Filter POI buildings
    poi_buildings = gdf[
        (gdf['building'].isin(building_to_category.keys())) &
        (gdf['name'].notna()) &
        (gdf['name'] != 'null') &
        (gdf['name'] != '')
    ].copy()
    
    print(f"Found {len(poi_buildings)} POI buildings")
    
    # Add POI category
    poi_buildings['poi_category'] = poi_buildings['building'].map(building_to_category)
    
    # Create points from centroids
    print("Creating point geometries...")
    centroids = poi_buildings.geometry.centroid
    
    # Create new GeoDataFrame with point geometries
    poi_data = []
    for idx, row in poi_buildings.iterrows():
        centroid = row.geometry.centroid
        point_geom = Point(centroid.x, centroid.y)
        
        poi_data.append({
            'id': str(row['id']),
            'name': row['name'],
            'building': row['building'],
            'poi_category': row['poi_category'],
            'display_name': row['name'],
            'building_type': row['building'],
            'geometry': point_geom
        })
    
    # Create GeoDataFrame with point geometries
    poi_points = gpd.GeoDataFrame(poi_data, crs=gdf.crs)
    
    # Add styling information
    category_colors = {
        'transportation': '#2563eb',
        'education': '#16a34a',
        'healthcare': '#dc2626',
        'commercial': '#ea580c',
        'entertainment': '#9333ea',
        'religious': '#0891b2',
        'government': '#1f2937',
        'sports': '#059669',
        'industrial': '#6b7280',
        'residential': '#f59e0b',
        'historic': '#8b5cf6',
        'other': '#64748b'
    }
    
    category_icons = {
        'transportation': '🚉',
        'education': '🎓',
        'healthcare': '🏥',
        'commercial': '🏢',
        'entertainment': '🎭',
        'religious': '⛪',
        'government': '🏛️',
        'sports': '🏟️',
        'industrial': '🏭',
        'residential': '🏠',
        'historic': '🏰',
        'other': '📍'
    }
    
    poi_points['color'] = poi_points['poi_category'].map(category_colors)
    poi_points['icon'] = poi_points['poi_category'].map(category_icons)
    
    # Verify geometry types
    print(f"Geometry type check: {poi_points.geometry.iloc[0].geom_type}")
    print(f"Sample point coordinates: {poi_points.geometry.iloc[0].coords[:]}")
    
    # Save as GeoJSON
    output_path = output_dir / "poi_web.geojson"
    poi_points.to_file(output_path, driver='GeoJSON')
    print(f"Saved {len(poi_points)} POI points to {output_path}")
    
    # Verify the saved file
    test_load = gpd.read_file(output_path)
    print(f"Verification - loaded geometry type: {test_load.geometry.iloc[0].geom_type}")
    
    print(f"Category breakdown:")
    for category, count in poi_points['poi_category'].value_counts().items():
        print(f"  {category}: {count}")

if __name__ == "__main__":
    main()

