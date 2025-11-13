/**
 * CityFlow Replay - MapLibre GL JS Implementation
 * 
 * This script provides replay functionality for CityFlow simulation data
 * using MapLibre GL JS instead of the original PixiJS-based renderer.
 */

// Configuration constants
const CONFIG = {
    // Map center (arbitrary reference point in NYC for coordinate conversion)
    MAP_CENTER: [-73.9712, 40.7831],
    
    // Coordinate scale: converts CityFlow's local meters to lng/lat degrees
    // Approximately 111,111 meters per degree latitude at equator
    // At NYC latitude (~40°), about 85,000 meters per degree longitude
    COORD_SCALE: {
        lng: 1 / 85000,  // meters to longitude degrees
        lat: 1 / 111111  // meters to latitude degrees
    },
    
    // Visual settings
    LANE_WIDTH: 4,
    CAR_LENGTH: 5,
    CAR_WIDTH: 2,
    TRAFFIC_LIGHT_WIDTH: 3,
    
    // Colors
    COLORS: {
        ROAD: '#586970',
        LANE_BORDER: '#82a8ba',
        LANE_INNER: '#bed8e8',
        INTERSECTION: '#586970',
        CAR: ['#f2bfd7', '#b7ebe4', '#dbebb7', '#f5ddb5', '#d4b5f5'],
        LIGHT_RED: '#db635e',
        LIGHT_GREEN: '#85ee00',
        LIGHT_GRAY: '#808080'
    }
};

// Global state
let map;
let roadnetData = null;
let replayData = null;
let currentStep = 0;
let totalSteps = 0;
let isPlaying = false;
let replaySpeed = 0.5;
let animationFrameId = null;
let lastFrameTime = 0;

// Data structures
let nodes = {};
let edges = {};
let trafficLights = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEventListeners();
});

/**
 * Initialize MapLibre GL map
 */
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {},
            layers: [
                {
                    id: 'background',
                    type: 'background',
                    paint: {
                        'background-color': '#e8ebed'
                    }
                }
            ]
        },
        center: CONFIG.MAP_CENTER,
        zoom: 15,
        pitch: 0,
        bearing: 0
    });
    
    map.on('load', () => {
        logInfo('Map loaded successfully');
    });
}

/**
 * Setup event listeners for UI controls
 */
function setupEventListeners() {
    document.getElementById('start-btn').addEventListener('click', handleStartClick);
    document.getElementById('play-btn').addEventListener('click', playSimulation);
    document.getElementById('pause-btn').addEventListener('click', pauseSimulation);
    document.getElementById('stop-btn').addEventListener('click', stopSimulation);
    document.getElementById('prev-btn').addEventListener('click', stepBackward);
    document.getElementById('next-btn').addEventListener('click', stepForward);
    document.getElementById('slow-btn').addEventListener('click', () => adjustSpeed(-0.1));
    document.getElementById('fast-btn').addEventListener('click', () => adjustSpeed(0.1));
    document.getElementById('speed-slider').addEventListener('input', handleSpeedSlider);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Prevent shortcuts if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        if (e.key === ' ') {
            e.preventDefault();
            togglePause();
        } else if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            stopSimulation();
        } else if (e.key === '[' || e.key === 'ArrowLeft') {
            e.preventDefault();
            stepBackward();
        } else if (e.key === ']' || e.key === 'ArrowRight') {
            e.preventDefault();
            stepForward();
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            adjustSpeed(-0.1);
        } else if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            adjustSpeed(0.1);
        }
    });
}

/**
 * Clean up existing layers and sources before loading new data
 */
function cleanupExistingLayers() {
    // Stop animation
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    isPlaying = false;
    lastFrameTime = 0;
    
    // Remove layers and sources
    const layersToRemove = ['vehicles', 'traffic-lights', 'lane-markings', 'center-lines', 'roads', 'intersections'];
    const sourcesToRemove = ['vehicles', 'traffic-lights', 'lane-markings', 'center-lines', 'roads', 'intersections'];
    
    layersToRemove.forEach(layerId => {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
    });
    
    sourcesToRemove.forEach(sourceId => {
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    });
    
    // Reset data
    nodes = {};
    edges = {};
    trafficLights = {};
    currentStep = 0;
    
    logInfo('Cleaned up previous simulation');
}

/**
 * Handle start button click
 */
async function handleStartClick() {
    const roadnetFile = document.getElementById('roadnet-file').files[0];
    const replayFile = document.getElementById('replay-file').files[0];
    
    if (!roadnetFile || !replayFile) {
        logError('Please select both roadnet and replay files');
        return;
    }
    
    showLoading(true);
    clearInfo();
    
    try {
        // Clean up existing simulation
        cleanupExistingLayers();
        
        // Load files
        logInfo('Loading roadnet file...');
        const roadnetText = await readFile(roadnetFile);
        roadnetData = JSON.parse(roadnetText);
        logInfo('Roadnet loaded successfully');
        
        logInfo('Loading replay file...');
        const replayText = await readFile(replayFile);
        replayData = replayText.trim().split('\n');
        totalSteps = replayData.length;
        logInfo(`Replay loaded: ${totalSteps} steps`);
        
        // Process and render
        processRoadnet();
        renderRoadnet();
        initializeVehicleLayer();
        initializeTrafficLightLayer();
        
        // Update UI
        document.getElementById('total-steps').textContent = totalSteps;
        document.getElementById('control-box').style.display = 'block';
        
        // Start replay
        currentStep = 0;
        isPlaying = true;
        startAnimation();
        
        logInfo('Replay started');
    } catch (error) {
        logError('Error loading files: ' + error.message);
        console.error(error);
    } finally {
        showLoading(false);
    }
}

/**
 * Read file as text
 */
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/**
 * Process roadnet data
 */
function processRoadnet() {
    const roadnet = roadnetData.static;
    
    // Process nodes
    nodes = {};
    roadnet.nodes.forEach(node => {
        nodes[node.id] = {
            ...node,
            point: convertCoords(node.point)
        };
    });
    
    // Process edges
    edges = {};
    roadnet.edges.forEach(edge => {
        edges[edge.id] = {
            ...edge,
            from: nodes[edge.from],
            to: nodes[edge.to],
            points: edge.points.map(p => convertCoords(p))
        };
    });
    
    logInfo(`Processed ${Object.keys(nodes).length} nodes and ${Object.keys(edges).length} edges`);
}

/**
 * Convert CityFlow local coordinates to WGS84 lng/lat
 * No axis flipping to get correct map orientation
 */
function convertCoords(point) {
    // Use CityFlow coordinates directly without flipping
    const x = point[0];
    const y = point[1];  // No Y-flip for correct orientation
    
    // Convert to lng/lat offset from map center
    const lng = CONFIG.MAP_CENTER[0] + x * CONFIG.COORD_SCALE.lng;
    const lat = CONFIG.MAP_CENTER[1] + y * CONFIG.COORD_SCALE.lat;
    
    return [lng, lat];
}

/**
 * Convert bearing from CityFlow to MapLibre
 * Without Y-flip, angle conversion changes
 * CityFlow: radians, counterclockwise from east
 * MapLibre: degrees, clockwise from north
 */
function convertBearing(angle) {
    // CityFlow angle: radians, counterclockwise from east (in non-flipped space)
    // Without Y-flip: angle -> -angle (reflection)
    // MapLibre bearing: degrees, clockwise from north
    // Conversion: bearing = 90° - (-angle) = 90° + angle
    
    const degrees = angle * (180 / Math.PI);
    return (90 + degrees + 360) % 360;
}

/**
 * Calculate perpendicular offset direction
 * Without Y-flip, adjust perpendicular calculation
 * For left-hand traffic (CityFlow default)
 */
function getPerpendicular(fromPoint, toPoint) {
    const dx = toPoint[0] - fromPoint[0];
    const dy = toPoint[1] - fromPoint[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return [0, 0];
    
    // Without Y-flip, perpendicular direction changes
    // Clockwise 90 degrees for correct lane offset
    // (dx, dy) -> (dy, -dx)
    return [dy / length, -dx / length];
}

/**
 * Check if two edges form a bidirectional road (opposite directions between same nodes)
 */
function isBidirectionalRoad(edge1, edge2) {
    return (edge1.from.id === edge2.to.id && edge1.to.id === edge2.from.id);
}

/**
 * Find the opposite direction edge for a given edge
 */
function findOppositeEdge(edgeId) {
    const edge = edges[edgeId];
    for (const otherEdgeId in edges) {
        if (otherEdgeId !== edgeId) {
            const otherEdge = edges[otherEdgeId];
            if (isBidirectionalRoad(edge, otherEdge)) {
                return otherEdge;
            }
        }
    }
    return null;
}

/**
 * Render roadnet on map
 */
function renderRoadnet() {
    // Create GeoJSON features for edges (roads) as polygons
    const roadPolygonFeatures = [];
    const laneLineFeatures = [];
    const centerLineFeatures = [];  // For bidirectional road center lines
    
    for (const edgeId in edges) {
        const edge = edges[edgeId];
        const from = edge.from;
        const to = edge.to;
        const points = edge.points;
        
        // Calculate total road width
        let roadWidth = 0;
        edge.laneWidths.forEach(w => roadWidth += w);
        
        // Build road polygon
        const leftCoords = [];
        const rightCoords = [];
        
        for (let i = 0; i < points.length; i++) {
            let point = points[i];
            let perpDir;
            
            // Adjust for node width at endpoints
            if (i === 0 && !from.virtual && from.width) {
                point = movePointToward(points[0], points[1], from.width);
                perpDir = getPerpendicular(points[0], points[1]);
            } else if (i === points.length - 1 && !to.virtual && to.width) {
                point = movePointToward(points[i], points[i-1], to.width);
                perpDir = getPerpendicular(points[i-1], points[i]);
            } else if (i === 0) {
                perpDir = getPerpendicular(points[0], points[1]);
            } else if (i === points.length - 1) {
                perpDir = getPerpendicular(points[i-1], points[i]);
            } else {
                // Use average of adjacent segment directions for smooth corners
                perpDir = getPerpendicular(points[i-1], points[i+1]);
            }
            
            // Calculate road edge points
            const offsetLng = perpDir[0] * roadWidth * CONFIG.COORD_SCALE.lng;
            const offsetLat = perpDir[1] * roadWidth * CONFIG.COORD_SCALE.lat;
            
            leftCoords.push([point[0], point[1]]);
            rightCoords.push([point[0] + offsetLng, point[1] + offsetLat]);
        }
        
        // Create polygon (left edge + reversed right edge)
        const polygonCoords = [...leftCoords, ...rightCoords.reverse(), leftCoords[0]];
        
        roadPolygonFeatures.push({
            type: 'Feature',
            properties: {
                id: edgeId,
                type: 'road'
            },
            geometry: {
                type: 'Polygon',
                coordinates: [polygonCoords]
            }
        });
        
        // Check if this is a bidirectional road
        const oppositeEdge = findOppositeEdge(edgeId);
        const isBidirectional = oppositeEdge !== null;
        
        // Create lane marking lines (dashed lines between lanes)
        let cumulativeWidth = 0;
        for (let lane = 0; lane < edge.nLane - 1; lane++) {
            cumulativeWidth += edge.laneWidths[lane];
            
            const laneLineCoords = [];
            for (let i = 0; i < points.length; i++) {
                let point = points[i];
                let perpDir;
                
                if (i === 0 && !from.virtual && from.width) {
                    point = movePointToward(points[0], points[1], from.width);
                    perpDir = getPerpendicular(points[0], points[1]);
                } else if (i === points.length - 1 && !to.virtual && to.width) {
                    point = movePointToward(points[i], points[i-1], to.width);
                    perpDir = getPerpendicular(points[i-1], points[i]);
                } else if (i === 0) {
                    perpDir = getPerpendicular(points[0], points[1]);
                } else if (i === points.length - 1) {
                    perpDir = getPerpendicular(points[i-1], points[i]);
                } else {
                    perpDir = getPerpendicular(points[i-1], points[i+1]);
                }
                
                const offsetLng = perpDir[0] * cumulativeWidth * CONFIG.COORD_SCALE.lng;
                const offsetLat = perpDir[1] * cumulativeWidth * CONFIG.COORD_SCALE.lat;
                
                laneLineCoords.push([point[0] + offsetLng, point[1] + offsetLat]);
            }
            
            laneLineFeatures.push({
                type: 'Feature',
                properties: {
                    id: `${edgeId}_lane_${lane}`,
                    type: 'lane-marking'
                },
                geometry: {
                    type: 'LineString',
                    coordinates: laneLineCoords
                }
            });
        }
        
        // Add center line for bidirectional roads (solid line to separate opposite directions)
        if (isBidirectional) {
            // Use leftCoords as the center line (edge of this direction's road, start of opposite direction)
            centerLineFeatures.push({
                type: 'Feature',
                properties: {
                    id: `${edgeId}_center`,
                    type: 'center-line'
                },
                geometry: {
                    type: 'LineString',
                    coordinates: leftCoords
                }
            });
        }
    }
    
    // Create GeoJSON features for nodes (intersections)
    const intersectionFeatures = [];
    for (const nodeId in nodes) {
        const node = nodes[nodeId];
        if (!node.virtual && node.outline) {
            const coordinates = [];
            
            // In CityFlow, outline coordinates are already in world space (not relative to node center)
            // The outline array is [x1, y1, x2, y2, ..., xn, yn]
            for (let i = 0; i < node.outline.length; i += 2) {
                const worldX = node.outline[i];
                const worldY = node.outline[i + 1];
                
                // Convert from CityFlow world coordinates to lng/lat
                // Note: Y is already flipped in convertCoords
                const coords = convertCoords([worldX, worldY]);
                coordinates.push(coords);
            }
            
            // Close the polygon if not already closed
            if (coordinates.length > 0) {
                const first = coordinates[0];
                const last = coordinates[coordinates.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    coordinates.push([...first]);
                }
            }
            
            intersectionFeatures.push({
                type: 'Feature',
                properties: {
                    id: nodeId,
                    type: 'intersection'
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            });
        }
    }
    
    // Add sources and layers to map
    
    // Intersections (filled polygons)
    map.addSource('intersections', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: intersectionFeatures
        }
    });
    
    map.addLayer({
        id: 'intersections',
        type: 'fill',
        source: 'intersections',
        paint: {
            'fill-color': CONFIG.COLORS.INTERSECTION,
            'fill-opacity': 1
        }
    });
    
    // Road polygons (filled areas)
    map.addSource('roads', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: roadPolygonFeatures
        }
    });
    
    map.addLayer({
        id: 'roads',
        type: 'fill',
        source: 'roads',
        paint: {
            'fill-color': CONFIG.COLORS.ROAD,
            'fill-opacity': 1
        }
    });
    
    // Center lines for bidirectional roads (solid lines)
    map.addSource('center-lines', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: centerLineFeatures
        }
    });
    
    map.addLayer({
        id: 'center-lines',
        type: 'line',
        source: 'center-lines',
        paint: {
            'line-color': '#FFD700',  // Yellow/gold color for center line
            'line-width': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                12, 1,
                15, 2,
                18, 4
            ],
            'line-opacity': 0.9
        }
    });
    
    // Lane markings (dashed lines)
    map.addSource('lane-markings', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: laneLineFeatures
        }
    });
    
    map.addLayer({
        id: 'lane-markings',
        type: 'line',
        source: 'lane-markings',
        paint: {
            'line-color': CONFIG.COLORS.LANE_INNER,
            'line-width': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                12, 0.5,
                15, 1.5,
                18, 2.5
            ],
            'line-dasharray': [4, 4],
            'line-opacity': 0.8
        }
    });
    
    // Fit map to road network bounds
    const allCoords = roadPolygonFeatures.flatMap(f => f.geometry.coordinates[0]);
    if (allCoords.length > 0) {
        const bounds = allCoords.reduce((bounds, coord) => {
            return bounds.extend(coord);
        }, new maplibregl.LngLatBounds(allCoords[0], allCoords[0]));
        
        map.fitBounds(bounds, {
            padding: 100,
            duration: 1000
        });
    }
}

/**
 * Move a point toward another point by a certain distance (in meters in CityFlow space)
 * Points are in lng/lat, distance is in CityFlow's meter units
 */
function movePointToward(from, to, distanceMeters) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return from;
    
    // Convert distance from CityFlow meters to lng/lat space
    // Use average of lng and lat scaling for diagonal movements
    const avgScale = (CONFIG.COORD_SCALE.lng + CONFIG.COORD_SCALE.lat) / 2;
    const distanceLngLat = distanceMeters * avgScale;
    
    const scale = distanceLngLat / length;
    return [
        from[0] + dx * scale,
        from[1] + dy * scale
    ];
}

/**
 * Initialize vehicle layer
 */
function initializeVehicleLayer() {
    map.addSource('vehicles', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    
    // Create vehicle icon (square with direction indicator)
    const size = 64;
    const vehicleCanvas = document.createElement('canvas');
    vehicleCanvas.width = size;
    vehicleCanvas.height = size;
    const ctx = vehicleCanvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Draw vehicle body (square - reduced by 40%)
    const vehicleSize = size * 0.36; // 0.6 * 0.6 = 0.36 (40% smaller)
    const centerX = size / 2;
    const centerY = size / 2;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.rect(
        centerX - vehicleSize / 2,
        centerY - vehicleSize / 2,
        vehicleSize,
        vehicleSize
    );
    ctx.fill();
    
    // Draw direction indicator (small triangle at front)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(centerX + vehicleSize / 2, centerY);
    ctx.lineTo(centerX + vehicleSize / 2 - 5, centerY - 4);
    ctx.lineTo(centerX + vehicleSize / 2 - 5, centerY + 4);
    ctx.closePath();
    ctx.fill();
    
    // Add outline for better visibility
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(
        centerX - vehicleSize / 2,
        centerY - vehicleSize / 2,
        vehicleSize,
        vehicleSize
    );
    ctx.stroke();
    
    map.addImage('vehicle', {
        width: size,
        height: size,
        data: ctx.getImageData(0, 0, size, size).data
    });
    
    // Add vehicle layer as symbols with rotation
    // Use exponential scaling to match road width perspective
    // Set minzoom to avoid displaying at very small zoom levels
    map.addLayer({
        id: 'vehicles',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 13,  // Don't show vehicles below zoom 13
        layout: {
            'icon-image': 'vehicle',
            'icon-size': [
                'interpolate',
                ['exponential', 2.5],  // More aggressive exponential
                ['zoom'],
                13, 0.01,    // Very small at zoom 13
                14, 0.05,
                15, 0.1,
                16, 0.2,
                17, 0.3,
                18, 0.5,     // Full size at zoom 18
                19, 0.7,
                20, 1.0
            ],
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: {
            'icon-color': ['get', 'color'],
            'icon-opacity': 0.85
        }
    });
}

/**
 * Initialize traffic light layer
 */
function initializeTrafficLightLayer() {
    // Build traffic light positions from edges
    trafficLights = {};
    
    for (const edgeId in edges) {
        const edge = edges[edgeId];
        const to = edge.to;
        const points = edge.points;
        
        // Only create traffic lights at real intersections (matching CityFlow logic)
        if (!to.virtual && points.length >= 2) {
            // Get the last segment direction
            const lastIdx = points.length - 1;
            const lastPoint = points[lastIdx];
            const prevPoint = points[lastIdx - 1];
            
            // Adjust endpoint for intersection width (matching CityFlow's moveAlongDirectTo)
            let adjustedEndpoint = lastPoint;
            if (to.width) {
                adjustedEndpoint = movePointToward(lastPoint, prevPoint, to.width);
            }
            
            // Calculate direction vector
            const dx = adjustedEndpoint[0] - prevPoint[0];
            const dy = adjustedEndpoint[1] - prevPoint[1];
            const segmentLength = Math.sqrt(dx * dx + dy * dy);
            
            if (segmentLength > 0) {
                // Get perpendicular direction using the same logic as road rendering
                const perpDir = getPerpendicular(prevPoint, adjustedEndpoint);
                
                // Create traffic light for each lane
                const lights = [];
                let prevOffset = 0;
                let offset = 0;
                
                for (let lane = 0; lane < edge.nLane; lane++) {
                    const laneWidth = edge.laneWidths[lane];
                    offset += laneWidth;
                    
                    // Position the light at the center of the lane
                    // This matches CityFlow's logic: pointB.moveAlong(pointBOffset, prevOffset)
                    const centerOffset = prevOffset + laneWidth / 2;
                    
                    const lightLng = adjustedEndpoint[0] + perpDir[0] * centerOffset * CONFIG.COORD_SCALE.lng;
                    const lightLat = adjustedEndpoint[1] + perpDir[1] * centerOffset * CONFIG.COORD_SCALE.lat;
                    
                    lights.push({
                        position: [lightLng, lightLat],
                        status: 'r',
                        laneWidth: laneWidth
                    });
                    
                    prevOffset = offset;
                }
                
                trafficLights[edgeId] = lights;
            }
        }
    }
    
    // Add line layer for traffic lights (more accurate representation)
    map.addSource('traffic-lights', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    
    map.addLayer({
        id: 'traffic-lights',
        type: 'circle',
        source: 'traffic-lights',
        minzoom: 13,  // Don't show traffic lights below zoom 13
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2.5],  // More aggressive exponential
                ['zoom'],
                13, 1,      // Very small at zoom 13
                14, 1.5,
                15, 2.5,
                16, 4.5,
                17, 7,
                18, 10      // Full size at zoom 18
            ],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['get', 'opacity'],
            'circle-stroke-width': [
                'interpolate',
                ['exponential', 2.5],
                ['zoom'],
                13, 0.3,
                15, 0.8,
                17, 1.2,
                18, 1.5
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': ['get', 'opacity']
        }
    });
}

/**
 * Start animation loop
 */
function startAnimation() {
    const animate = (timestamp) => {
        if (!isPlaying) return;
        
        // Calculate time delta
        if (!lastFrameTime) lastFrameTime = timestamp;
        const delta = timestamp - lastFrameTime;
        
        // Update every frame based on replay speed
        const frameInterval = 1000 / (60 * Math.pow(replaySpeed, 2));
        
        if (delta >= frameInterval) {
            updateStep(currentStep);
            currentStep = (currentStep + 1) % totalSteps;
            lastFrameTime = timestamp;
        }
        
        animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
}

/**
 * Update visualization for current step
 */
function updateStep(step) {
    if (!replayData || step >= replayData.length) return;
    
    const [carLogsStr, tlLogsStr] = replayData[step].split(';');
    
    // Update vehicles
    const carLogs = carLogsStr.split(',').filter(s => s.trim());
    const vehicleFeatures = [];
    
    carLogs.forEach((carLog, index) => {
        const parts = carLog.trim().split(' ');
        if (parts.length >= 7) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const angle = parseFloat(parts[2]);
            const id = parts[3];
            const laneChange = parseInt(parts[4]);
            const length = parseFloat(parts[5]);
            const width = parseFloat(parts[6]);
            
            const position = convertCoords([x, y]);
            const bearing = convertBearing(angle);
            const colorIndex = hashString(id) % CONFIG.COLORS.CAR.length;
            
            vehicleFeatures.push({
                type: 'Feature',
                properties: {
                    id: id,
                    bearing: bearing,
                    color: CONFIG.COLORS.CAR[colorIndex],
                    laneChange: laneChange
                },
                geometry: {
                    type: 'Point',
                    coordinates: position
                }
            });
        }
    });
    
    map.getSource('vehicles').setData({
        type: 'FeatureCollection',
        features: vehicleFeatures
    });
    
    // Update traffic lights
    const tlLogs = tlLogsStr.split(',').filter(s => s.trim());
    const trafficLightFeatures = [];
    
    tlLogs.forEach(tlLog => {
        const parts = tlLog.trim().split(' ');
        if (parts.length >= 2) {
            const edgeId = parts[0];
            const statuses = parts.slice(1);
            
            if (trafficLights[edgeId]) {
                trafficLights[edgeId].forEach((light, index) => {
                    if (index < statuses.length) {
                        const status = statuses[index];
                        let color = CONFIG.COLORS.LIGHT_GRAY;
                        let opacity = 1;
                        
                        if (status === 'r') {
                            color = CONFIG.COLORS.LIGHT_RED;
                        } else if (status === 'g') {
                            color = CONFIG.COLORS.LIGHT_GREEN;
                        } else if (status === 'i') {
                            opacity = 0;
                        }
                        
                        trafficLightFeatures.push({
                            type: 'Feature',
                            properties: {
                                id: `${edgeId}_${index}`,
                                color: color,
                                opacity: opacity,
                                status: status
                            },
                            geometry: {
                                type: 'Point',
                                coordinates: light.position
                            }
                        });
                    }
                });
            }
        }
    });
    
    map.getSource('traffic-lights').setData({
        type: 'FeatureCollection',
        features: trafficLightFeatures
    });
    
    // Update UI
    document.getElementById('car-num').textContent = vehicleFeatures.length;
    document.getElementById('current-step').textContent = step + 1;
    document.getElementById('progress').textContent = ((step / totalSteps) * 100).toFixed(1) + '%';
}

/**
 * Toggle pause/play
 */
function togglePause() {
    if (isPlaying) {
        pauseSimulation();
    } else {
        playSimulation();
    }
}

/**
 * Play simulation
 */
function playSimulation() {
    if (!replayData || totalSteps === 0) return;
    
    isPlaying = true;
    lastFrameTime = 0;
    startAnimation();
}

/**
 * Pause simulation
 */
function pauseSimulation() {
    isPlaying = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

/**
 * Stop simulation (reset to beginning)
 */
function stopSimulation() {
    isPlaying = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    currentStep = 0;
    lastFrameTime = 0;
    updateStep(currentStep);
}

/**
 * Adjust replay speed
 */
function adjustSpeed(delta) {
    replaySpeed = Math.max(0.01, Math.min(1, replaySpeed + delta));
    updateSpeedDisplay();
}

/**
 * Handle speed slider input
 */
function handleSpeedSlider(e) {
    replaySpeed = e.target.value / 100;
    updateSpeedDisplay();
}

/**
 * Update speed display
 */
function updateSpeedDisplay() {
    document.getElementById('speed-value').textContent = replaySpeed.toFixed(2) + 'x';
    document.getElementById('speed-slider').value = replaySpeed * 100;
}

/**
 * Step forward one frame
 */
function stepForward() {
    currentStep = (currentStep + 1) % totalSteps;
    updateStep(currentStep);
}

/**
 * Step backward one frame
 */
function stepBackward() {
    currentStep = (currentStep - 1 + totalSteps) % totalSteps;
    updateStep(currentStep);
}

/**
 * Hash string to integer (for consistent car colors)
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

/**
 * Log info message
 */
function logInfo(message) {
    const infoBox = document.getElementById('info-box');
    const p = document.createElement('p');
    p.textContent = '• ' + message;
    p.style.color = '#666';
    infoBox.appendChild(p);
    infoBox.scrollTop = infoBox.scrollHeight;
}

/**
 * Log error message
 */
function logError(message) {
    const infoBox = document.getElementById('info-box');
    const p = document.createElement('p');
    p.textContent = '✗ ' + message;
    p.style.color = '#d32f2f';
    infoBox.appendChild(p);
    infoBox.scrollTop = infoBox.scrollHeight;
}

/**
 * Clear info box
 */
function clearInfo() {
    document.getElementById('info-box').innerHTML = '';
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.add('active');
    } else {
        loading.classList.remove('active');
    }
}
