/**
 * CityVerse Traffic Flow Module
 * 
 * Integrates CityFlow simulation replay functionality into the main map
 * Manages road network visualization and vehicle animation
 */

class TrafficFlowManager {
  constructor(map) {
    this.map = map;
    this.isActive = false;
    this.roadnetData = null;
    this.replayData = null;
    this.currentStep = 0;
    this.totalSteps = 0;
    this.isPlaying = false;
    this.replaySpeed = 0.5;
    this.animationFrameId = null;
    this.lastFrameTime = 0;
    this.roadnetLoaded = false;
    
    // Data structures
    this.nodes = {};
    this.edges = {};
    this.trafficLights = {};
    
    // Coordinate transformation parameters
    // Adjust these if road network doesn't align with buildings/roads
    this.config = {
      // Map center - the origin (0,0) in CityFlow maps to this WGS84 coordinate
      MAP_CENTER: [-74.0184, 40.7013],
      
      // Coordinate scale - meters to degrees conversion
      COORD_SCALE: {
        lng: 1 / 85000,  // east-west (at latitude ~40°)
        lat: 1 / 111111  // north-south
      },
      
      // Rotation angle in degrees (clockwise positive)
      // Adjust this to align road network with real map
      ROTATION_DEGREES: -0.84,
      
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
    
    this.setupKeyboardShortcuts();
  }
  
  /**
   * Activate traffic flow visualization
   */
  async activate() {
    if (this.isActive) return;
    
    try {
      this.isActive = true;
      
      // Show control panel first (before loading)
      this.showControlPanel();
      
      // Show loading overlay
      this.showLoadingOverlay('Loading Road Network', 'Please wait while we load and process the road network data...');
      
      // Update status to loading
      this.updateRoadnetStatus('loading');
      
      // Hide the blue roads layer
      this.hideBaseRoadsLayer();
      
      // Give UI time to update before heavy processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Load roadnet_manhattan.json automatically
      await this.loadRoadnet('./data/roadnet_manhattan.json');
      
      // Hide loading overlay
      this.hideLoadingOverlay();
      
      console.log('✅ Traffic Flow activated');
    } catch (error) {
      console.error('❌ Error activating traffic flow:', error);
      this.hideLoadingOverlay();
      this.isActive = false;
      this.hideControlPanel();
      this.showBaseRoadsLayer();
      throw error;
    }
  }
  
  /**
   * Deactivate traffic flow visualization
   */
  deactivate() {
    if (!this.isActive) return;
    
    // Stop animation
    this.stopSimulation();
    
    // Clean up layers
    this.cleanupLayers();
    
    // Show the blue roads layer again
    this.showBaseRoadsLayer();
    
    // Hide control panel
    this.hideControlPanel();
    
    // Reset state
    this.roadnetLoaded = false;
    this.replayData = null;
    this.currentStep = 0;
    this.totalSteps = 0;
    
    this.isActive = false;
    console.log('✅ Traffic Flow deactivated');
  }
  
  /**
   * Load roadnet from URL
   */
  async loadRoadnet(url) {
    try {
      this.updateInfo('⬇️ Downloading road network data...', 'info');
      this.updateLoadingMessage('Downloading road network data...');
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load roadnet: ${response.statusText}`);
      
      this.updateInfo('📦 Parsing network data...', 'info');
      this.updateLoadingMessage('Parsing network data...');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.roadnetData = await response.json();
      
      this.updateInfo('🔄 Processing nodes and edges...', 'info');
      this.updateLoadingMessage('Processing road network structure...');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.processRoadnet();
      
      this.updateInfo('🎨 Rendering road network...', 'info');
      this.updateLoadingMessage('Rendering road network on map...');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.renderRoadnet();
      
      this.updateInfo('🚗 Initializing vehicle layer...', 'info');
      this.updateLoadingMessage('Setting up vehicle visualization...');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.initializeVehicleLayer();
      this.initializeTrafficLightLayer();
      
      this.roadnetLoaded = true;
      this.updateInfo('✅ Road network loaded successfully', 'success');
      this.updateRoadnetStatus('loaded');
    } catch (error) {
      this.updateInfo(`❌ Error loading roadnet: ${error.message}`, 'error');
      this.updateRoadnetStatus('error');
      throw error;
    }
  }
  
  /**
   * Load replay data from file
   */
  async loadReplayFile(file) {
    if (!this.roadnetLoaded) {
      this.updateInfo('Please wait for road network to load first', 'error');
      return;
    }
    
    try {
      this.updateInfo('Loading replay data...', 'info');
      
      const text = await this.readFile(file);
      this.replayData = text.trim().split('\n');
      this.totalSteps = this.replayData.length;
      
      this.updateInfo(`Replay loaded: ${this.totalSteps} steps`, 'success');
      this.updateStats();
      
      // Reset and start
      this.currentStep = 0;
      this.isPlaying = true;
      this.startAnimation();
      
      console.log('✅ Replay data loaded and started');
    } catch (error) {
      this.updateInfo(`Error loading replay: ${error.message}`, 'error');
      console.error(error);
    }
  }
  
  /**
   * Process roadnet data
   */
  processRoadnet() {
    const roadnet = this.roadnetData.static;
    
    // Process nodes
    this.nodes = {};
    roadnet.nodes.forEach(node => {
      this.nodes[node.id] = {
        ...node,
        point: this.convertCoords(node.point)
      };
    });
    
    // Process edges
    this.edges = {};
    roadnet.edges.forEach(edge => {
      this.edges[edge.id] = {
        ...edge,
        from: this.nodes[edge.from],
        to: this.nodes[edge.to],
        points: edge.points.map(p => this.convertCoords(p))
      };
    });
    
    console.log(`Processed ${Object.keys(this.nodes).length} nodes and ${Object.keys(this.edges).length} edges`);
  }
  
  /**
   * Convert CityFlow local coordinates to WGS84 lng/lat
   * Applies rotation, scaling, and translation
   */
  convertCoords(point) {
    const x = point[0];
    const y = point[1];
    
    // Apply rotation
    const rotRad = this.config.ROTATION_DEGREES * (Math.PI / 180);
    const cosRot = Math.cos(rotRad);
    const sinRot = Math.sin(rotRad);
    
    const xRot = x * cosRot - y * sinRot;
    const yRot = x * sinRot + y * cosRot;
    
    // Apply scaling and translation
    const lng = this.config.MAP_CENTER[0] + xRot * this.config.COORD_SCALE.lng;
    const lat = this.config.MAP_CENTER[1] + yRot * this.config.COORD_SCALE.lat;
    
    return [lng, lat];
  }
  
  /**
   * Convert bearing from CityFlow to MapLibre
   */
  convertBearing(angle) {
    const degrees = angle * (180 / Math.PI);
    return (90 + degrees + 360) % 360;
  }
  
  /**
   * Calculate perpendicular offset direction
   */
  getPerpendicular(fromPoint, toPoint) {
    const dx = toPoint[0] - fromPoint[0];
    const dy = toPoint[1] - fromPoint[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return [0, 0];
    
    return [dy / length, -dx / length];
  }
  
  /**
   * Check if two edges form a bidirectional road
   */
  isBidirectionalRoad(edge1, edge2) {
    return (edge1.from.id === edge2.to.id && edge1.to.id === edge2.from.id);
  }
  
  /**
   * Find the opposite direction edge
   */
  findOppositeEdge(edgeId) {
    const edge = this.edges[edgeId];
    for (const otherEdgeId in this.edges) {
      if (otherEdgeId !== edgeId) {
        const otherEdge = this.edges[otherEdgeId];
        if (this.isBidirectionalRoad(edge, otherEdge)) {
          return otherEdge;
        }
      }
    }
    return null;
  }
  
  /**
   * Render roadnet on map
   */
  renderRoadnet() {
    const roadPolygonFeatures = [];
    const laneLineFeatures = [];
    const centerLineFeatures = [];
    
    for (const edgeId in this.edges) {
      const edge = this.edges[edgeId];
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
        
        if (i === 0 && !from.virtual && from.width) {
          point = this.movePointToward(points[0], points[1], from.width);
          perpDir = this.getPerpendicular(points[0], points[1]);
        } else if (i === points.length - 1 && !to.virtual && to.width) {
          point = this.movePointToward(points[i], points[i-1], to.width);
          perpDir = this.getPerpendicular(points[i-1], points[i]);
        } else if (i === 0) {
          perpDir = this.getPerpendicular(points[0], points[1]);
        } else if (i === points.length - 1) {
          perpDir = this.getPerpendicular(points[i-1], points[i]);
        } else {
          perpDir = this.getPerpendicular(points[i-1], points[i+1]);
        }
        
        const offsetLng = perpDir[0] * roadWidth * this.config.COORD_SCALE.lng;
        const offsetLat = perpDir[1] * roadWidth * this.config.COORD_SCALE.lat;
        
        leftCoords.push([point[0], point[1]]);
        rightCoords.push([point[0] + offsetLng, point[1] + offsetLat]);
      }
      
      const polygonCoords = [...leftCoords, ...rightCoords.reverse(), leftCoords[0]];
      
      roadPolygonFeatures.push({
        type: 'Feature',
        properties: { id: edgeId, type: 'road' },
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoords]
        }
      });
      
      // Check if bidirectional
      const oppositeEdge = this.findOppositeEdge(edgeId);
      const isBidirectional = oppositeEdge !== null;
      
      // Create lane marking lines
      let cumulativeWidth = 0;
      for (let lane = 0; lane < edge.nLane - 1; lane++) {
        cumulativeWidth += edge.laneWidths[lane];
        
        const laneLineCoords = [];
        for (let i = 0; i < points.length; i++) {
          let point = points[i];
          let perpDir;
          
          if (i === 0 && !from.virtual && from.width) {
            point = this.movePointToward(points[0], points[1], from.width);
            perpDir = this.getPerpendicular(points[0], points[1]);
          } else if (i === points.length - 1 && !to.virtual && to.width) {
            point = this.movePointToward(points[i], points[i-1], to.width);
            perpDir = this.getPerpendicular(points[i-1], points[i]);
          } else if (i === 0) {
            perpDir = this.getPerpendicular(points[0], points[1]);
          } else if (i === points.length - 1) {
            perpDir = this.getPerpendicular(points[i-1], points[i]);
          } else {
            perpDir = this.getPerpendicular(points[i-1], points[i+1]);
          }
          
          const offsetLng = perpDir[0] * cumulativeWidth * this.config.COORD_SCALE.lng;
          const offsetLat = perpDir[1] * cumulativeWidth * this.config.COORD_SCALE.lat;
          
          laneLineCoords.push([point[0] + offsetLng, point[1] + offsetLat]);
        }
        
        laneLineFeatures.push({
          type: 'Feature',
          properties: { id: `${edgeId}_lane_${lane}`, type: 'lane-marking' },
          geometry: {
            type: 'LineString',
            coordinates: laneLineCoords
          }
        });
      }
      
      // Add center line for bidirectional roads
      if (isBidirectional) {
        centerLineFeatures.push({
          type: 'Feature',
          properties: { id: `${edgeId}_center`, type: 'center-line' },
          geometry: {
            type: 'LineString',
            coordinates: leftCoords
          }
        });
      }
    }
    
    // Create intersection features
    const intersectionFeatures = [];
    for (const nodeId in this.nodes) {
      const node = this.nodes[nodeId];
      if (!node.virtual && node.outline) {
        const coordinates = [];
        
        for (let i = 0; i < node.outline.length; i += 2) {
          const worldX = node.outline[i];
          const worldY = node.outline[i + 1];
          const coords = this.convertCoords([worldX, worldY]);
          coordinates.push(coords);
        }
        
        if (coordinates.length > 0) {
          const first = coordinates[0];
          const last = coordinates[coordinates.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            coordinates.push([...first]);
          }
        }
        
        intersectionFeatures.push({
          type: 'Feature',
          properties: { id: nodeId, type: 'intersection' },
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates]
          }
        });
      }
    }
    
    // Add sources and layers to map
    this.map.addSource('tf-intersections', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: intersectionFeatures
      }
    });
    
    this.map.addLayer({
      id: 'tf-intersections',
      type: 'fill',
      source: 'tf-intersections',
      paint: {
        'fill-color': this.config.COLORS.INTERSECTION,
        'fill-opacity': 1
      }
    });
    
    this.map.addSource('tf-roads', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: roadPolygonFeatures
      }
    });
    
    this.map.addLayer({
      id: 'tf-roads',
      type: 'fill',
      source: 'tf-roads',
      paint: {
        'fill-color': this.config.COLORS.ROAD,
        'fill-opacity': 1
      }
    });
    
    this.map.addSource('tf-center-lines', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: centerLineFeatures
      }
    });
    
    this.map.addLayer({
      id: 'tf-center-lines',
      type: 'line',
      source: 'tf-center-lines',
      paint: {
        'line-color': '#FFD700',
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
    
    this.map.addSource('tf-lane-markings', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: laneLineFeatures
      }
    });
    
    this.map.addLayer({
      id: 'tf-lane-markings',
      type: 'line',
      source: 'tf-lane-markings',
      paint: {
        'line-color': this.config.COLORS.LANE_INNER,
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
      
      this.map.fitBounds(bounds, {
        padding: 100,
        duration: 1000
      });
    }
  }
  
  /**
   * Move a point toward another point by a certain distance
   */
  movePointToward(from, to, distanceMeters) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return from;
    
    const avgScale = (this.config.COORD_SCALE.lng + this.config.COORD_SCALE.lat) / 2;
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
  initializeVehicleLayer() {
    this.map.addSource('tf-vehicles', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
    
    // Create vehicle icon
    const size = 64;
    const vehicleCanvas = document.createElement('canvas');
    vehicleCanvas.width = size;
    vehicleCanvas.height = size;
    const ctx = vehicleCanvas.getContext('2d');
    
    ctx.clearRect(0, 0, size, size);
    
    const vehicleSize = size * 0.36;
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
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(centerX + vehicleSize / 2, centerY);
    ctx.lineTo(centerX + vehicleSize / 2 - 5, centerY - 4);
    ctx.lineTo(centerX + vehicleSize / 2 - 5, centerY + 4);
    ctx.closePath();
    ctx.fill();
    
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
    
    this.map.addImage('tf-vehicle', {
      width: size,
      height: size,
      data: ctx.getImageData(0, 0, size, size).data
    });
    
    this.map.addLayer({
      id: 'tf-vehicles',
      type: 'symbol',
      source: 'tf-vehicles',
      minzoom: 13,
      layout: {
        'icon-image': 'tf-vehicle',
        'icon-size': [
          'interpolate',
          ['exponential', 2.5],
          ['zoom'],
          13, 0.01,
          14, 0.05,
          15, 0.1,
          16, 0.2,
          17, 0.3,
          18, 0.5,
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
  initializeTrafficLightLayer() {
    // Build traffic light positions
    this.trafficLights = {};
    
    for (const edgeId in this.edges) {
      const edge = this.edges[edgeId];
      const to = edge.to;
      const points = edge.points;
      
      if (!to.virtual && points.length >= 2) {
        const lastIdx = points.length - 1;
        const lastPoint = points[lastIdx];
        const prevPoint = points[lastIdx - 1];
        
        let adjustedEndpoint = lastPoint;
        if (to.width) {
          adjustedEndpoint = this.movePointToward(lastPoint, prevPoint, to.width);
        }
        
        const dx = adjustedEndpoint[0] - prevPoint[0];
        const dy = adjustedEndpoint[1] - prevPoint[1];
        const segmentLength = Math.sqrt(dx * dx + dy * dy);
        
        if (segmentLength > 0) {
          const perpDir = this.getPerpendicular(prevPoint, adjustedEndpoint);
          
          const lights = [];
          let prevOffset = 0;
          let offset = 0;
          
          for (let lane = 0; lane < edge.nLane; lane++) {
            const laneWidth = edge.laneWidths[lane];
            offset += laneWidth;
            
            const centerOffset = prevOffset + laneWidth / 2;
            
            const lightLng = adjustedEndpoint[0] + perpDir[0] * centerOffset * this.config.COORD_SCALE.lng;
            const lightLat = adjustedEndpoint[1] + perpDir[1] * centerOffset * this.config.COORD_SCALE.lat;
            
            lights.push({
              position: [lightLng, lightLat],
              status: 'r',
              laneWidth: laneWidth
            });
            
            prevOffset = offset;
          }
          
          this.trafficLights[edgeId] = lights;
        }
      }
    }
    
    this.map.addSource('tf-traffic-lights', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
    
    this.map.addLayer({
      id: 'tf-traffic-lights',
      type: 'circle',
      source: 'tf-traffic-lights',
      minzoom: 13,
      paint: {
        'circle-radius': [
          'interpolate',
          ['exponential', 2.5],
          ['zoom'],
          13, 1,
          14, 1.5,
          15, 2.5,
          16, 4.5,
          17, 7,
          18, 10
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
  startAnimation() {
    const animate = (timestamp) => {
      if (!this.isPlaying) return;
      
      if (!this.lastFrameTime) this.lastFrameTime = timestamp;
      const delta = timestamp - this.lastFrameTime;
      
      const frameInterval = 1000 / (60 * Math.pow(this.replaySpeed, 2));
      
      if (delta >= frameInterval) {
        this.updateStep(this.currentStep);
        this.currentStep = (this.currentStep + 1) % this.totalSteps;
        this.lastFrameTime = timestamp;
      }
      
      this.animationFrameId = requestAnimationFrame(animate);
    };
    
    this.animationFrameId = requestAnimationFrame(animate);
  }
  
  /**
   * Update visualization for current step
   */
  updateStep(step) {
    if (!this.replayData || step >= this.replayData.length) return;
    
    const [carLogsStr, tlLogsStr] = this.replayData[step].split(';');
    
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
        
        const position = this.convertCoords([x, y]);
        const bearing = this.convertBearing(angle);
        const colorIndex = this.hashString(id) % this.config.COLORS.CAR.length;
        
        vehicleFeatures.push({
          type: 'Feature',
          properties: {
            id: id,
            bearing: bearing,
            color: this.config.COLORS.CAR[colorIndex]
          },
          geometry: {
            type: 'Point',
            coordinates: position
          }
        });
      }
    });
    
    this.map.getSource('tf-vehicles').setData({
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
        
        if (this.trafficLights[edgeId]) {
          this.trafficLights[edgeId].forEach((light, index) => {
            if (index < statuses.length) {
              const status = statuses[index];
              let color = this.config.COLORS.LIGHT_GRAY;
              let opacity = 1;
              
              if (status === 'r') {
                color = this.config.COLORS.LIGHT_RED;
              } else if (status === 'g') {
                color = this.config.COLORS.LIGHT_GREEN;
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
    
    this.map.getSource('tf-traffic-lights').setData({
      type: 'FeatureCollection',
      features: trafficLightFeatures
    });
    
    // Update UI
    this.updateStats(vehicleFeatures.length, step);
  }
  
  /**
   * Play simulation
   */
  playSimulation() {
    if (!this.replayData || this.totalSteps === 0) return;
    
    this.isPlaying = true;
    this.lastFrameTime = 0;
    this.startAnimation();
  }
  
  /**
   * Pause simulation
   */
  pauseSimulation() {
    this.isPlaying = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Stop simulation (reset to beginning)
   */
  stopSimulation() {
    this.isPlaying = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.currentStep = 0;
    this.lastFrameTime = 0;
    if (this.replayData) {
      this.updateStep(this.currentStep);
    }
  }
  
  /**
   * Step forward one frame
   */
  stepForward() {
    if (!this.replayData) return;
    this.currentStep = (this.currentStep + 1) % this.totalSteps;
    this.updateStep(this.currentStep);
  }
  
  /**
   * Step backward one frame
   */
  stepBackward() {
    if (!this.replayData) return;
    this.currentStep = (this.currentStep - 1 + this.totalSteps) % this.totalSteps;
    this.updateStep(this.currentStep);
  }
  
  /**
   * Adjust replay speed
   */
  adjustSpeed(delta) {
    this.replaySpeed = Math.max(0.01, Math.min(1, this.replaySpeed + delta));
    this.updateSpeedDisplay();
  }
  
  /**
   * Set replay speed from slider
   */
  setSpeed(value) {
    this.replaySpeed = value / 100;
    this.updateSpeedDisplay();
  }
  
  /**
   * Clean up all traffic flow layers
   */
  cleanupLayers() {
    const layersToRemove = ['tf-vehicles', 'tf-traffic-lights', 'tf-lane-markings', 'tf-center-lines', 'tf-roads', 'tf-intersections'];
    const sourcesToRemove = ['tf-vehicles', 'tf-traffic-lights', 'tf-lane-markings', 'tf-center-lines', 'tf-roads', 'tf-intersections'];
    
    layersToRemove.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    
    sourcesToRemove.forEach(sourceId => {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    });
    
    // Remove vehicle image
    if (this.map.hasImage('tf-vehicle')) {
      this.map.removeImage('tf-vehicle');
    }
    
    this.nodes = {};
    this.edges = {};
    this.trafficLights = {};
    this.currentStep = 0;
  }
  
  /**
   * Hide base roads layer
   */
  hideBaseRoadsLayer() {
    const roadsLayers = ['roads', 'roads-outline', 'roads-label'];
    roadsLayers.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });
  }
  
  /**
   * Show base roads layer
   */
  showBaseRoadsLayer() {
    const roadsLayers = ['roads', 'roads-outline', 'roads-label'];
    roadsLayers.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', 'visible');
      }
    });
  }
  
  /**
   * Show control panel
   */
  showControlPanel() {
    const panel = document.getElementById('tf-control-panel');
    if (panel) {
      panel.style.display = 'block';
    }
  }
  
  /**
   * Hide control panel
   */
  hideControlPanel() {
    const panel = document.getElementById('tf-control-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  }
  
  /**
   * Update roadnet status display
   */
  updateRoadnetStatus(status) {
    const statusEl = document.getElementById('tf-roadnet-status');
    if (statusEl) {
      if (status === 'loaded' || status === true) {
        statusEl.innerHTML = '<span style="color: #10b981; font-weight: 600;">✓ Loaded</span>';
      } else if (status === 'loading') {
        statusEl.innerHTML = '<span style="color: #3b82f6; font-weight: 600;"><span class="loading-spinner"></span>Loading...</span>';
      } else if (status === 'error') {
        statusEl.innerHTML = '<span style="color: #dc2626; font-weight: 600;">✗ Error</span>';
      } else {
        statusEl.innerHTML = '<span style="color: #6b7280;">⊗ Not loaded</span>';
      }
    }
  }
  
  /**
   * Update stats display
   */
  updateStats(vehicleCount = 0, step = null) {
    const carNumEl = document.getElementById('tf-car-num');
    const currentStepEl = document.getElementById('tf-current-step');
    const totalStepsEl = document.getElementById('tf-total-steps');
    const progressEl = document.getElementById('tf-progress');
    
    if (carNumEl) carNumEl.textContent = vehicleCount;
    if (currentStepEl) currentStepEl.textContent = step !== null ? step + 1 : this.currentStep + 1;
    if (totalStepsEl) totalStepsEl.textContent = this.totalSteps;
    if (progressEl && this.totalSteps > 0) {
      progressEl.textContent = ((this.currentStep / this.totalSteps) * 100).toFixed(1) + '%';
    }
  }
  
  /**
   * Update speed display
   */
  updateSpeedDisplay() {
    const speedValueEl = document.getElementById('tf-speed-value');
    const speedSliderEl = document.getElementById('tf-speed-slider');
    
    if (speedValueEl) speedValueEl.textContent = this.replaySpeed.toFixed(2) + 'x';
    if (speedSliderEl) speedSliderEl.value = this.replaySpeed * 100;
  }
  
  /**
   * Update info message
   */
  updateInfo(message, type = 'info') {
    const infoEl = document.getElementById('tf-info');
    if (infoEl) {
      const color = type === 'error' ? '#dc2626' : type === 'success' ? '#10b981' : '#6b7280';
      const icon = type === 'error' ? '✗' : type === 'success' ? '✓' : '•';
      infoEl.innerHTML = `<p style="color: ${color}; margin: 5px 0;">${icon} ${message}</p>`;
    }
  }
  
  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    this.keyboardHandler = (e) => {
      if (!this.isActive) return;
      
      // Prevent shortcuts if user is typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      if (e.key === ' ') {
        e.preventDefault();
        if (this.isPlaying) this.pauseSimulation();
        else this.playSimulation();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.stopSimulation();
      } else if (e.key === '[' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.stepBackward();
      } else if (e.key === ']' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.stepForward();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.adjustSpeed(-0.1);
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        this.adjustSpeed(0.1);
      }
    };
    
    document.addEventListener('keydown', this.keyboardHandler);
  }
  
  /**
   * Read file as text
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }
  
  /**
   * Hash string to integer
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
  
  /**
   * Show loading overlay
   */
  showLoadingOverlay(title, message) {
    // Remove existing overlay if any
    this.hideLoadingOverlay();
    
    const overlay = document.createElement('div');
    overlay.id = 'tf-loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-message">
        <div class="spinner"></div>
        <h4>${title}</h4>
        <p>${message}</p>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  
  /**
   * Hide loading overlay
   */
  hideLoadingOverlay() {
    const overlay = document.getElementById('tf-loading-overlay');
    if (overlay) {
      overlay.remove();
    }
  }
  
  /**
   * Update loading message
   */
  updateLoadingMessage(message) {
    const overlay = document.getElementById('tf-loading-overlay');
    if (overlay) {
      const messageEl = overlay.querySelector('p');
      if (messageEl) {
        messageEl.textContent = message;
      }
    }
  }
}
