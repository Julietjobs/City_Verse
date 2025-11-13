/**
 * CityVerse Configuration Module
 * 配置管理和初始化
 */

class CityVerseConfig {
  constructor() {
    this.layerConfig = null;
    this.crimeStats = null;
    this.poiCategories = null;
    this.settings = {
      mapCenter: [-73.9851, 40.7589],
      mapZoom: 12,
      tileServerUrl: 'http://localhost:8080',
      imageApiUrl: 'http://localhost:8081'
    };
  }

  /**
   * 加载所有配置文件
   */
  async loadConfigs() {
    try {
      const [layerConfig, crimeStats, poiCategories] = await Promise.all([
        fetch('./data/layer_config.json').then(r => r.json()),
        fetch('./data/crime_statistics.json').then(r => r.json()),
        fetch('./data/poi_categories.json').then(r => r.json())
      ]);

      this.layerConfig = layerConfig;
      this.crimeStats = crimeStats;
      this.poiCategories = poiCategories;
      
      // 更新设置
      if (layerConfig.settings) {
        this.settings = { ...this.settings, ...layerConfig.settings };
      }

      console.log('✅ All configurations loaded successfully');
      return true;
    } catch (error) {
      console.error('❌ Error loading configurations:', error);
      throw error;
    }
  }

  /**
   * 获取图层配置
   */
  getLayerConfig(layerId) {
    if (!this.layerConfig) return null;
    
    // 先在基础图层中查找
    if (this.layerConfig.layers.base[layerId]) {
      return this.layerConfig.layers.base[layerId];
    }
    
    // 再在叠加图层中查找
    if (this.layerConfig.layers.overlays[layerId]) {
      return this.layerConfig.layers.overlays[layerId];
    }
    
    return null;
  }

  /**
   * 获取所有叠加图层配置
   */
  getOverlayConfigs() {
    return this.layerConfig?.layers?.overlays || {};
  }

  /**
   * 获取基础图层配置
   */
  getBaseLayerConfigs() {
    return this.layerConfig?.layers?.base || {};
  }

  /**
   * 获取犯罪统计数据
   */
  getCrimeStats(year) {
    if (!this.crimeStats) return { total: 0, felony: 0, misdemeanor: 0, violation: 0 };
    return this.crimeStats.historical_crime_stats[year] || { total: 0, felony: 0, misdemeanor: 0, violation: 0 };
  }

  /**
   * 获取2024年周度犯罪统计数据
   */
  getWeeklyCrimeStats(week) {
    if (!this.crimeStats) return { total: 0, felony: 0, misdemeanor: 0, violation: 0 };
    return this.crimeStats.weekly_2024_stats[week] || { total: 0, felony: 0, misdemeanor: 0, violation: 0 };
  }

  /**
   * 获取POI类别配置
   */
  getPOICategories() {
    return this.poiCategories || {};
  }

  /**
   * 获取设置
   */
  getSettings() {
    return this.settings;
  }
}

// 创建全局配置实例
window.cityVerseConfig = new CityVerseConfig();
