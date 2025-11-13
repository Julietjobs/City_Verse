/**
 * CityVerse Image Viewer Module
 * 卫星图和街景图查看功能
 */

class ImageViewer {
  constructor(map, layerManager) {
    this.map = map;
    this.layerManager = layerManager;
    this.imageApiUrl = window.cityVerseConfig.getSettings().imageApiUrl;
    this.setup();
  }

  /**
   * 设置图像查看器
   */
  setup() {
    this.map.on('click', (e) => {
      // 只在图像查看器模式启用时显示图像
      if (!this.layerManager.getActiveOverlays().has('imageViewer')) {
        return;
      }

      // 检查是否点击了其他交互式要素
      const features = this.map.queryRenderedFeatures(e.point);
      const hasInteractiveFeature = features.some(f => 
        ['tracts-fill', 'crime-points', 'crime-2024-points', 'poi-points'].includes(f.layer.id)
      );

      if (!hasInteractiveFeature) {
        this.showImagePopup(e.lngLat.lat, e.lngLat.lng, e.lngLat);
      }
    });
  }

  /**
   * 显示图像弹窗
   */
  showImagePopup(lat, lon, lngLat) {
    // 创建带加载状态的弹窗
    const popup = new maplibregl.Popup({ 
      className: 'image-popup',
      closeButton: true, 
      closeOnClick: true,
      maxWidth: '600px'
    })
    .setLngLat(lngLat)
    .setHTML(this.generateLoadingContent(lat, lon))
    .addTo(this.map);

    // 获取图像信息
    this.fetchImageInfo(lat, lon)
      .then(info => {
        this.updateImagePopup(popup, info, lat, lon);
      })
      .catch(error => {
        console.error('Error fetching image info:', error);
        popup.setHTML(this.generateErrorContent(error.message));
      });
  }

  /**
   * 生成加载中的内容
   */
  generateLoadingContent(lat, lon) {
    return `
      <div class="popup-header">
        <span style="font-size:16px;">🌍</span>
        <span>Loading Images...</span>
      </div>
      <div class="popup-loading">
        <div>📍 Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
        <div style="margin-top:10px;">🔄 Fetching satellite and street view images...</div>
      </div>
    `;
  }

  /**
   * 生成错误内容
   */
  generateErrorContent(errorMessage) {
    return `
      <div class="popup-header">
        <span style="font-size:16px;">❌</span>
        <span>Error Loading Images</span>
      </div>
      <div class="popup-error">
        Failed to load images: ${errorMessage}
      </div>
    `;
  }

  /**
   * 获取图像信息
   */
  async fetchImageInfo(lat, lon) {
    const response = await fetch(`${this.imageApiUrl}/api/images?lat=${lat}&lon=${lon}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * 更新图像弹窗内容
   */
  updateImagePopup(popup, info, lat, lon) {
    const satelliteUrl = `${this.imageApiUrl}/api/satellite?lat=${lat}&lon=${lon}`;
    let streetviewHtml = '';

    if (info.streetview.available) {
      const streetInfo = info.streetview.info;
      const streetviewUrl = `${this.imageApiUrl}/api/streetview?lat=${lat}&lon=${lon}&quality=1024`;
      streetviewHtml = `
        <div class="popup-image-container">
          <img src="${streetviewUrl}" alt="Street View" class="popup-image">
          <div class="popup-image-label">
            🚶 Street View (${streetInfo.distance_m}m away)
          </div>
        </div>
      `;
    } else {
      streetviewHtml = `
        <div class="popup-image-container">
          <div style="height:200px;display:flex;align-items:center;justify-content:center;background:#f8f9fa;color:#666;flex-direction:column;gap:8px;">
            <span style="font-size:24px;">🚫</span>
            <div>No street view available</div>
          </div>
          <div class="popup-image-label">🚶 Street View (Not Available)</div>
        </div>
      `;
    }

    const content = `
      <div class="popup-header">
        <span style="font-size:16px;">🌍</span>
        <span>Satellite & Street View</span>
      </div>
      <div class="popup-images">
        <div class="popup-image-container">
          <img src="${satelliteUrl}" alt="Satellite View" class="popup-image">
          <div class="popup-image-label">🛰️ Satellite View (ESRI)</div>
        </div>
        ${streetviewHtml}
      </div>
      <div class="popup-info">
        <div><strong>📍 Location:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
        ${info.streetview.available ? 
          `<div><strong>📸 Street View:</strong> Captured ${new Date(info.streetview.info.captured_at).toLocaleDateString()}</div>` : 
          '<div><strong>📸 Street View:</strong> Not available in this area</div>'
        }
        <div style="margin-top:8px;font-size:11px;color:#666;">
          🛰️ Satellite: ESRI World Imagery | 🚶 Street: Mapillary
        </div>
      </div>
    `;

    popup.setHTML(content);
  }
}
