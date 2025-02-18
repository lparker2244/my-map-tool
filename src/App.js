import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import axios from 'axios';

export default function AerialMapApp() {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [tileLayer, setTileLayer] = useState(null);
  const [isAerial, setIsAerial] = useState(true);

  // Unique IDs
  const nextIdRef = useRef(1);
  const nextTenantIdRef = useRef(1);
  const nextSubSpaceIdRef = useRef(1);

  // Polygons: { id, name, address, layer, labelMarker, businesses?: string[] }
  const [polygons, setPolygons] = useState([]);
  // Tenants: { tenantId, polygonId, name }
  const [tenants, setTenants] = useState([]);
  // SubSpaces: { id, polygonId, occupantTenantId, size }
  const [subSpaces, setSubSpaces] = useState([]);

  // UI states
  const [selectedPolygonId, setSelectedPolygonId] = useState(null);
  const [showTenantPanel, setShowTenantPanel] = useState(false);

  // Leaflet tile URLs
  const aerialTiles =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const standardTiles = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  // Leaflet icons for smaller corners
  const smallIcon = new L.DivIcon({
    iconSize: new L.Point(6, 6),
    className: 'leaflet-div-icon leaflet-editing-icon',
  });
  const smallTouchIcon = new L.DivIcon({
    iconSize: new L.Point(10, 10),
    className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon',
  });

  // Default polygon style
  const defaultPolyStyle = {
    color: '#3388ff',
    weight: 2,
    fillOpacity: 0.2,
  };

  /***************************************
   * 1) INITIALIZE MAP & DRAW CONTROLS   *
   ***************************************/
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
      newMap.on('draw:created', async (e) => {
        const polygonLayer = e.layer;
        polygonLayer.setStyle(defaultPolyStyle);

        const polyId = nextIdRef.current++;
        const name = 'Unnamed';

        const center = polygonLayer.getBounds().getCenter();
        const labelMarker = createLabelMarker(polygonLayer, name);
        drawnItems.addLayer(polygonLayer);
        drawnItems.addLayer(labelMarker);

        let address = 'Loading...';
        setPolygons((prev) => [
          ...prev,
          { id: polyId, name, address, layer: polygonLayer, labelMarker },
        ]);

        // Attempt to fetch an address
        try {
          const foundAddress = await fetchAddress(center.lat, center.lng);
          address = foundAddress || 'No address found';
        } catch {
          address = 'Error fetching address';
        }

        // Update state
        setPolygons((prev) =>
          prev.map((p) => (p.id === polyId ? { ...p, address } : p))
        );

        // Click => open tenant panel
        polygonLayer.on('click', () => {
          setSelectedPolygonId(polyId);
          setShowTenantPanel(true);
        });
      });

      setMap(newMap);
    }
  }, [mapRef, map]);

  /***************************************
   * 2) SWITCH TILE LAYERS              *
   ***************************************/
  useEffect(() => {
    if (map && tileLayer) {
      map.removeLayer(tileLayer);
      const newLayer = L.tileLayer(isAerial ? aerialTiles : standardTiles);
      newLayer.addTo(map);
      setTileLayer(newLayer);
    }
  }, [isAerial]);

  /***************************************
   * 3) HELPERS                          *
   ***************************************/
  async function fetchAddress(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'YourAppName/1.0' },
    });
    if (!response.ok) {
      throw new Error('Failed to fetch address');
    }
    const data = await response.json();
    return data.display_name;
  }

  function createLabelMarker(polygonLayer, labelText) {
    const center = polygonLayer.getBounds().getCenter();
    const labelIcon = L.divIcon({
      className: 'polygon-label',
      html: `<span style="white-space: nowrap; font-size: 14px; color: black;">${labelText}</span>`
    });
    return L.marker(center, { icon: labelIcon, interactive: false });
  }

  function handleNameChange(polyId, newName) {
    setPolygons((prev) =>
      prev.map((p) => {
        if (p.id === polyId) {
          if (map && p.labelMarker) {
            map.removeLayer(p.labelMarker);
          }
          const newLabelMarker = createLabelMarker(p.layer, newName);
          if (map) {
            map.addLayer(newLabelMarker);
          }
          return { ...p, name: newName, labelMarker: newLabelMarker };
        }
        return p;
      })
    );
  }

  function handleAddressChange(polyId, newAddress) {
    setPolygons((prev) =>
      prev.map((p) => (p.id === polyId ? { ...p, address: newAddress } : p))
    );
  }

  // Add or update a tenant
  function handleAddTenant(polyId, tenantName) {
    const newTenant = {
      tenantId: nextTenantIdRef.current++,
      polygonId: polyId,
      name: tenantName,
    };
    setTenants((prev) => [...prev, newTenant]);
  }

  // Add or update a subspace for a given occupant
  function handleUpdateSubSpace(polygonId, occupantTenantId, sizeVal) {
    const recordId = nextSubSpaceIdRef.current;
    setSubSpaces((prev) => {
      // see if there's an existing record for (polygonId, occupantTenantId)
      const idx = prev.findIndex(
        (s) => s.polygonId === polygonId && s.occupantTenantId === occupantTenantId
      );
      if (idx >= 0) {
        // update existing
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          size: sizeVal,
        };
        return updated;
      } else {
        // add new
        const newRec = {
          id: recordId,
          polygonId,
          occupantTenantId,
          size: sizeVal,
        };
        nextSubSpaceIdRef.current++;
        return [...prev, newRec];
      }
    });
  }

  function handleCloseTenantPanel() {
    setShowTenantPanel(false);
    setSelectedPolygonId(null);
  }

  // OpenAI API search for businesses
  async function handleSearchBusinesses(polyId) {
    const polygon = polygons.find((p) => p.id === polyId);
    if (!polygon) return;

    const address = polygon.address || 'Unknown';
    
    try {
      // Call the actual ChatGPT API to fetch business recommendations
      const businesses = await fetchBusinessRecommendations(address);
      
      // Update the polygon data with the retrieved businesses
      setPolygons((prev) =>
        prev.map((p) => (p.id === polyId ? { ...p, businesses } : p))
      );
    } catch (error) {
      console.error('Error fetching businesses:', error);
    }
  }

  // Function to call the OpenAI API
  async function fetchBusinessRecommendations(address) {
    const apiKey = process.env.REACT_APP_OPENAI_KEY; // Replace with your API key
    const url = 'https://api.openai.com/v1/completions';

    try {
      const response = await axios.post(url, {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: `Please search the internet and provide a list of businesses near the address: ${address}. Format the response as a list, one business per line.`,
          },
        ],
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // Assuming response.data.choices[0].message contains the result
      return response.data.choices[0].message.content.split('\n');
    } catch (error) {
      console.error('Error with API request:', error);
      return ['No businesses found.'];
    }
  }

  // Filter tenants & find polygon
  const selectedTenants = tenants.filter((t) => t.polygonId === selectedPolygonId);
  const selectedPolygon = polygons.find((p) => p.id === selectedPolygonId);

  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-screen"
      style={{ backgroundColor: '#f0f0f0' }}
    >
      {/* MAP SECTION */}
      <div
        style={{
          width: '800px',
          height: '600px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          borderRadius: '8px',
          overflow: 'hidden',
          marginBottom: '16px',
          backgroundColor: 'white',
        }}
      >
        <div style={{ padding: '8px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>Aerial Map Viewer</h1>
          <button
            style={{ padding: '6px 12px', border: '1px solid #aaa', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer' }}
            onClick={() => setIsAerial(!isAerial)}
          >
            {isAerial ? 'Switch to Standard' : 'Switch to Aerial'}
          </button>
        </div>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* POLYGON RECORDS TABLE */}
      <div style={{ width: '800px', backgroundColor: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', padding: '16px', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '8px', fontWeight: 'bold' }}>Polygon Records</h2>
        {polygons.length === 0 ? (
          <p style={{ color: '#666' }}>No polygons created yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f3f3f3' }}>
              <tr>
                <th style={{ padding: '8px', borderBottom: '1px solid #ccc', textAlign: 'left' }}>ID</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #ccc', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #ccc', textAlign: 'left' }}>Address</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #ccc', textAlign: 'left' }}>Businesses</th>
              </tr>
            </thead>
            <tbody>
              {polygons.map((poly) => {
                const bizString = poly.businesses ? poly.businesses.join(', ') : '(none)';
                return (
                  <tr key={poly.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{poly.id}</td>
                    <td style={{ padding: '8px' }}>
                      <EditableNameCell
                        name={poly.name}
                        onChange={(newVal) => handleNameChange(poly.id, newVal)}
                      />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <EditableAddressCell
                        address={poly.address}
                        onChange={(newVal) => handleAddressChange(poly.id, newVal)}
                      />
                      <button
                        style={{
                          padding: '4px 8px',
                          marginLeft: '8px',
                          border: '1px solid #aaa',
                          borderRadius: '4px',
                          backgroundColor: 'white',
                          cursor: 'pointer',
                        }}
                        onClick={() => handleSearchBusinesses(poly.id)}
                      >
                        Search
                      </button>
                    </td>
                    <td style={{ padding: '8px' }}>{bizString}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* TENANT PANEL & SHAPE PREVIEW (IF SELECTED) */}
      {showTenantPanel && selectedPolygon && (
        <div
          style={{
            marginTop: '16px',
            width: '800px',
            backgroundColor: 'white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            padding: '16px',
            borderRadius: '8px',
          }}
        >
          <TenantRecords
            polygonId={selectedPolygon.id}
            tenants={tenants.filter((t) => t.polygonId === selectedPolygon.id)}
            onClose={handleCloseTenantPanel}
            onAddTenant={handleAddTenant}
          />
          <hr style={{ margin: '16px 0' }} />
          <ShapeSubdivisionPanel
            polygon={selectedPolygon}
            tenants={tenants.filter((t) => t.polygonId === selectedPolygon.id)}
            subSpaces={subSpaces}
            onUpdateSubSpace={handleUpdateSubSpace}
          />
        </div>
      )}
    </motion.div>
  );
}

// Editable name cell for polygons
function EditableNameCell({ name, onChange }) {
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState(name);

  function handleEditClick(e) {
    e.stopPropagation();
    setEditing(true);
  }
  function handleSave(e) {
    e.stopPropagation();
    onChange(tempName);
    setEditing(false);
  }
  function handleCancel(e) {
    e.stopPropagation();
    setTempName(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
        <input
          style={{ border: '1px solid #aaa', borderRadius: '4px', padding: '4px', width: '120px' }}
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
        />
        <button
          style={{ padding: '4px 8px', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
          onClick={handleSave}
        >
          Save
        </button>
        <button
          style={{ padding: '4px 8px', border: '1px solid red', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#ffe5e5' }}
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <span style={{ color: 'black' }} onClick={(e) => e.stopPropagation()}>
      {name}{' '}
      <button
        style={{ padding: '4px 8px', marginLeft: '8px', border: '1px solid #aaa', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer' }}
        onClick={handleEditClick}
      >
        Edit
      </button>
    </span>
  );
}

// Editable address cell for polygons
function EditableAddressCell({ address, onChange }) {
  const [editing, setEditing] = useState(false);
  const [tempAddress, setTempAddress] = useState(address);

  function handleEditClick(e) {
    e.stopPropagation();
    setEditing(true);
  }
  function handleSave(e) {
    e.stopPropagation();
    onChange(tempAddress);
    setEditing(false);
  }
  function handleCancel(e) {
    e.stopPropagation();
    setTempAddress(address);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
        <input
          style={{ border: '1px solid #aaa', borderRadius: '4px', padding: '4px', width: '200px' }}
          value={tempAddress}
          onChange={(e) => setTempAddress(e.target.value)}
        />
        <button
          style={{ padding: '4px 8px', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
          onClick={handleSave}
        >
          Save
        </button>
        <button
          style={{ padding: '4px 8px', border: '1px solid red', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#ffe5e5' }}
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <span style={{ color: 'black' }} onClick={(e) => e.stopPropagation()}>
      {address}{' '}
      <button
        style={{ padding: '4px 8px', marginLeft: '8px', border: '1px solid #aaa', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer' }}
        onClick={handleEditClick}
      >
        Edit
      </button>
    </span>
  );
}

function TenantRecords({ polygonId, tenants, onClose, onAddTenant }) {
  const [newTenantName, setNewTenantName] = useState('');

  function handleAdd() {
    if (newTenantName.trim()) {
      onAddTenant(polygonId, newTenantName.trim());
      setNewTenantName('');
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Tenant Records (Polygon {polygonId})</h2>
        <button
          style={{ padding: '4px 8px', border: '1px solid red', borderRadius: '4px', backgroundColor: '#ffe5e5', cursor: 'pointer' }}
          onClick={onClose}
        >
          Hide
        </button>
      </div>

      {tenants.length === 0 ? (
        <p style={{ color: '#666' }}>No tenants yet.</p>
      ) : (
        <ul style={{ marginBottom: '8px' }}>
          {tenants.map((t) => (
            <li key={t.tenantId}>{t.name}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          placeholder="Tenant Name"
          style={{ flex: '1 1 auto', border: '1px solid #aaa', borderRadius: '4px', padding: '4px' }}
          value={newTenantName}
          onChange={(e) => setNewTenantName(e.target.value)}
        />
        <button
          style={{ padding: '4px 8px', border: '1px solid #333', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer' }}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ============================
//    Geometry Helper Code
// ============================
function computePolygonAreaSqFt(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  const center = findLatLngsCenter(latlngs);
  const refLat = center.lat;
  const refLng = center.lng;

  const coords = latlngs.map((ll) => latLngToLocalXY(ll.lat, ll.lng, refLat, refLng));
  const areaM2 = shoelaceArea(coords);
  const areaFt2 = areaM2 * 10.7639;
  return Math.max(areaFt2, 0);
}

function findLatLngsCenter(latlngs) {
  let sumLat = 0;
  let sumLng = 0;
  latlngs.forEach((ll) => {
    sumLat += ll.lat;
    sumLng += ll.lng;
  });
  return {
    lat: sumLat / latlngs.length,
    lng: sumLng / latlngs.length,
  };
}

function latLngToLocalXY(lat, lng, refLat, refLng) {
  const R = 6378137;
  const degToRad = Math.PI / 180;
  const x = (lng - refLng) * degToRad * R * Math.cos(refLat * degToRad);
  const y = (lat - refLat) * degToRad * R;
  return { x, y };
}

function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function buildSizedSubPaths(boundingRect, subSpaces, dimension, totalArea) {
  let subPaths = [];
  let offset = 0;

  for (const s of subSpaces) {
    const areaVal = Math.max(0, parseFloat(s.size) || 0);
    let ratio = 0;
    if (totalArea > 0 && areaVal > 0) {
      ratio = areaVal / totalArea;
    }
    if (ratio > 1) {
      ratio = 1;
    }

    if (dimension === 'horizontal') {
      const y1 = boundingRect.y + offset * boundingRect.h;
      const h = ratio * boundingRect.h;
      const path = rectToPath(boundingRect.x, y1, boundingRect.w, h);
      subPaths.push(path);
      offset += ratio;
    } else {
      const x1 = boundingRect.x + offset * boundingRect.w;
      const w = ratio * boundingRect.w;
      const path = rectToPath(x1, boundingRect.y, w, boundingRect.h);
      subPaths.push(path);
      offset += ratio;
    }
  }

  return subPaths;
}

function rectToPath(x, y, w, h) {
  if (w <= 0 || h <= 0) {
    return '';
  }
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
}

function latlngsToPointsWithMargin(latlngs, margin) {
  if (!latlngs || latlngs.length === 0) {
    return [];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const rawPoints = latlngsToPoints(latlngs);
  rawPoints.forEach((pt) => {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  });

  const width = 200 - margin * 2;
  const height = 200 - margin * 2;
  const xRange = maxX - minX || 0.000001;
  const yRange = maxY - minY || 0.000001;

  return rawPoints.map((p) => {
    const x = margin + ((p.x - minX) / xRange) * width;
    const y = margin + (1 - (p.y - minY) / yRange) * height;
    return { x, y };
  });
}
function ShapeSubdivisionPanel({ polygon, tenants, subSpaces, onUpdateSubSpace }) {
  return <div>Shape Subdivision Panel</div>;
}

function latlngsToPoints(latlngs) {
  return latlngs.map((ll) => ({ x: ll.lng, y: ll.lat }));
}

function getBoundingRect(points) {
  if (points.length === 0) {
    return { x: 10, y: 10, w: 180, h: 180 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  points.forEach((pt) => {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  });

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}
