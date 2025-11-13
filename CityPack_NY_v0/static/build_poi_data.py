#!/usr/bin/env python3
"""
Extract and process POI data from existing buildings GeoJSON for both model analysis and web rendering.
Based on urban computing requirements, we focus on key POI categories that are most relevant for city analysis.
"""

import json
import geopandas as gpd
import pandas as pd
from pathlib import Path
import numpy as np
from shapely.geometry import Point

def load_buildings_data(geojson_path):
    """Load buildings GeoJSON data"""
    print(f"Loading buildings data from {geojson_path}")
    gdf = gpd.read_file(geojson_path)
    print(f"Loaded {len(gdf)} buildings")
    return gdf

def classify_poi_categories():
    """Define POI categories based on urban computing requirements"""
    poi_categories = {
        # Transportation & Infrastructure
        'transportation': ['train_station', 'subway_entrance', 'transportation', 'bridge'],
        
        # Education & Research
        'education': ['school', 'university', 'college', 'library', 'kindergarten'],
        
        # Healthcare
        'healthcare': ['hospital'],
        
        # Commercial & Retail
        'commercial': ['retail', 'commercial', 'office', 'bank', 'hotel'],
        
        # Entertainment & Culture
        'entertainment': ['theatre', 'cinema', 'museum', 'art_gallery'],
        
        # Religious & Community
        'religious': ['church', 'synagogue', 'mosque', 'cathedral', 'chapel', 'religious'],
        
        # Government & Public Services
        'government': ['government', 'public', 'civic', 'fire_station'],
        
        # Sports & Recreation
        'sports': ['sports_centre'],
        
        # Industrial & Utilities
        'industrial': ['industrial', 'warehouse', 'service', 'works', 'depot'],
        
        # Residential (for urban planning analysis)
        'residential': ['apartments', 'house', 'residential', 'dormitory', 'mansion'],
        
        # Special/Historic
        'historic': ['fort', 'ruins', 'triumphal_arch'],
        
        # Other notable structures
        'other': ['tower', 'ship', 'pavilion', 'kiosk']
    }
    return poi_categories

def extract_poi_from_buildings(gdf, poi_categories):
    """Extract POI from buildings data based on categories"""
    print("Extracting POI data from buildings...")
    
    # Create a mapping from building type to POI category
    building_to_category = {}
    for category, building_types in poi_categories.items():
        for building_type in building_types:
            building_to_category[building_type] = category
    
    # Filter buildings that have meaningful POI information
    poi_buildings = gdf[
        (gdf['building'].isin(building_to_category.keys())) &
        (gdf['name'].notna()) &
        (gdf['name'] != 'null') &
        (gdf['name'] != '')
    ].copy()
    
    print(f"Found {len(poi_buildings)} POI buildings with names")
    
    # Add POI category
    poi_buildings['poi_category'] = poi_buildings['building'].map(building_to_category)
    
    # Calculate centroid for point representation
    poi_buildings['centroid'] = poi_buildings.geometry.centroid
    
    return poi_buildings

def create_poi_points_data(poi_buildings):
    """Create point-based POI data for web rendering"""
    print("Creating POI points data...")
    
    # Create point geometries from centroids
    poi_points = poi_buildings.copy()
    # Convert centroids to actual Point geometries and replace the geometry column
    point_geometries = poi_points['centroid'].apply(lambda pt: Point(pt.x, pt.y))
    poi_points = poi_points.drop(columns=['centroid'])  # Drop centroid first
    poi_points.geometry = point_geometries  # Then assign the new point geometries
    
    # Select relevant columns for web display
    poi_points = poi_points[['id', 'name', 'building', 'poi_category', 'geometry']].copy()
    
    # Add display properties
    poi_points['display_name'] = poi_points['name']
    poi_points['building_type'] = poi_points['building']
    
    # Add category-specific styling information
    category_colors = {
        'transportation': '#2563eb',  # blue
        'education': '#16a34a',       # green
        'healthcare': '#dc2626',      # red
        'commercial': '#ea580c',      # orange
        'entertainment': '#9333ea',   # purple
        'religious': '#0891b2',       # cyan
        'government': '#1f2937',      # gray
        'sports': '#059669',          # emerald
        'industrial': '#6b7280',      # gray
        'residential': '#f59e0b',     # amber
        'historic': '#8b5cf6',        # violet
        'other': '#64748b'            # slate
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
    
    return poi_points

def save_model_data(poi_buildings, output_dir):
    """Save POI data for model analysis (GeoParquet format)"""
    print("Saving model analysis data...")
    
    # Create model data with full building polygons and detailed attributes
    model_data = poi_buildings[['id', 'name', 'building', 'poi_category', 'geometry']].copy()
    
    # Add geometric properties for analysis
    model_data['area_m2'] = model_data.geometry.area
    model_data['centroid_lon'] = model_data.geometry.centroid.x
    model_data['centroid_lat'] = model_data.geometry.centroid.y
    
    # Add category counts for analysis
    category_counts = model_data['poi_category'].value_counts().to_dict()
    model_data['category_total_count'] = model_data['poi_category'].map(category_counts)
    
    # Save as GeoParquet for efficient analysis
    output_path = output_dir / "poi_analysis.parquet"
    model_data.to_parquet(output_path)
    print(f"Saved model analysis data to {output_path}")
    
    # Also save summary statistics
    stats = {
        'total_pois': len(model_data),
        'categories': category_counts,
        'top_pois_by_area': model_data.nlargest(10, 'area_m2')[['name', 'poi_category', 'area_m2']].to_dict('records')
    }
    
    stats_path = output_dir / "poi_stats.json"
    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2, default=str)
    print(f"Saved POI statistics to {stats_path}")

def save_web_data(poi_points, output_dir):
    """Save POI data for web rendering (GeoJSON format)"""
    print("Saving web rendering data...")
    
    # Convert to GeoJSON format
    web_data = poi_points.copy()
    
    # Ensure all properties are JSON serializable
    for col in web_data.columns:
        if col != 'geometry':
            web_data[col] = web_data[col].astype(str)
    
    # Save as GeoJSON
    output_path = output_dir / "poi_web.geojson"
    web_data.to_file(output_path, driver='GeoJSON')
    print(f"Saved web data to {output_path}")
    
    # Create category summary for web controls
    category_summary = {}
    for category in poi_points['poi_category'].unique():
        category_data = poi_points[poi_points['poi_category'] == category]
        category_summary[category] = {
            'count': len(category_data),
            'color': category_data['color'].iloc[0],
            'icon': category_data['icon'].iloc[0],
            'examples': category_data['display_name'].head(3).tolist()
        }
    
    summary_path = output_dir / "poi_categories.json"
    with open(summary_path, 'w') as f:
        json.dump(category_summary, f, indent=2, ensure_ascii=False)
    print(f"Saved category summary to {summary_path}")

def main():
    """Main processing function"""
    print("=== POI Data Processing ===")
    
    # Set up paths
    base_dir = Path(__file__).parent
    web_data_dir = base_dir.parent / "web" / "data"
    output_dir = base_dir / "out"
    output_dir.mkdir(exist_ok=True)
    
    # Input file
    buildings_file = web_data_dir / "buildings_web.geojson"
    
    if not buildings_file.exists():
        print(f"Error: Buildings file not found at {buildings_file}")
        return
    
    # Load and process data
    gdf = load_buildings_data(buildings_file)
    poi_categories = classify_poi_categories()
    poi_buildings = extract_poi_from_buildings(gdf, poi_categories)
    poi_points = create_poi_points_data(poi_buildings)
    
    # Save outputs
    save_model_data(poi_buildings, output_dir)
    save_web_data(poi_points, output_dir)
    
    # Print summary
    print("\n=== Processing Summary ===")
    print(f"Total buildings processed: {len(gdf)}")
    print(f"POI buildings extracted: {len(poi_buildings)}")
    print(f"POI categories found: {len(poi_points['poi_category'].unique())}")
    print("\nCategory breakdown:")
    for category, count in poi_points['poi_category'].value_counts().items():
        print(f"  {category}: {count}")
    
    print(f"\nFiles saved to {output_dir}:")
    print("  - poi_analysis.parquet (for model analysis)")
    print("  - poi_stats.json (analysis statistics)")
    print("  - poi_web.geojson (for web rendering)")
    print("  - poi_categories.json (category information)")

if __name__ == "__main__":
    main()
