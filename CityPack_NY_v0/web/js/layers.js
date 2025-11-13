/**
 * CityVerse Layer Management Module
 * 图层管理和控制逻辑
 */

class LayerManager {
  constructor(map) {
    this.map = map;
    this.activeOverlays = new Set();
    this.popups = new Map();
    this.filters = new Map();
    this.taxiHourlyData = null;  // Store hourly taxi data
    this.taxiDailyData = null;   // Store daily demand by date
    this.selectedTaxiDate = '2024-01-01';  // Current selected date
    this.weatherData = null;     // Store weather data
    this.selectedWeatherDate = '2024-01-01';  // Current selected weather date
  }

  /**
   * 设置图层可见性
   */
  setLayersVisibility(layerIds, visible) {
    const vis = visible ? 'visible' : 'none';
    layerIds.forEach(id => {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', vis);
      }
    });
  }

  /**
   * 确保图层在加载时隐藏
   */
  ensureHiddenOnLoad(layerIds) {
    layerIds.forEach(id => {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', 'none');
      }
    });
  }

  /**
   * 切换图层状态
   */
  toggleLayer(layerId, enabled) {
    const config = window.cityVerseConfig.getLayerConfig(layerId);
    if (!config) return;

    this.setLayersVisibility(config.layerIds, enabled);

    if (enabled) {
      this.activeOverlays.add(layerId);
      this.enableLayer(layerId, config);
    } else {
      this.activeOverlays.delete(layerId);
      this.disableLayer(layerId, config);
    }
  }

  /**
   * 启用图层
   */
  enableLayer(layerId, config) {
    // 绑定弹窗
    if (config.hasPopup) {
      this.bindLayerPopup(layerId, config);
    }

    // 设置时间控制
    if (config.hasTimeControl) {
      this.setupTimeControl(layerId, config);
    }
    
    // 加载taxi数据
    if (layerId === 'taxiDemand') {
      if (!this.taxiHourlyData) {
        this.loadTaxiHourlyData();
      }
      if (!this.taxiDailyData) {
        this.loadTaxiDailyData();
      }
    }

    // 设置过滤器
    if (config.hasFilters) {
      this.setupFilters(layerId, config);
    }

    // 特殊处理
    switch (layerId) {
      case 'imageViewer':
        // 图像查看器已在主文件中设置
        break;
      case 'trafficFlow':
        // 激活 Traffic Flow
        if (window.app && window.app.trafficFlow) {
          window.app.trafficFlow.activate();
        }
        break;
      case 'weather':
        // 加载天气数据
        if (!this.weatherData) {
          this.loadWeatherData();
        } else {
          this.updateWeatherDisplay(this.selectedWeatherDate);
          this.showWeatherBar();
        }
        break;
    }
  }

  /**
   * 禁用图层
   */
  disableLayer(layerId, config) {
    // 清理时间控制
    if (config.hasTimeControl) {
      this.clearTimeControl(layerId, config);
    }

    // 清理过滤器
    if (config.hasFilters) {
      this.clearFilters(layerId, config);
    }

    // 关闭相关弹窗
    const popup = this.popups.get(layerId);
    if (popup && popup.isOpen()) {
      popup.remove();
    }
    
    // 特殊处理
    if (layerId === 'trafficFlow') {
      if (window.app && window.app.trafficFlow) {
        window.app.trafficFlow.deactivate();
      }
    } else if (layerId === 'weather') {
      this.hideWeatherBar();
    }
  }

  /**
   * 绑定图层弹窗
   */
  bindLayerPopup(layerId, config) {
    const popupKey = `${layerId}_popup_bound`;
    if (this.map[popupKey]) return;

    const popupOptions = { closeButton: true, closeOnClick: true };
    if (layerId === 'taxiDemand') {
      popupOptions.className = 'taxi-demand-popup';
    }
    const popup = new maplibregl.Popup(popupOptions);
    this.popups.set(layerId, popup);

    // 根据图层类型绑定不同的点击事件
    config.layerIds.forEach(actualLayerId => {
      if (this.map.getLayer(actualLayerId)) {
        this.map.on('click', actualLayerId, (e) => {
          this.showLayerPopup(layerId, config, e, popup);
        });
      }
    });

    this.map[popupKey] = true;
  }

  /**
   * 显示图层弹窗
   */
  showLayerPopup(layerId, config, event, popup) {
    const feature = event.features?.[0];
    if (!feature) return;

    const properties = feature.properties || {};
    const { lng, lat } = event.lngLat;

    let content = '';

    switch (layerId) {
      case 'tracts':
        content = this.generateTractPopupContent(properties, lng, lat);
        break;
      case 'crime':
        content = this.generateCrimePopupContent(properties, lng, lat);
        break;
      case 'crime2024':
        content = this.generateCrime2024PopupContent(properties, lng, lat);
        break;
      case 'poi':
        content = this.generatePOIPopupContent(properties, lng, lat);
        break;
      case 'taxiDemand':
        content = this.generateTaxiDemandPopupContent(properties, lng, lat);
        break;
      default:
        content = this.generateGenericPopupContent(properties, lng, lat);
    }

    popup.setLngLat(event.lngLat).setHTML(content).addTo(this.map);
  }

  /**
   * 生成人口普查区域弹窗内容
   */
  generateTractPopupContent(props, lng, lat) {
    return `
      <div style="min-width:240px">
        <div style="font-weight:600;margin-bottom:4px;"><b>${props.NAME || 'Census Tract'}</b></div>
        <div>GEOID: ${props.GEOID || ''}</div>
        <div>Population: ${Number(props.population||0).toLocaleString()}</div>
        <div>Area: ${Number(props.area_km2||0).toFixed(3)} km²</div>
        <div>Density: ${Number(props.density_km2||0).toLocaleString()} /km²</div>
        <div style="border-top:1px solid #eee;margin:8px 0;"></div>
        <div style="font-weight:600;margin-bottom:4px;">Coordinates</div>
        <div>Lon: ${lng.toFixed(6)}<br/>Lat: ${lat.toFixed(6)}</div>
      </div>
    `;
  }

  /**
   * 生成犯罪数据弹窗内容
   */
  generateCrimePopupContent(props, lng, lat) {
    return `
      <div style="min-width:240px">
        <div style="font-weight:600;margin-bottom:4px;"><b>Crime Report</b></div>
        <div>ID: ${props.complaint_id || ''}</div>
        <div>Date: ${props.year}/${props.month}/${props.day}</div>
        <div>Category: <span style="color:${props.color || '#666'}">${props.crime_category || 'Unknown'}</span></div>
        <div>Description: ${props.description || 'N/A'}</div>
        <div>Precinct: ${props.precinct || 'Unknown'}</div>
        <div style="border-top:1px solid #eee;margin:8px 0;"></div>
        <div style="font-weight:600;margin-bottom:4px;">Coordinates</div>
        <div>Lon: ${lng.toFixed(6)}<br/>Lat: ${lat.toFixed(6)}</div>
      </div>
    `;
  }

  /**
   * 生成2024年犯罪数据弹窗内容
   */
  generateCrime2024PopupContent(props, lng, lat) {
    return `
      <div style="min-width:240px">
        <div style="font-weight:600;margin-bottom:4px;"><b>2024 Crime Report - Week ${props.week || props.time_group}</b></div>
        <div>ID: ${props.complaint_id || ''}</div>
        <div>Date: ${props.year}/${props.month}/${props.day}</div>
        <div>Week: ${props.week || props.time_group} (${props.time_group_label || ''})</div>
        <div>Category: <span style="color:${props.color || '#666'}">${props.crime_category || 'Unknown'}</span></div>
        <div>Description: ${props.description || 'N/A'}</div>
        <div>Precinct: ${props.precinct || 'Unknown'}</div>
        <div style="border-top:1px solid #eee;margin:8px 0;"></div>
        <div style="font-weight:600;margin-bottom:4px;">Coordinates</div>
        <div>Lon: ${lng.toFixed(6)}<br/>Lat: ${lat.toFixed(6)}</div>
      </div>
    `;
  }

  /**
   * 生成POI弹窗内容
   */
  generatePOIPopupContent(props, lng, lat) {
    const poiCategories = window.cityVerseConfig.getPOICategories();
    const categoryInfo = poiCategories[props.poi_category] || {};

    return `
      <div style="min-width:240px">
        <div style="font-weight:600;margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:16px;">${categoryInfo.icon || '📍'}</span>
          <b>${props.display_name || props.name || 'POI'}</b>
        </div>
        <div>Category: <span style="color:${categoryInfo.color || '#666'}">${props.poi_category || 'Unknown'}</span></div>
        <div>Building Type: ${props.building_type || props.building || 'N/A'}</div>
        <div>ID: ${props.id || 'N/A'}</div>
        <div style="border-top:1px solid #eee;margin:8px 0;"></div>
        <div style="font-weight:600;margin-bottom:4px;">Coordinates</div>
        <div>Lon: ${lng.toFixed(6)}<br/>Lat: ${lat.toFixed(6)}</div>
      </div>
    `;
  }

  /**
   * 生成出租车需求弹窗内容（带24小时曲线图）
   */
  generateTaxiDemandPopupContent(props, lng, lat) {
    const zoneName = props.Zone || 'Unknown Zone';
    const zoneId = props.LocationID;
    const selectedDate = this.selectedTaxiDate;
    
    // 获取该zone在选定日期的24小时数据
    const hourlyData = this.getTaxiHourlyDataForZone(zoneId, selectedDate);
    
    if (!hourlyData || hourlyData.length === 0) {
      return `
        <div style="padding:14px;box-sizing:border-box;">
          <div style="font-weight:600;margin-bottom:6px;">
            <span style="font-size:16px;">🚕</span> ${zoneName}
          </div>
          <div style="color:#666;padding:20px;text-align:center;">
            No data available for ${selectedDate}
          </div>
        </div>
      `;
    }
    
    // 计算当天总需求
    const dailyPickup = hourlyData.reduce((sum, h) => sum + h.pickup, 0);
    const dailyDropoff = hourlyData.reduce((sum, h) => sum + h.dropoff, 0);
    
    // 生成24小时曲线图SVG
    const chartSVG = this.generate24HourChart(hourlyData);
    
    return `
      <div style="padding:14px;box-sizing:border-box;">
        <div style="font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <span style="font-size:16px;">🚕</span>
          <b style="font-size:14px;">${zoneName}</b>
        </div>
        
        <div style="background:#f0f9ff;padding:10px;border-radius:6px;margin-bottom:10px;box-sizing:border-box;">
          <div style="font-size:11px;color:#0369a1;font-weight:600;margin-bottom:6px;">
            📅 ${selectedDate}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <div style="font-size:11px;color:#666;">Pickups</div>
              <div style="font-size:17px;font-weight:700;color:#2563eb;">↑ ${dailyPickup.toLocaleString()}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#666;">Dropoffs</div>
              <div style="font-size:17px;font-weight:700;color:#dc2626;">↓ ${dailyDropoff.toLocaleString()}</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom:10px;">
          <div style="font-weight:600;font-size:12px;margin-bottom:6px;color:#333;">
            📈 24-Hour Demand Pattern (Pickups)
          </div>
          <div style="width:100%;overflow:hidden;box-sizing:border-box;">
            ${chartSVG}
          </div>
        </div>
        
        <div style="font-size:10px;color:#666;border-top:1px solid #e5e7eb;padding-top:6px;">
          Zone ID: ${zoneId} • ${props.service_zone || 'N/A'}
        </div>
      </div>
    `;
  }
  
  /**
   * 生成24小时需求曲线图（简化的柱状图）
   */
  generate24HourChart(hourlyData) {
    const width = 412;
    const height = 110;
    const margin = {top: 8, right: 8, bottom: 18, left: 8};
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    const maxPickup = Math.max(...hourlyData.map(h => h.pickup), 1);
    const barWidth = chartWidth / 24;
    
    // 每2小时一个刻度标签
    const xLabels = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
    
    const bars = hourlyData.map((h, i) => {
      const barHeight = (h.pickup / maxPickup) * chartHeight;
      const x = margin.left + i * barWidth;
      const y = margin.top + chartHeight - barHeight;
      const color = h.pickup > maxPickup * 0.7 ? '#dc2626' : 
                    h.pickup > maxPickup * 0.4 ? '#f59e0b' : '#3b82f6';
      
      return `<rect x="${x}" y="${y}" width="${barWidth - 2}" height="${barHeight}" 
                   fill="${color}" opacity="0.8" rx="1">
                <title>${h.hour}:00 - ${h.pickup} pickups</title>
              </rect>`;
    }).join('');
    
    const xAxisLabels = xLabels.map(hour => {
      const x = margin.left + hour * barWidth + barWidth / 2;
      return `<text x="${x}" y="${height - 5}" text-anchor="middle" 
                    font-size="10" fill="#666">${hour}</text>`;
    }).join('');
    
    return `
      <svg width="${width}" height="${height}" style="background:#fafafa;border-radius:4px;display:block;max-width:100%;">
        ${bars}
        <line x1="${margin.left}" y1="${height - margin.bottom}" 
              x2="${width - margin.right}" y2="${height - margin.bottom}" 
              stroke="#ddd" stroke-width="1"/>
        ${xAxisLabels}
      </svg>
    `;
  }
  
  /**
   * 获取指定zone和日期的24小时数据
   */
  getTaxiHourlyDataForZone(zoneId, date) {
    if (!this.taxiHourlyData || !this.taxiHourlyData[zoneId]) {
      return null;
    }
    return this.taxiHourlyData[zoneId][date] || null;
  }
  
  /**
   * 加载taxi hourly数据
   */
  async loadTaxiHourlyData() {
    try {
      const response = await fetch('./data/taxi_hourly_by_zone.json');
      this.taxiHourlyData = await response.json();
      console.log('✅ Taxi hourly data loaded');
    } catch (error) {
      console.error('❌ Failed to load taxi hourly data:', error);
    }
  }
  
  /**
   * 加载taxi daily数据（按日期）
   */
  async loadTaxiDailyData() {
    try {
      const response = await fetch('./data/taxi_daily_demand_by_date.json');
      this.taxiDailyData = await response.json();
      console.log('✅ Taxi daily data loaded');
      // 数据加载完成后，立即更新热力图
      if (this.selectedTaxiDate) {
        setTimeout(() => this.updateTaxiHeatmap(this.selectedTaxiDate), 500);
      }
    } catch (error) {
      console.error('❌ Failed to load taxi daily data:', error);
    }
  }
  
  /**
   * 根据选定日期更新出租车需求热力图
   */
  updateTaxiHeatmap(date) {
    if (!this.taxiDailyData || !this.map.getLayer('taxi-zones-fill')) {
      return;
    }
    
    const demandData = this.taxiDailyData[date];
    if (!demandData) {
      console.warn(`No data for date: ${date}`);
      return;
    }
    
    // 创建match表达式: ["match", ["get", "LocationID"], zone1, color1, zone2, color2, ..., defaultColor]
    const matchExpression = ['match', ['get', 'LocationID']];
    
    // 定义颜色阶梯（基于单日数据的百分位数）
    const getColor = (demand) => {
      if (demand === 0 || demand === undefined) return '#f0f0f0';
      if (demand < 120) return '#ffffcc';
      if (demand < 670) return '#ffeda0';
      if (demand < 1540) return '#fed976';
      if (demand < 3165) return '#feb24c';
      if (demand < 4560) return '#fd8d3c';
      if (demand < 6665) return '#fc4e2a';
      if (demand < 8300) return '#e31a1c';
      return '#bd0026';
    };
    
    // 为每个zone添加颜色映射
    Object.keys(demandData).forEach(zoneId => {
      const demand = demandData[zoneId];
      const color = getColor(demand);
      matchExpression.push(parseInt(zoneId), color);
    });
    
    // 默认颜色（如果zone没有数据）
    matchExpression.push('#e0e0e0');
    
    // 更新图层的fill-color属性
    this.map.setPaintProperty('taxi-zones-fill', 'fill-color', matchExpression);
    
    console.log(`✅ Updated heatmap for ${date}`);
  }

  /**
   * 生成通用弹窗内容
   */
  generateGenericPopupContent(props, lng, lat) {
    const propEntries = Object.entries(props).slice(0, 5); // 只显示前5个属性
    const propList = propEntries.map(([key, value]) => `<div>${key}: ${value}</div>`).join('');

    return `
      <div style="min-width:240px">
        <div style="font-weight:600;margin-bottom:4px;"><b>Feature Properties</b></div>
        ${propList}
        <div style="border-top:1px solid #eee;margin:8px 0;"></div>
        <div style="font-weight:600;margin-bottom:4px;">Coordinates</div>
        <div>Lon: ${lng.toFixed(6)}<br/>Lat: ${lat.toFixed(6)}</div>
      </div>
    `;
  }

  /**
   * 设置时间控制
   */
  setupTimeControl(layerId, config) {
    let controlId;
    if (config.timeControlType === 'year') {
      controlId = 'timeControl';
    } else if (config.timeControlType === 'week') {
      controlId = 'weeklyTimeControl';
    } else if (config.timeControlType === 'date') {
      // 根据layerId选择对应的控制器
      if (layerId === 'weather') {
        controlId = 'weatherDateControl';
      } else {
        controlId = 'taxiDateControl';
      }
    }
    
    const control = document.getElementById(controlId);
    if (control) {
      control.style.display = 'block';
      
      if (config.timeControlType === 'year') {
        this.setupYearControl(layerId, config);
      } else if (config.timeControlType === 'week') {
        this.setupWeekControl(layerId, config);
      } else if (config.timeControlType === 'date') {
        if (layerId === 'weather') {
          this.setupWeatherDateControl(layerId, config);
        } else {
          this.setupDateControl(layerId, config);
        }
      }
    }
  }

  /**
   * 设置年度控制
   */
  setupYearControl(layerId, config) {
    const slider = document.getElementById('yearSlider');
    const display = document.getElementById('yearDisplay');
    
    if (!slider || !display) return;

    const handler = (e) => {
      const year = parseInt(e.target.value);
      display.textContent = `Year: ${year}`;
      this.applyTimeFilter(layerId, config, year, 'year');
      
      // 触发图例更新
      if (window.app && window.app.legendManager) {
        window.app.legendManager.renderLegends();
      }
    };

    // 移除之前的事件监听器
    slider.removeEventListener('input', this.yearHandler);
    this.yearHandler = handler;
    slider.addEventListener('input', handler);

    // 初始化
    this.applyTimeFilter(layerId, config, parseInt(slider.value), 'year');
  }

  /**
   * 设置周度控制
   */
  setupWeekControl(layerId, config) {
    const slider = document.getElementById('weekSlider');
    const display = document.getElementById('weekDisplay');
    
    if (!slider || !display) return;

    const handler = (e) => {
      const week = parseInt(e.target.value);
      display.textContent = `Week ${week} (2024)`;
      this.applyTimeFilter(layerId, config, week, 'week');
      
      // 触发图例更新
      if (window.app && window.app.legendManager) {
        window.app.legendManager.renderLegends();
      }
    };

    // 移除之前的事件监听器
    slider.removeEventListener('input', this.weekHandler);
    this.weekHandler = handler;
    slider.addEventListener('input', handler);

    // 初始化
    this.applyTimeFilter(layerId, config, parseInt(slider.value), 'week');
  }
  
  /**
   * 设置日期控制（用于taxi demand）
   */
  setupDateControl(layerId, config) {
    const datePicker = document.getElementById('taxiDatePicker');
    const display = document.getElementById('taxiDateDisplay');
    const statsDiv = document.getElementById('taxiDateStats');
    
    if (!datePicker || !display) return;

    const handler = (e) => {
      const selectedDate = e.target.value;
      this.selectedTaxiDate = selectedDate;
      display.textContent = selectedDate;
      
      // 更新统计信息
      this.updateTaxiDateStats(selectedDate, statsDiv);
      
      // 更新热力图颜色（根据选定日期的需求）
      this.updateTaxiHeatmap(selectedDate);
      
      // 如果有打开的taxi popup，更新它
      this.updateOpenTaxiPopup();
    };

    // 移除之前的事件监听器
    datePicker.removeEventListener('change', this.dateHandler);
    this.dateHandler = handler;
    datePicker.addEventListener('change', handler);

    // 初始化
    this.selectedTaxiDate = datePicker.value;
    this.updateTaxiDateStats(datePicker.value, statsDiv);
  }
  
  /**
   * 更新已打开的taxi popup（当日期改变时）
   */
  updateOpenTaxiPopup() {
    const popup = this.popups.get('taxiDemand');
    if (popup && popup.isOpen()) {
      // 获取popup的位置和之前点击的feature
      const lngLat = popup.getLngLat();
      
      // 查询该位置的feature
      const features = this.map.queryRenderedFeatures(
        this.map.project(lngLat),
        { layers: ['taxi-zones-fill'] }
      );
      
      if (features && features.length > 0) {
        const props = features[0].properties;
        const content = this.generateTaxiDemandPopupContent(props, lngLat.lng, lngLat.lat);
        popup.setHTML(content);
      }
    }
  }
  
  /**
   * 更新taxi日期统计信息
   */
  updateTaxiDateStats(date, statsDiv) {
    if (!statsDiv) return;
    
    // 计算该日期的总需求
    if (!this.taxiHourlyData) {
      statsDiv.textContent = 'Loading data...';
      return;
    }
    
    let totalPickup = 0;
    let totalDropoff = 0;
    let zonesWithData = 0;
    
    Object.keys(this.taxiHourlyData).forEach(zoneId => {
      const zoneData = this.taxiHourlyData[zoneId][date];
      if (zoneData) {
        zonesWithData++;
        zoneData.forEach(h => {
          totalPickup += h.pickup;
          totalDropoff += h.dropoff;
        });
      }
    });
    
    statsDiv.innerHTML = `
      <div style="background:#f0f9ff;padding:6px;border-radius:4px;">
        <div style="font-size:11px;color:#0369a1;margin-bottom:4px;">Daily Totals:</div>
        <div style="font-size:12px;">
          <div><span style="color:#666;font-size:10px;">Pickups:</span> <span style="color:#2563eb;font-weight:600;">↑ ${totalPickup.toLocaleString()}</span></div>
          <div><span style="color:#666;font-size:10px;">Dropoffs:</span> <span style="color:#dc2626;font-weight:600;">↓ ${totalDropoff.toLocaleString()}</span></div>
        </div>
        <div style="font-size:10px;color:#666;margin-top:4px;">
          ${zonesWithData} zones with data
        </div>
      </div>
    `;
  }

  /**
   * 应用时间过滤器
   */
  applyTimeFilter(layerId, config, value, type) {
    let filter = null;
    
    if (type === 'year') {
      filter = ['==', ['get', 'year'], value];
    } else if (type === 'week') {
      filter = ['==', ['get', 'time_group'], value];
    }

    this.filters.set(`${layerId}_time`, filter);

    // 应用到所有相关图层
    config.layerIds.forEach(actualLayerId => {
      if (this.map.getLayer(actualLayerId)) {
        this.map.setFilter(actualLayerId, filter);
      }
    });
  }

  /**
   * 清理时间控制
   */
  clearTimeControl(layerId, config) {
    let controlId;
    if (config.timeControlType === 'year') {
      controlId = 'timeControl';
    } else if (config.timeControlType === 'week') {
      controlId = 'weeklyTimeControl';
    } else if (config.timeControlType === 'date') {
      if (layerId === 'weather') {
        controlId = 'weatherDateControl';
      } else {
        controlId = 'taxiDateControl';
      }
    }
    
    const control = document.getElementById(controlId);
    if (control) {
      control.style.display = 'none';
    }

    // 清理过滤器
    this.filters.delete(`${layerId}_time`);
    config.layerIds.forEach(actualLayerId => {
      if (this.map.getLayer(actualLayerId)) {
        this.map.setFilter(actualLayerId, null);
      }
    });
  }

  /**
   * 设置过滤器
   */
  setupFilters(layerId, config) {
    if (config.filterType === 'category' && layerId === 'poi') {
      this.setupPOIFilters();
    }
  }

  /**
   * 设置POI过滤器
   */
  setupPOIFilters() {
    const control = document.getElementById('poiFilters');
    if (control) {
      control.style.display = 'block';
    }

    const container = document.getElementById('poiCategoryList');
    const selectAllCheckbox = document.getElementById('poi-select-all');
    
    if (!container || !selectAllCheckbox) return;

    const poiCategories = window.cityVerseConfig.getPOICategories();
    let activePOICategories = new Set(Object.keys(poiCategories));

    // 清空容器
    container.innerHTML = '';

    // 设置全选功能
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      if (isChecked) {
        activePOICategories = new Set(Object.keys(poiCategories));
      } else {
        activePOICategories.clear();
      }

      // 更新所有复选框
      Object.keys(poiCategories).forEach(category => {
        const checkbox = document.getElementById(`poi-cat-${category}`);
        if (checkbox) checkbox.checked = isChecked;
      });

      this.applyPOIFilter(activePOICategories);
    });

    // 创建类别复选框
    const sortedCategories = Object.entries(poiCategories)
      .sort(([,a], [,b]) => b.count - a.count);

    sortedCategories.forEach(([category, info]) => {
      const div = document.createElement('div');
      div.className = 'toggle';
      div.innerHTML = `
        <input type="checkbox" id="poi-cat-${category}" checked />
        <label for="poi-cat-${category}" style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:14px;">${info.icon}</span>
          <span style="width:12px; height:12px; background:${info.color}; border-radius:50%; border:1px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,0.1);"></span>
          <span>${category} (${info.count})</span>
        </label>
      `;

      const checkbox = div.querySelector('input');
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          activePOICategories.add(category);
        } else {
          activePOICategories.delete(category);
        }

        this.updateSelectAllCheckbox(selectAllCheckbox, activePOICategories, poiCategories);
        this.applyPOIFilter(activePOICategories);
      });

      container.appendChild(div);
    });

    this.activePOICategories = activePOICategories;
  }

  /**
   * 更新全选复选框状态
   */
  updateSelectAllCheckbox(selectAllCheckbox, activePOICategories, poiCategories) {
    const totalCategories = Object.keys(poiCategories).length;
    const activeCount = activePOICategories.size;

    if (activeCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (activeCount === totalCategories) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }

  /**
   * 应用POI过滤器
   */
  applyPOIFilter(activePOICategories) {
    const poiCategories = window.cityVerseConfig.getPOICategories();
    let filter = null;

    if (activePOICategories.size === 0) {
      filter = ['==', ['get', 'poi_category'], ''];
    } else if (activePOICategories.size < Object.keys(poiCategories).length) {
      filter = ['in', ['get', 'poi_category'], ['literal', Array.from(activePOICategories)]];
    }

    if (this.map.getLayer('poi-points')) {
      this.map.setFilter('poi-points', filter);
    }
  }

  /**
   * 清理过滤器
   */
  clearFilters(layerId, config) {
    if (config.filterType === 'category' && layerId === 'poi') {
      const control = document.getElementById('poiFilters');
      if (control) {
        control.style.display = 'none';
      }

      if (this.map.getLayer('poi-points')) {
        this.map.setFilter('poi-points', null);
      }
    }
  }

  /**
   * 获取活跃的叠加图层
   */
  getActiveOverlays() {
    return this.activeOverlays;
  }

  /**
   * 设置天气日期控制
   */
  setupWeatherDateControl(layerId, config) {
    const datePicker = document.getElementById('weatherDatePicker');
    const display = document.getElementById('weatherDateDisplay');
    
    if (!datePicker || !display) return;

    const handler = (e) => {
      const selectedDate = e.target.value;
      this.selectedWeatherDate = selectedDate;
      display.textContent = selectedDate;
      this.updateWeatherDisplay(selectedDate);
    };

    // 移除之前的事件监听器
    datePicker.removeEventListener('change', this.weatherDateHandler);
    this.weatherDateHandler = handler;
    datePicker.addEventListener('change', handler);

    // 初始化
    this.selectedWeatherDate = datePicker.value;
    this.updateWeatherDisplay(datePicker.value);
  }

  /**
   * 加载天气数据
   */
  async loadWeatherData() {
    try {
      const response = await fetch('./data/weather_2024.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.weatherData = await response.json();
      
      // 加载完成后更新显示
      this.updateWeatherDisplay(this.selectedWeatherDate);
      this.showWeatherBar();
    } catch (error) {
      console.error('Failed to load weather data:', error);
      alert('无法加载天气数据，请检查文件是否存在');
    }
  }

  /**
   * 更新天气显示
   */
  updateWeatherDisplay(date) {
    if (!this.weatherData) return;
    
    // 查找指定日期的天气数据
    const weatherRecord = this.weatherData.find(record => record.date === date);
    
    if (!weatherRecord) {
      console.warn('No weather data for date:', date);
      return;
    }

    // 更新天气栏
    const iconEl = document.getElementById('weatherIcon');
    const dateEl = document.getElementById('weatherDate');
    const typeEl = document.getElementById('weatherType');
    const tempEl = document.getElementById('weatherTemp');
    const precipEl = document.getElementById('weatherPrecip');
    const humidityEl = document.getElementById('weatherHumidity');
    const windEl = document.getElementById('weatherWind');

    if (iconEl) iconEl.textContent = weatherRecord.icon || '☀️';
    if (dateEl) dateEl.textContent = date;
    if (typeEl) typeEl.textContent = weatherRecord.weather || 'Clear';
    
    // 温度范围（同时显示摄氏度和华氏度）
    if (tempEl) {
      if (weatherRecord.temp_min_c !== null && weatherRecord.temp_max_c !== null &&
          weatherRecord.temp_min_f !== null && weatherRecord.temp_max_f !== null) {
        const tempText = `${weatherRecord.temp_min_c}°C ~ ${weatherRecord.temp_max_c}°C (${weatherRecord.temp_min_f}°F ~ ${weatherRecord.temp_max_f}°F)`;
        tempEl.textContent = tempText;
      } else {
        tempEl.textContent = '--';
      }
    }
    
    // 降水量
    if (precipEl) {
      const precipText = weatherRecord.precipitation !== null && weatherRecord.precipitation > 0
        ? `${weatherRecord.precipitation} mm`
        : 'None';
      precipEl.textContent = precipText;
    }
    
    // 湿度
    if (humidityEl) {
      const humidityText = weatherRecord.humidity !== null
        ? `${weatherRecord.humidity}%`
        : '--';
      humidityEl.textContent = humidityText;
    }
    
    // 风速
    if (windEl) {
      const windText = weatherRecord.wind_speed !== null
        ? `${weatherRecord.wind_speed} mph`
        : '--';
      windEl.textContent = windText;
    }
  }

  /**
   * 显示天气栏
   */
  showWeatherBar() {
    const weatherBar = document.getElementById('weatherBar');
    if (weatherBar) {
      weatherBar.classList.remove('hidden');
    }
  }

  /**
   * 隐藏天气栏
   */
  hideWeatherBar() {
    const weatherBar = document.getElementById('weatherBar');
    if (weatherBar) {
      weatherBar.classList.add('hidden');
    }
  }
}
