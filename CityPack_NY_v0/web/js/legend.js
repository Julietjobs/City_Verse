/**
 * CityVerse Legend Management Module
 * 图例生成和渲染逻辑
 */

class LegendManager {
  constructor(layerManager) {
    this.layerManager = layerManager;
  }

  /**
   * 渲染所有活跃图层的图例
   */
  renderLegends() {
    const legendContainer = document.getElementById('legend');
    if (!legendContainer) return;

    const parts = [];
    const activeOverlays = this.layerManager.getActiveOverlays();

    for (const layerId of activeOverlays) {
      const config = window.cityVerseConfig.getLayerConfig(layerId);
      if (config && config.hasLegend) {
        const html = this.generateLegend(layerId, config);
        if (html) {
          parts.push(`<div data-legend="${layerId}">${html}</div>`);
        }
      }
    }

    legendContainer.innerHTML = parts.join('');
  }

  /**
   * 生成单个图层的图例
   */
  generateLegend(layerId, config) {
    switch (layerId) {
      case 'signals':
        return this.generateSignalsLegend(config);
      case 'tracts':
        return this.generateTractsLegend(config);
      case 'crime':
        return this.generateCrimeLegend(layerId, config);
      case 'crime2024':
        return this.generateCrimeLegend(layerId, config);
      case 'poi':
        return this.generatePOILegend(config);
      case 'imageViewer':
        return this.generateImageViewerLegend(config);
      case 'trafficFlow':
        return this.generateTrafficFlowLegend(config);
      case 'taxiDemand':
        return this.generateTaxiDemandLegend(config);
      default:
        return this.generateGenericLegend(layerId, config);
    }
  }

  /**
   * 生成交通信号灯图例
   */
  generateSignalsLegend(config) {
    return `
      <div style="font-weight:600;margin-bottom:6px;">Traffic Signals</div>
      <div class="pill">
        <span class="dot" style="background:${config.color}"></span>
        ${config.label}
      </div>
    `;
  }

  /**
   * 生成人口普查区域图例
   */
  generateTractsLegend(config) {
    if (!config.legendBins) return '';

    const binsHtml = config.legendBins.map(bin => 
      `<div class="item">
        <span class="swatch" style="background:${bin.color}"></span>
        ${bin.label}
      </div>`
    ).join('');

    return `
      <div style="font-weight:600;margin-bottom:6px;">Density (/km²)</div>
      ${binsHtml}
    `;
  }

  /**
   * 生成犯罪数据图例
   */
  generateCrimeLegend(layerId, config) {
    const currentValue = this.getCurrentTimeValue(layerId, config);
    const stats = this.getCrimeStatistics(layerId, currentValue);
    const yearText = layerId === 'crime' ? currentValue : '2024';
    const timeText = layerId === 'crime' ? `Year: ${currentValue}` : `Week ${currentValue} (2024)`;

    if (!config.categories || !stats) return '';

    const categoriesHtml = config.categories.map(cat => 
      `<div class="item">
        <span class="swatch" style="background:${cat.color}"></span>
        ${cat.label}: ${stats[cat.key]?.toLocaleString() || 0}
      </div>`
    ).join('');

    const datasetInfo = layerId === 'crime' 
      ? `Complete dataset - all ${stats.total.toLocaleString()} records included`
      : `Complete weekly dataset - all ${stats.total.toLocaleString()} records`;

    const zoomInfo = layerId === 'crime'
      ? 'Heat map: zoom 8-15 | Points: zoom 10+'
      : 'Heat map: zoom 8-15 | Points: zoom 10+ (full display)';

    return `
      <div style="font-weight:600;margin-bottom:6px;">Crime Statistics - ${timeText}</div>
      <div style="margin-bottom:8px;font-size:12px;color:#0a84ff;font-weight:600;">
        Total: ${stats.total.toLocaleString()} cases
      </div>
      ${categoriesHtml}
      <div style="margin-top:8px;font-size:10px;color:#888;font-style:italic;">
        ${datasetInfo}
      </div>
      <div style="margin-top:4px;font-size:11px;color:#666;">
        ${zoomInfo}
      </div>
    `;
  }

  /**
   * 生成POI图例（空图例，因为信息在过滤器中显示）
   */
  generatePOILegend(config) {
    return '';
  }

  /**
   * 生成图像查看器图例
   */
  generateImageViewerLegend(config) {
    return `
      <div style="font-weight:600;margin-bottom:6px;">Image Viewer</div>
      <div style="font-size:12px;color:#666;margin-bottom:6px;">
        Click anywhere on the map to view images
      </div>
      <div class="pill">
        <span style="font-size:14px;">🛰️</span>
        Satellite
      </div>
      <div class="pill">
        <span style="font-size:14px;">🚶</span>
        Street View
      </div>
    `;
  }

  /**
   * 生成 Traffic Flow 图例
   */
  generateTrafficFlowLegend(config) {
    return `
      <div style="font-weight:600;margin-bottom:6px;">Traffic Flow</div>
      <div class="item">
        <span class="swatch" style="background:#586970;"></span>
        Road / Intersection
      </div>
      <div class="item">
        <span class="swatch" style="background:#bed8e8;"></span>
        Lane Marking
      </div>
      <div class="item">
        <span class="swatch" style="background:#FFD700;"></span>
        Center Line
      </div>
      <div class="item">
        <span class="swatch" style="background:#f2bfd7;"></span>
        Vehicle
      </div>
      <div class="item">
        <span class="swatch" style="background:#85ee00;"></span>
        Green Light
      </div>
      <div class="item">
        <span class="swatch" style="background:#db635e;"></span>
        Red Light
      </div>
      <div style="margin-top:8px;font-size:11px;color:#666;">
        Upload replay.txt file to start simulation
      </div>
    `;
  }

  /**
   * 生成出租车需求图例
   */
  generateTaxiDemandLegend(config) {
    if (!config.legendBins) return '';

    const binsHtml = config.legendBins.map(bin => 
      `<div class="item">
        <span class="swatch" style="background:${bin.color};"></span>
        <span style="font-size:12px;">${bin.label}</span>
      </div>`
    ).join('');

    const legendTitle = config.legendTitle || 'Total Demand';

    return `
      <div style="font-weight:600;margin-bottom:8px;font-size:13px;color:#333;">${legendTitle}</div>
      <div>
        ${binsHtml}
      </div>
    `;
  }

  /**
   * 生成通用图例
   */
  generateGenericLegend(layerId, config) {
    return `
      <div style="font-weight:600;margin-bottom:6px;">${config.label}</div>
      <div class="pill">
        <span class="dot" style="background:${config.color || '#666'}"></span>
        ${config.label}
      </div>
    `;
  }

  /**
   * 获取当前时间值
   */
  getCurrentTimeValue(layerId, config) {
    if (!config.hasTimeControl) return null;

    if (config.timeControlType === 'year') {
      const slider = document.getElementById('yearSlider');
      return slider ? parseInt(slider.value) : config.timeRange.default;
    } else if (config.timeControlType === 'week') {
      const slider = document.getElementById('weekSlider');
      return slider ? parseInt(slider.value) : config.timeRange.default;
    }

    return null;
  }

  /**
   * 获取犯罪统计数据
   */
  getCrimeStatistics(layerId, value) {
    if (layerId === 'crime') {
      return window.cityVerseConfig.getCrimeStats(value);
    } else if (layerId === 'crime2024') {
      return window.cityVerseConfig.getWeeklyCrimeStats(value);
    }
    return null;
  }
}
