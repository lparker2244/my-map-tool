import React, { useRef, useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';  // Include this for drawing features like polygons

export default function App() {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [tileLayer, setTileLayer] = useState(null);
  const [isAerial, setIsAerial] = useState(true);

  const aerialTiles =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const standardTiles = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const smallIcon = new L.DivIcon({
    iconSize: new L.Point(6, 6),
    className: 'leaflet-div-icon leaflet-editing-icon',
  });
  const smallTouchIcon = new L.DivIcon({
    iconSize: new L.Point(10, 10),
    className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon',
  });

  useEffect(() => {
    if (!map && mapRef.current) {
      const newMap = L.map(mapRef.current).setView([36.7378, -119.7871], 13);
      const initialLayer = L.tileLayer(isAerial ? aerialTiles : standardTiles).addTo(newMap);
      setTileLayer(initialLayer);

      // FeatureGroup for polygons
      const drawnItems = new L.FeatureGroup();
      newMap.addLayer(drawnItems);

      // Draw control
      const drawControl = new L.Control.Draw({
        edit: {
          featureGroup: drawnItems,
          polygon: {
            icon: smallIcon,
            touchIcon: smallTouchIcon,
          },
        },
        draw: {
          polygon: {
            icon: smallIcon,
            touchIcon: smallTouchIcon,
          },
          rectangle: false,
          circle: false,
          circlemarker: false,
          marker: false,
          polyline: false,
        },
      });
      newMap.addControl(drawControl);

      // On polygon creation
      newMap.on('draw:created', (e) => {
        const polygonLayer = e.layer;
        polygonLayer.setStyle({ color: '#3388ff', weight: 2, fillOpacity: 0.2 });
        drawnItems.addLayer(polygonLayer);
      });

      setMap(newMap);
    }
  }, [map, isAerial]);

  return (
    <div className="map-container" style={{ width: '100%', height: '600px' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
